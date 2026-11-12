-- MIRVIX 003: staff specialists are limited to explicit project assignments.
begin;
create table if not exists public.project_assignments(
 organization_id uuid not null,
 project_id uuid not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(project_id,user_id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade
);
create index if not exists assignments_staff_idx on public.project_assignments(user_id,organization_id);
alter table public.project_assignments enable row level security;
revoke all on public.project_assignments from anon,authenticated;
grant select on public.project_assignments to authenticated;
create policy assignments_owner_or_admin_read on public.project_assignments for select to authenticated
 using (user_id=(select auth.uid()) or public.is_platform_admin());

create or replace function public.can_read_org(org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
select public.is_platform_admin()
 or exists(select 1 from public.org_memberships m where m.organization_id=org and m.user_id=(select auth.uid()))
 or (public.is_platform_staff() and exists(
  select 1 from public.project_assignments a where a.organization_id=org and a.user_id=(select auth.uid())
 ))
$$;
create or replace function public.can_write_org(org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
select public.is_platform_admin() or exists(
 select 1 from public.org_memberships m where m.organization_id=org and m.user_id=(select auth.uid())
 and m.role in ('owner','manager','editor')
)
$$;
create or replace function public.can_read_project(p uuid,org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
select public.is_platform_admin() or exists(
 select 1 from public.org_memberships m where m.organization_id=org and m.user_id=(select auth.uid())
) or (public.is_platform_staff() and exists(
 select 1 from public.project_assignments a where a.project_id=p and a.organization_id=org
  and a.user_id=(select auth.uid())
))
$$;
create or replace function public.can_write_project(p uuid,org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
select public.can_write_org(org) or (public.is_platform_staff() and exists(
 select 1 from public.project_assignments a where a.project_id=p and a.organization_id=org
  and a.user_id=(select auth.uid())
))
$$;
create or replace function public.can_read_ai_result(r uuid,org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
select exists(select 1 from public.ai_results a where a.id=r and a.organization_id=org
 and public.can_read_project(a.project_id,a.organization_id))
$$;
create or replace function public.can_read_job(j uuid,org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
select exists(select 1 from public.analysis_jobs a where a.id=j and a.organization_id=org
 and public.can_read_project(a.project_id,a.organization_id))
$$;
do $$
declare rel text;
begin
 foreach rel in array array[
 'projects','project_services','competitors','query_clusters','target_queries',
 'search_observations','ai_results','technical_audits','traffic_metrics',
 'promotion_tasks','report_snapshots','analysis_jobs'
 ] loop
  execute format('drop policy if exists %I on public.%I',rel||'_tenant_read',rel);
  execute format('create policy %I on public.%I for select to authenticated using (public.can_read_project(%s,organization_id))',
    rel||'_tenant_read',rel,
    case when rel='projects' then 'id' else 'project_id' end);
 end loop;
end $$;
drop policy if exists ai_citations_tenant_read on public.ai_citations;
create policy ai_citations_tenant_read on public.ai_citations for select to authenticated
 using(public.can_read_ai_result(result_id,organization_id));
drop policy if exists analysis_job_steps_tenant_read on public.analysis_job_steps;
create policy analysis_job_steps_tenant_read on public.analysis_job_steps for select to authenticated
 using(public.can_read_job(job_id,organization_id));
drop policy if exists memberships_self_read on public.org_memberships;
create policy memberships_self_read on public.org_memberships for select to authenticated
 using(user_id=(select auth.uid()) or public.is_platform_admin());
drop policy if exists api_limits_staff_read on public.api_limits;
create policy api_limits_staff_read on public.api_limits for select to authenticated using (public.is_platform_admin());
drop policy if exists api_usage_staff_read on public.api_usage;
create policy api_usage_staff_read on public.api_usage for select to authenticated using (public.is_platform_admin());
drop policy if exists integration_checks_staff_read on public.integration_checks;
create policy integration_checks_staff_read on public.integration_checks for select to authenticated using (public.is_platform_admin());
grant execute on function public.can_read_project(uuid,uuid) to authenticated;
grant execute on function public.can_write_project(uuid,uuid) to authenticated;
grant execute on function public.can_read_ai_result(uuid,uuid) to authenticated;
grant execute on function public.can_read_job(uuid,uuid) to authenticated;
commit;
