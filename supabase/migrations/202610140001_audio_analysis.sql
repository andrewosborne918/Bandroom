begin;
alter table public.processing_jobs add column analysis jsonb;
commit;
