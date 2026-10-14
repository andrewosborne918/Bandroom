begin;
create table public.request_windows(user_id uuid not null references auth.users(id) on delete cascade,scope text not null,window_start timestamptz not null,count integer not null,primary key(user_id,scope,window_start));
alter table public.request_windows enable row level security;
grant all on public.request_windows to service_role;
create function public.take_request(scope_name text,maximum integer) returns void language plpgsql security definer set search_path=public as $$declare total integer;begin if auth.uid() is null then raise exception 'BR:Sign in';end if;insert into public.request_windows values(auth.uid(),scope_name,date_trunc('hour',now()),1) on conflict(user_id,scope,window_start) do update set count=request_windows.count+1 returning count into total;if total>maximum then raise exception 'BR:Request limit reached. Try again in the next hour.';end if;end$$;
revoke execute on function public.take_request(text,integer) from public,anon,authenticated;
grant execute on function public.take_request(text,integer) to service_role;
-- Members may read audio/chart records only for approved songs, matching library access.
do $$declare t text;begin foreach t in array array['audio_assets','charts','arrangements'] loop execute format('drop policy band_read on public.%I',t);execute format('create policy approved_content_read on public.%I for select to authenticated using(public.band_permission(band_id) and (public.band_permission(band_id,array[''owner'',''admin'',''editor'']::public.band_role[]) or exists(select 1 from public.songs s where s.id=song_id and s.approved)))',t);end loop;end$$;
create function public.fail_input(a uuid,reason text) returns void language plpgsql security definer set search_path=public as $$declare j public.processing_jobs;begin for j in select * from public.processing_jobs where input_asset_id=a and status='queued' for update loop update public.processing_jobs set status='failed',error=left(reason,500),updated_at=now() where id=j.id;update public.band_usage set reserved_bytes=greatest(0,reserved_bytes-j.output_reserved_bytes) where band_id=j.band_id;update public.processing_usage set state='released' where job_id=j.id and state='reserved';end loop;perform public.release_upload(a);end$$;
revoke execute on function public.fail_input(uuid,text) from public,anon,authenticated;
grant execute on function public.fail_input(uuid,text) to service_role;
commit;
