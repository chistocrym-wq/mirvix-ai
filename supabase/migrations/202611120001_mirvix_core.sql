-- MIRVIX AI Intelligence, migration 001. Apply once in Supabase SQL editor.
-- Strict tenant isolation. No table is publicly readable; service_role only for job writes.
begin;

create table if not exists public.platform_staff (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check (role in ('admin','specialist')),
 created_at timestamptz not null default now()
);
create table if not exists public.organizations (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(name) between 2 and 200),
 slug text unique,
 created_at timestamptz not null default now()
);
create table if not exists public.org_memberships (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check (role in ('owner','manager','editor','viewer')),
 created_at timestamptz not null default now(),
 primary key (organization_id,user_id)
);
create table if not exists public.projects (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(char_length(name) between 2 and 200),
 domain text not null check (char_length(domain) between 4 and 253),
 region text not null default '',
 status text not null default 'active' check (status in ('active','archived')),
 created_at timestamptz not null default now(),
 unique(id,organization_id)
);
create index if not exists projects_org_idx on public.projects(organization_id);

-- Project content; composite project/org FKs reject cross-tenant references.
create table if not exists public.project_services (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, name text not null, source_url text,
 is_confirmed boolean not null default false, created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade,
 unique(id,organization_id)
);
create table if not exists public.competitors (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, name text not null, domain text,
 competitor_type text not null default 'candidate' check (competitor_type in ('candidate','direct','indirect','source','rejected')),
 region text, evidence jsonb not null default '[]'::jsonb, verified_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade,
 unique(id,organization_id)
);
create table if not exists public.query_clusters (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, service_id uuid, title text not null, region text,
 created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade,
 foreign key(service_id,organization_id) references public.project_services(id,organization_id),
 unique(id,organization_id)
);
create table if not exists public.target_queries (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, cluster_id uuid, query text not null,
 provenance text not null check (provenance in ('serp','search_console','competitor_api','ai_observed','hypothesis','manual')),
 source_url text, original_query text, intent text, region text,
 verified boolean not null default false, created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade,
 foreign key(cluster_id,organization_id) references public.query_clusters(id,organization_id),
 unique(id,organization_id)
);
create index if not exists queries_project_idx on public.target_queries(project_id);
create table if not exists public.search_observations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, query_id uuid, engine text not null check (engine in ('google','yandex')),
 query text not null, region text, position integer check (position between 1 and 250),
 found_domain text not null, found_url text not null,
 source text not null, checked_at timestamptz not null,
 result jsonb not null default '{}'::jsonb,
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade,
 foreign key(query_id,organization_id) references public.target_queries(id,organization_id)
);
create index if not exists search_project_date_idx on public.search_observations(project_id,checked_at desc);
create table if not exists public.ai_results (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, query_id uuid,
 provider text not null, model text, prompt text not null, answer text,
 brand_mentioned boolean, brand_cited boolean, search_evidence boolean,
 response_status text not null check (response_status in ('answered','error','no_answer')),
 error_code text, checked_at timestamptz not null default now(),
 sources jsonb not null default '[]'::jsonb, competitors jsonb not null default '[]'::jsonb,
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade,
 foreign key(query_id,organization_id) references public.target_queries(id,organization_id),
 unique(id,organization_id)
);
create index if not exists ai_project_date_idx on public.ai_results(project_id,checked_at desc);
create table if not exists public.ai_citations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 result_id uuid not null, url text not null, title text, cited_domain text, checked_at timestamptz not null default now(),
 foreign key(result_id,organization_id) references public.ai_results(id,organization_id) on delete cascade
);
create table if not exists public.technical_audits (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, checked_at timestamptz not null default now(),
 score numeric(5,2), coverage_percent numeric(5,2), summary jsonb not null default '{}'::jsonb,
 findings jsonb not null default '[]'::jsonb,
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade
);
create table if not exists public.traffic_metrics (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, period_start date not null, period_end date not null,
 source text not null, channel text not null, visits bigint check (visits>=0),
 leads bigint check (leads>=0), orders bigint check (orders>=0),
 origin text not null check (origin in ('yandex_metrica','ga4','crm','manual_csv')),
 imported_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade
);
create table if not exists public.promotion_tasks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, title text not null, details text, priority text not null default 'medium',
 phase integer not null default 30 check(phase in (30,60,90)),
 status text not null default 'open' check(status in ('open','working','done','blocked')),
 evidence jsonb not null default '[]'::jsonb, owner_id uuid references auth.users(id),
 due_at timestamptz, created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade
);
create table if not exists public.report_snapshots (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, period_start date, period_end date,
 report jsonb not null, created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade
);

