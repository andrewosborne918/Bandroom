begin;

-- Repair counters from the durable records. Completed jobs retain their original
-- output estimate for history/retries; only waiting/running jobs still reserve it.
create or replace function public.reconcile_usage(b uuid) returns void
language plpgsql security definer set search_path=public as $$
declare stored bigint; reserved bigint;
begin
 perform 1 from public.band_usage where band_id=b for update;
 select coalesce(sum(bytes),0) into stored from public.audio_assets
  where band_id=b and status='verified';
 select stored+coalesce(sum(bytes),0) into stored from public.export_jobs
  where band_id=b and status='completed';
 -- Keep expired-but-unreleased uploads reserved until maintenance cancels them.
 select coalesce(sum(bytes),0) into reserved from public.storage_reservations
  where band_id=b and state='active';
 select reserved+coalesce(sum(output_reserved_bytes),0) into reserved
  from public.processing_jobs where band_id=b and status in ('queued','processing');
 select reserved+coalesce(sum(reserved_bytes),0) into reserved
  from public.export_jobs where band_id=b and status in ('queued','processing');
 update public.band_usage set stored_bytes=stored,reserved_bytes=reserved,updated_at=now()
  where band_id=b;
end$$;
revoke execute on function public.reconcile_usage(uuid) from public,anon,authenticated;
grant execute on function public.reconcile_usage(uuid) to service_role;

-- Correct existing drift now; the scheduled maintenance uses the same repair.
do $$declare band uuid;begin
 for band in select band_id from public.band_usage order by band_id loop
  perform public.reconcile_usage(band);
 end loop;
end$$;
commit;
