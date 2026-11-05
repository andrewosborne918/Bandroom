begin;
create or replace function public.submit_separation(b uuid,s uuid,input uuid,job uuid,idem text) returns public.processing_jobs language plpgsql security definer set search_path=public as $$declare e public.entitlements;u public.band_usage;a public.audio_assets;c public.platform_config;j public.processing_jobs;monthly bigint;global_used bigint;reserve bigint;begin
 if not public.band_permission(b,array['owner','admin','editor']::public.band_role[]) then raise exception 'BR:Editor permission required';end if;
 select * into c from public.platform_config where id=true for update;
 select * into j from public.processing_jobs where band_id=b and idempotency_key=idem;if found then return j;end if;
 if not c.ai_enabled then raise exception 'BR:AI processing is currently unavailable';end if;
 select * into u from public.band_usage where band_id=b for update;perform public.apply_account_storage(b);select * into e from public.entitlements where band_id=b;select * into a from public.audio_assets where id=input and song_id=s and band_id=b and source='original' and status<>'deleting';
 if not found or a.duration>e.ai_seconds_limit then raise exception 'BR:Input missing or exceeds AI duration allowance';end if;
 if exists(select 1 from public.processing_jobs where band_id=b and input_asset_id=input and status in ('queued','processing')) then raise exception 'BR:A job is already active for this recording';end if;
 if (select count(*) from public.processing_jobs where band_id=b and status in ('queued','processing'))>=20 then raise exception 'BR:Your band queue is full (20 songs). Wait for a song to finish and retry.';end if;
 select coalesce(sum(seconds),0) into monthly from public.processing_usage where band_id=b and month=date_trunc('month',now())::date and state in ('reserved','consumed');
 select coalesce(sum(seconds),0) into global_used from public.processing_usage where month=date_trunc('month',now())::date and state in ('reserved','consumed');
 if monthly+ceil(a.duration)>e.ai_monthly_seconds or global_used+ceil(a.duration)>c.monthly_ai_seconds_cap then raise exception 'BR:Processing allowance reached';end if;
 reserve=ceil(a.duration)::bigint*44100*6*6+1048576;
 if u.stored_bytes+u.reserved_bytes+reserve>e.storage_limit then raise exception 'BR:Not enough space for lossless stems';end if;
 insert into public.processing_jobs(id,band_id,song_id,input_asset_id,created_by,idempotency_key,duration_seconds,output_reserved_bytes) values(job,b,s,input,auth.uid(),idem,ceil(a.duration),reserve) returning * into j;
 update public.band_usage set reserved_bytes=reserved_bytes+reserve where band_id=b;insert into public.processing_usage(job_id,band_id,month,seconds,state) values(job,b,date_trunc('month',now())::date,ceil(a.duration),'reserved');return j;
end$$;

create or replace function public.finish_separation(job uuid,hash text,outputs jsonb,job_error text default null) returns void language plpgsql security definer set search_path=public as $$declare j public.processing_jobs;st jsonb;total bigint;n integer;begin select * into j from public.processing_jobs where id=job for update;if j.status='completed' then return;end if;if j.status<>'processing' or j.lease_hash<>hash or j.lease_expires_at<now() then raise exception 'BR:Stale job';end if;
 if job_error is not null then update public.processing_jobs set status='failed',error=left(job_error,500),lease_hash=null,updated_at=now() where id=job;update public.band_usage set reserved_bytes=greatest(0,reserved_bytes-j.output_reserved_bytes) where band_id=j.band_id;update public.processing_usage set state='released' where job_id=job and state='reserved';return;end if;
 n=jsonb_array_length(outputs);
 if n not in (4,6) or (select count(distinct x->>'category') from jsonb_array_elements(outputs) x)<>n then raise exception 'BR:Expected four or six model stems';end if;select sum((x->>'bytes')::bigint) into total from jsonb_array_elements(outputs) x;if total>j.output_reserved_bytes then raise exception 'BR:Outputs exceed reserved storage';end if;
 for st in select value from jsonb_array_elements(outputs) loop if st->>'category' not in ('vocals','drums','bass','guitar','keyboards','other') or st->>'object_key' not like 'bands/'||j.band_id||'/songs/'||j.song_id||'/%' then raise exception 'BR:Invalid model output';end if;insert into public.audio_assets(id,band_id,song_id,bucket,object_key,filename,category,bytes,duration,sample_rate,source,status) values((st->>'id')::uuid,j.band_id,j.song_id,'stems',st->>'object_key',st->>'filename',st->>'category',(st->>'bytes')::bigint,(st->>'duration')::double precision,(st->>'sampleRate')::integer,'ai','verified');end loop;
 update public.band_usage set reserved_bytes=greatest(0,reserved_bytes-j.output_reserved_bytes),stored_bytes=stored_bytes+total where band_id=j.band_id;update public.processing_usage set state='consumed' where job_id=job;update public.processing_jobs set status='completed',results=outputs,error=null,lease_hash=null,updated_at=now() where id=job;
end$$;
commit;