-- Paid integrations start disabled, even if keys are present on Netlify.
create table if not exists public.api_limits (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 provider text not null check (provider ~ '^[a-z_]{3,35}$'),
 enabled boolean not null default false,
 max_daily_calls integer not null default 0 check(max_daily_calls between 0 and 100000),
 max_daily_usd numeric(12,5) not null default 0 check(max_daily_usd between 0 and 100000),
 estimate_per_call_usd numeric(12,5) not null default 0 check(estimate_per_call_usd between 0 and 10000),
 updated_at timestamptz not null default now(),
 primary key (organization_id,provider)
);
create table if not exists public.api_usage (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid, job_id uuid, provider text not null, usage_kind text not null,
 status text not null default 'reserved' check(status in ('reserved','completed','error')),
 estimated_usd numeric(12,5) not null, actual_usd numeric(12,5),
 response_code text, created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id)
);
create index if not exists api_usage_daily_idx on public.api_usage(organization_id,provider,created_at desc);
create table if not exists public.integration_checks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 provider text not null, key_present boolean not null default false,
 responded boolean not null default false, search_evidence boolean, sources_count integer,
 model text, error_code text, checked_at timestamptz not null default now(),
 unique(organization_id,provider)
);
create table if not exists public.analysis_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null, job_type text not null check(job_type in ('site_audit','serp_scan','ai_matrix')),
 status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
 priority integer not null default 0 check(priority between -10 and 10),
 progress integer not null default 0 check(progress between 0 and 100),
 attempts integer not null default 0, max_attempts integer not null default 3 check(max_attempts between 1 and 5),
 run_after timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
 last_error text, requested_by uuid references auth.users(id), created_at timestamptz not null default now(),
 started_at timestamptz, finished_at timestamptz, result_summary jsonb,
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade,
 unique(id,organization_id)
);
create index if not exists analysis_jobs_claim_idx on public.analysis_jobs(status,run_after,created_at);
create table if not exists public.analysis_job_steps (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 job_id uuid not null, ordinal integer not null,
 step_type text not null check(step_type in ('site_audit','serp','ai')),
 status text not null default 'queued' check(status in ('queued','completed','error')),
 payload jsonb not null default '{}'::jsonb,
 result jsonb, error text, completed_at timestamptz,
 foreign key(job_id,organization_id) references public.analysis_jobs(id,organization_id) on delete cascade,
 unique(job_id,ordinal)
);

