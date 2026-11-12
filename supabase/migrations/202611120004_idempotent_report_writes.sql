-- MIRVIX 004: idempotent report and SERP writes for retried worker steps.
begin;
alter table public.technical_audits add column if not exists job_id uuid;
alter table public.search_observations add column if not exists job_id uuid;
alter table public.search_observations add column if not exists step_ordinal integer;
alter table public.ai_results add column if not exists job_id uuid;
alter table public.ai_results add column if not exists step_ordinal integer;
alter table public.technical_audits add constraint technical_audits_job_fk
 foreign key(job_id,organization_id) references public.analysis_jobs(id,organization_id);
alter table public.search_observations add constraint search_observations_job_fk
 foreign key(job_id,organization_id) references public.analysis_jobs(id,organization_id);
alter table public.ai_results add constraint ai_results_job_fk
 foreign key(job_id,organization_id) references public.analysis_jobs(id,organization_id);
alter table public.technical_audits add constraint technical_audits_job_once unique(job_id);
alter table public.search_observations add constraint search_observations_source_once
 unique(job_id,step_ordinal,engine,found_url);
alter table public.ai_results add constraint ai_results_step_once unique(job_id,step_ordinal);
alter table public.ai_citations add constraint ai_citations_url_once unique(result_id,url);
commit;
