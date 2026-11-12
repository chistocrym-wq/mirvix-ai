-- MIRVIX 002: paid step idempotency and durable multi-step processing.
begin;
alter table public.api_usage add column if not exists step_ordinal integer;
create unique index if not exists unique_paid_job_step
 on public.api_usage(job_id,step_ordinal,provider)
 where job_id is not null and step_ordinal is not null;

-- Delete the unscoped reservation RPC: only the per-step idempotent function may be used.
drop function if exists public.reserve_api_usage(uuid,text,uuid,uuid,text);

create or replace function public.reserve_step_api_usage(
 p_org uuid,p_provider text,p_project uuid,p_job uuid,p_step integer,p_kind text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare lim public.api_limits%rowtype; uses integer; spent numeric(12,5); new_id uuid;
begin
 if p_job is null or p_step is null or p_step<0 then
  raise exception 'A valid persisted job step is required to reserve a paid call';
 end if;
 if not exists (
  select 1 from public.analysis_jobs j join public.analysis_job_steps s
   on s.job_id=j.id and s.organization_id=j.organization_id
  where j.id=p_job and j.organization_id=p_org and j.project_id=p_project
   and s.ordinal=p_step and j.status='running'
 ) then raise exception 'Job step is not running for this organization'; end if;
 -- An attempted call must never be automatically billed twice after a timeout.
 if exists (select 1 from public.api_usage
   where job_id=p_job and step_ordinal=p_step and provider=p_provider) then
    raise exception 'Paid step already attempted; inspect existing usage before retry';
 end if;
 select * into lim from public.api_limits
 where organization_id=p_org and provider=p_provider for update;
 if not found or not lim.enabled or lim.max_daily_calls<1
  or lim.estimate_per_call_usd<=0 or lim.max_daily_usd<lim.estimate_per_call_usd
 then raise exception 'Provider is disabled or has no positive authorized budget'; end if;
 select count(*),coalesce(sum(estimated_usd),0) into uses,spent
 from public.api_usage where organization_id=p_org and provider=p_provider
   and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc';
 if uses>=lim.max_daily_calls or spent+lim.estimate_per_call_usd>lim.max_daily_usd then
   raise exception 'Daily API call or estimated USD limit has been reached'; end if;
 insert into public.api_usage(organization_id,project_id,job_id,step_ordinal,provider,usage_kind,estimated_usd)
 values(p_org,p_project,p_job,p_step,p_provider,p_kind,lim.estimate_per_call_usd)
 returning id into new_id;
 return new_id;
end $$;
revoke all on function public.reserve_step_api_usage(uuid,text,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.reserve_step_api_usage(uuid,text,uuid,uuid,integer,text) to service_role;

-- A normal completed step does not exhaust the failure retry counter.
create or replace function public.claim_analysis_job()
returns setof public.analysis_jobs language plpgsql security definer set search_path = ''
as $$
declare job public.analysis_jobs%rowtype; was_stale boolean;
begin
 select * into job from public.analysis_jobs j
 where ((j.status='queued' and j.run_after<=now())
     or (j.status='running' and j.lease_until<now()))
   and j.attempts<j.max_attempts
 order by j.priority desc,j.created_at
 for update skip locked limit 1;
 if not found then return; end if;
 was_stale:=job.status='running';
 update public.analysis_jobs j set status='running',
  attempts=j.attempts+(case when was_stale then 1 else 0 end),
  started_at=coalesce(j.started_at,now()),lease_token=gen_random_uuid(),
  lease_until=now()+interval '3 minutes',last_error=null
 where j.id=job.id returning * into job;
 return next job;
end $$;
revoke all on function public.claim_analysis_job() from public,anon,authenticated;
grant execute on function public.claim_analysis_job() to service_role;
commit;