-- Security-definer helpers must be owned by the database owner, not by clients.
create or replace function public.is_platform_staff()
returns boolean language sql stable security definer set search_path = ''
as $$select exists(select 1 from public.platform_staff s where s.user_id=(select auth.uid()) and s.role in ('admin','specialist'))$$;
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$select exists(select 1 from public.platform_staff s where s.user_id=(select auth.uid()) and s.role='admin')$$;
create or replace function public.can_read_org(org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$select public.is_platform_staff() or exists(select 1 from public.org_memberships m where m.organization_id=org and m.user_id=(select auth.uid()))$$;
create or replace function public.can_write_org(org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$select public.is_platform_staff() or exists(select 1 from public.org_memberships m where m.organization_id=org and m.user_id=(select auth.uid()) and m.role in ('owner','manager','editor'))$$;

-- Strict table access: clients have SELECT only. Mutations use vetted server API.
do $$
declare rel text;
begin
 foreach rel in array array[
 'platform_staff','organizations','org_memberships','projects','project_services',
 'competitors','query_clusters','target_queries','search_observations','ai_results','ai_citations',
 'technical_audits','traffic_metrics','promotion_tasks','report_snapshots','api_limits','api_usage',
 'integration_checks','analysis_jobs','analysis_job_steps'
 ] loop
  execute format('alter table public.%I enable row level security',rel);
  execute format('revoke all on public.%I from anon,authenticated',rel);
  execute format('grant select on public.%I to authenticated',rel);
 end loop;
 foreach rel in array array[
 'projects','project_services','competitors','query_clusters','target_queries',
 'search_observations','ai_results','ai_citations','technical_audits','traffic_metrics',
 'promotion_tasks','report_snapshots','analysis_jobs','analysis_job_steps'
 ] loop
  execute format('create policy %I on public.%I for select to authenticated using (public.can_read_org(organization_id))',rel||'_tenant_read',rel);
 end loop;
 foreach rel in array array['api_limits','api_usage','integration_checks'] loop
  execute format('create policy %I on public.%I for select to authenticated using (public.is_platform_staff())',rel||'_staff_read',rel);
 end loop;
end $$;
create policy organizations_tenant_read on public.organizations for select to authenticated using (public.can_read_org(id));
create policy memberships_self_read on public.org_memberships for select to authenticated
 using (user_id=(select auth.uid()) or public.is_platform_staff());
create policy staff_self_read on public.platform_staff for select to authenticated
 using (user_id=(select auth.uid()) or public.is_platform_admin());

-- Atomic lease claim, retries after lease expiry, non-public database RPC.
create or replace function public.claim_analysis_job()
returns setof public.analysis_jobs language plpgsql security definer set search_path = ''
as $$
declare found_job public.analysis_jobs%rowtype;
begin
 select * into found_job from public.analysis_jobs j
 where ((j.status='queued' and j.run_after<=now())
     or (j.status='running' and j.lease_until<now()))
   and j.attempts<j.max_attempts
 order by j.priority desc,j.created_at
 for update skip locked limit 1;
 if not found then return; end if;
 update public.analysis_jobs j set status='running',attempts=j.attempts+1,
  started_at=coalesce(j.started_at,now()),lease_token=gen_random_uuid(),
  lease_until=now()+interval '3 minutes',last_error=null
 where j.id=found_job.id returning * into found_job;
 return next found_job;
end $$;

-- Atomic daily quota reservation. A failed call remains counted conservatively.
create or replace function public.reserve_api_usage(
 p_org uuid,p_provider text,p_project uuid,p_job uuid,p_kind text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare lim public.api_limits%rowtype; uses integer; spent numeric(12,5); new_id uuid;
begin
 select * into lim from public.api_limits
 where organization_id=p_org and provider=p_provider for update;
 if not found or not lim.enabled or lim.max_daily_calls<1
    or lim.estimate_per_call_usd<=0 or lim.max_daily_usd<lim.estimate_per_call_usd then
    raise exception 'Paid integration is disabled until admin sets a positive budget';
 end if;
 select count(*),coalesce(sum(estimated_usd),0) into uses,spent
 from public.api_usage where organization_id=p_org and provider=p_provider
   and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc';
 if uses>=lim.max_daily_calls or spent+lim.estimate_per_call_usd>lim.max_daily_usd then
   raise exception 'Daily call or USD budget has been reached';
 end if;
 if p_project is not null and not exists (
  select 1 from public.projects where id=p_project and organization_id=p_org
 ) then raise exception 'Project/organization mismatch'; end if;
 insert into public.api_usage(organization_id,project_id,job_id,provider,usage_kind,estimated_usd)
 values(p_org,p_project,p_job,p_provider,p_kind,lim.estimate_per_call_usd) returning id into new_id;
 return new_id;
end $$;

-- Only the trusted service role can claim jobs or reserve paid calls.
revoke all on function public.claim_analysis_job() from public,anon,authenticated;
revoke all on function public.reserve_api_usage(uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_analysis_job() to service_role;
grant execute on function public.reserve_api_usage(uuid,text,uuid,uuid,text) to service_role;
grant execute on function public.is_platform_staff() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.can_read_org(uuid) to authenticated;
grant execute on function public.can_write_org(uuid) to authenticated;

commit;
