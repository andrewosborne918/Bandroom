begin;
alter table public.processing_jobs add column progress jsonb;
alter table public.processing_jobs add column chart jsonb;
create or replace function public.submit_separation(b uuid,s uuid,input uuid,job uuid,idem text) returns public.processing_jobs language plpgsql security definer set search_path=public as $$declare e public.entitlements;u public.band_usage;a public.audio_assets;c public.platform_config;j public.processing_jobs;monthly bigint;global_used bigint;reserve bigint;begin
 if not public.band_permission(b,array['owner','admin','editor']::public.band_role[]) then raise exception 'BR:Editor permission required';end if;
 select * into c from public.platform_config where id=true for update;
 select * into j from public.processing_jobs where band_id=b and idempotency_key=idem;if found then return j;end if;
 if not c.ai_enabled then raise exception 'BR:AI processing is currently unavailable';end if;
 select * into u from public.band_usage where band_id=b for update;select * into e from public.entitlements where band_id=b;select * into a from public.audio_assets where id=input and song_id=s and band_id=b and source='original' and status<>'deleting';
 if not found or a.duration>e.ai_seconds_limit then raise exception 'BR:Input missing or exceeds AI duration allowance';end if;
 if exists(select 1 from public.processing_jobs where band_id=b and status in ('queued','processing')) then raise exception 'BR:A job is already active for this band';end if;
 select coalesce(sum(seconds),0) into monthly from public.processing_usage where band_id=b and month=date_trunc('month',now())::date and state in ('reserved','consumed');
 select coalesce(sum(seconds),0) into global_used from public.processing_usage where month=date_trunc('month',now())::date and state in ('reserved','consumed');
 if monthly+ceil(a.duration)>e.ai_monthly_seconds or global_used+ceil(a.duration)>c.monthly_ai_seconds_cap then raise exception 'BR:Processing allowance reached';end if;
 reserve=ceil(a.duration)::bigint*44100*6*4+1048576;
 if u.stored_bytes+u.reserved_bytes+reserve>e.storage_limit then raise exception 'BR:Not enough space for four lossless stems';end if;
 insert into public.processing_jobs(id,band_id,song_id,input_asset_id,created_by,idempotency_key,duration_seconds,output_reserved_bytes) values(job,b,s,input,auth.uid(),idem,ceil(a.duration),reserve) returning * into j;
 update public.band_usage set reserved_bytes=reserved_bytes+reserve where band_id=b;insert into public.processing_usage(job_id,band_id,month,seconds,state) values(job,b,date_trunc('month',now())::date,ceil(a.duration),'reserved');return j;
end$$;

create function public.reset_processing_progress() returns trigger language plpgsql set search_path=public as $$begin
 if new.status='queued' and old.status<>'queued' then new.progress=null;end if;return new;
end$$;
create trigger processing_progress_reset before update on public.processing_jobs for each row execute function public.reset_processing_progress();
revoke execute on function public.reset_processing_progress() from public,anon,authenticated;
grant execute on function public.reset_processing_progress() to service_role;
commit;
