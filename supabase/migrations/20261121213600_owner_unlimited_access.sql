begin;

-- Allow NULL (= unlimited) on all per-band entitlement limits for personal/app-owner workspaces.
alter table public.entitlements
 alter column file_limit drop not null,
 alter column ai_seconds_limit drop not null,
 alter column ai_monthly_seconds drop not null,
 alter column member_limit drop not null,
 alter column active_jobs_limit drop not null;

create or replace function public.is_personal_owner(uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select uid is not null and exists(
  select 1 from public.storage_account_overrides
  where user_id=uid and plan='personal'
 );
$$;
revoke execute on function public.is_personal_owner(uuid) from public,anon,authenticated;
grant execute on function public.is_personal_owner(uuid) to service_role;

create or replace function public.is_personal_band(b uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.entitlements
  where band_id=b and plan='personal'
 );
$$;
revoke execute on function public.is_personal_band(uuid) from public,anon,authenticated;
grant execute on function public.is_personal_band(uuid) to service_role;

create or replace function public.apply_account_storage(b uuid) returns void
language plpgsql security definer set search_path=public as $$
declare allowance public.storage_account_overrides;
begin
 select o.* into allowance from public.storage_account_overrides o
 join public.band_memberships m on m.user_id=o.user_id
 where m.band_id=b and m.role='owner'
 order by o.storage_limit desc nulls first limit 1;
 if found then
  update public.entitlements
   set storage_limit=allowance.storage_limit,
       file_limit=null,
       ai_seconds_limit=null,
       ai_monthly_seconds=null,
       member_limit=null,
       active_jobs_limit=null,
       plan=allowance.plan
   where band_id=b
     and (storage_limit,file_limit,ai_seconds_limit,ai_monthly_seconds,member_limit,active_jobs_limit,plan)
         is distinct from (allowance.storage_limit,null::bigint,null::integer,null::integer,null::integer,null::integer,allowance.plan);
 elsif exists(select 1 from public.band_billing where band_id=b and livemode and has_plus
  and not review_required and period_end>now()) then
  update public.entitlements
   set storage_limit=26843545600,
       file_limit=coalesce(file_limit,262144000),
       ai_seconds_limit=coalesce(ai_seconds_limit,600),
       ai_monthly_seconds=coalesce(ai_monthly_seconds,3600),
       member_limit=coalesce(member_limit,20),
       active_jobs_limit=coalesce(active_jobs_limit,1),
       plan='plus'
   where band_id=b
     and (storage_limit,file_limit,ai_seconds_limit,ai_monthly_seconds,member_limit,active_jobs_limit,plan)
         is distinct from (26843545600::bigint,coalesce(file_limit,262144000),coalesce(ai_seconds_limit,600),coalesce(ai_monthly_seconds,3600),coalesce(member_limit,20),coalesce(active_jobs_limit,1),'plus'::text);
 else
  update public.entitlements
   set storage_limit=2147483648,
       file_limit=coalesce(file_limit,262144000),
       ai_seconds_limit=coalesce(ai_seconds_limit,600),
       ai_monthly_seconds=coalesce(ai_monthly_seconds,3600),
       member_limit=coalesce(member_limit,20),
       active_jobs_limit=coalesce(active_jobs_limit,1),
       plan='free'
   where band_id=b and plan in ('personal','plus');
 end if;
end$$;

-- App owner never hits hourly request rate limits.
create or replace function public.take_request(scope_name text,maximum integer) returns void
language plpgsql security definer set search_path=public as $$
declare total integer;
begin
 if auth.uid() is null then raise exception 'BR:Sign in';end if;
 if public.is_personal_owner(auth.uid()) then return;end if;
 insert into public.request_windows values(auth.uid(),scope_name,date_trunc('hour',now()),1)
  on conflict(user_id,scope,window_start) do update set count=request_windows.count+1 returning count into total;
 if total>maximum then raise exception 'BR:Request limit reached. Try again in the next hour.';end if;
end$$;

-- App owner has no owned-workspace cap.
create or replace function public.create_band(band_name text) returns uuid
language plpgsql security definer set search_path=public as $$
declare b uuid;
begin
 if not public.is_invitation_owner() then raise exception 'BR:Only the app owner can create workspaces';end if;
 perform public.take_request('band.create',5);
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if not public.is_personal_owner(auth.uid())
  and (select count(*) from public.band_memberships where user_id=auth.uid() and role='owner')>=5 then
  raise exception 'BR:Five owned workspaces maximum. Contact the app administrator.';
 end if;
 insert into public.bands(name) values(trim(band_name)) returning id into b;
 insert into public.band_memberships values(b,auth.uid(),'owner',now());
 insert into public.entitlements(band_id) values(b);
 insert into public.band_usage(band_id) values(b);
 insert into public.setlists(band_id) values(b);
 insert into public.audit_events(band_id,actor_id,action) values(b,auth.uid(),'band.created');
 return b;
end$$;

-- App owner workspaces have no file-size, duration, stem-count, or storage upload caps.
create or replace function public.reserve_upload(b uuid,s uuid,a uuid,reservation uuid,file_name text,file_bytes bigint,file_duration double precision,file_rate integer,asset_source text) returns public.audio_assets
language plpgsql security definer set search_path=public as $$
declare u public.band_usage;e public.entitlements;asset public.audio_assets;k text;bucket_name text;reserve_bytes bigint;
begin
 if not public.band_permission(b,array['owner','admin','editor']::public.band_role[]) then raise exception 'BR:Editor permission required';end if;
 perform public.take_request('audio.upload',60);
 select * into u from public.band_usage where band_id=b for update;
 perform public.apply_account_storage(b);
 select * into e from public.entitlements where band_id=b;
 select * into asset from public.audio_assets where id=a;
 if found then
  if asset.band_id<>b or asset.song_id<>s then raise exception 'BR:Conflicting upload';end if;
  return asset;
 end if;
 if not exists(select 1 from public.songs where id=s and band_id=b) then raise exception 'BR:Song missing';end if;
 if asset_source='import' and e.plan<>'personal'
  and (select count(*) from public.audio_assets where song_id=s and source='import' and status<>'deleting')>=24 then
  raise exception 'BR:Maximum 24 imported stems';
 end if;
 if file_bytes<=0 or (e.file_limit is not null and file_bytes>e.file_limit)
  or file_duration<=0 or (e.plan<>'personal' and file_duration>7200)
  or file_rate not between 8000 and 192000 then
  raise exception 'BR:Invalid audio size or metadata';
 end if;
 bucket_name=case when asset_source='original' then 'originals' else 'temporary' end;
 select file_size_limit into reserve_bytes from storage.buckets where id=bucket_name;
 reserve_bytes=greatest(file_bytes,coalesce(reserve_bytes,e.file_limit,file_bytes));
 if u.stored_bytes+u.reserved_bytes+reserve_bytes>e.storage_limit then raise exception 'BR:Storage allowance exceeded';end if;
 k='bands/'||b||'/songs/'||s||'/'||a||'/'||regexp_replace(left(file_name,100),'[^a-zA-Z0-9_.-]','_','g');
 insert into public.audio_assets(id,band_id,song_id,bucket,object_key,filename,bytes,duration,sample_rate,source) values(a,b,s,bucket_name,k,left(file_name,100),file_bytes,file_duration,file_rate,asset_source) returning * into asset;
 insert into public.storage_reservations(id,band_id,song_id,user_id,asset_id,bytes) values(reservation,b,s,auth.uid(),a,reserve_bytes);
 update public.band_usage set reserved_bytes=reserved_bytes+reserve_bytes,updated_at=now() where band_id=b;
 return asset;
end$$;

-- App owner workspaces have no duration, queue, monthly minute, global cap, or storage caps on separation.
create or replace function public.submit_separation(b uuid,s uuid,input uuid,job uuid,idem text) returns public.processing_jobs
language plpgsql security definer set search_path=public as $$
declare e public.entitlements;u public.band_usage;a public.audio_assets;c public.platform_config;j public.processing_jobs;monthly bigint;global_used bigint;reserve bigint;
begin
 if not public.band_permission(b,array['owner','admin','editor']::public.band_role[]) then raise exception 'BR:Editor permission required';end if;
 select * into c from public.platform_config where id=true for update;
 select * into j from public.processing_jobs where band_id=b and idempotency_key=idem;if found then return j;end if;
 if not c.ai_enabled then raise exception 'BR:AI processing is currently unavailable';end if;
 select * into u from public.band_usage where band_id=b for update;
 perform public.apply_account_storage(b);
 select * into e from public.entitlements where band_id=b;
 select * into a from public.audio_assets where id=input and song_id=s and band_id=b and source='original' and status<>'deleting';
 if not found or (e.ai_seconds_limit is not null and a.duration>e.ai_seconds_limit) then raise exception 'BR:Input missing or exceeds AI duration allowance';end if;
 if exists(select 1 from public.processing_jobs where band_id=b and input_asset_id=input and status in ('queued','processing')) then raise exception 'BR:A job is already active for this recording';end if;
 if e.plan<>'personal' and (select count(*) from public.processing_jobs where band_id=b and status in ('queued','processing'))>=20 then raise exception 'BR:Your band queue is full (20 songs). Wait for a song to finish and retry.';end if;
 if e.plan<>'personal' then
  select coalesce(sum(seconds),0) into monthly from public.processing_usage where band_id=b and month=date_trunc('month',now())::date and state in ('reserved','consumed');
  select coalesce(sum(pu.seconds),0) into global_used from public.processing_usage pu left join public.entitlements ent on ent.band_id=pu.band_id where pu.month=date_trunc('month',now())::date and pu.state in ('reserved','consumed') and coalesce(ent.plan,'free')<>'personal';
  if (e.ai_monthly_seconds is not null and monthly+ceil(a.duration)>e.ai_monthly_seconds) or global_used+ceil(a.duration)>c.monthly_ai_seconds_cap then raise exception 'BR:Processing allowance reached';end if;
 end if;
 reserve=ceil(a.duration)::bigint*44100*6*6+1048576;
 if u.stored_bytes+u.reserved_bytes+reserve>e.storage_limit then raise exception 'BR:Not enough space for lossless stems';end if;
 insert into public.processing_jobs(id,band_id,song_id,input_asset_id,created_by,idempotency_key,duration_seconds,output_reserved_bytes) values(job,b,s,input,auth.uid(),idem,ceil(a.duration),reserve) returning * into j;
 update public.band_usage set reserved_bytes=reserved_bytes+reserve where band_id=b;
 insert into public.processing_usage(job_id,band_id,month,seconds,state) values(job,b,date_trunc('month',now())::date,ceil(a.duration),'reserved');
 return j;
end$$;

create or replace function public.retry_separation(job uuid) returns public.processing_jobs
language plpgsql security definer set search_path=public as $$
declare j public.processing_jobs;e public.entitlements;u public.band_usage;c public.platform_config;monthly bigint;global_used bigint;extra bigint;
begin
 select * into j from public.processing_jobs where id=job for update;
 if not public.band_permission(j.band_id,array['owner','admin','editor']::public.band_role[]) or j.status<>'failed' or j.attempt>=j.max_attempts then raise exception 'BR:Retry unavailable';end if;
 if not exists(select 1 from public.audio_assets where id=j.input_asset_id and status='verified') then raise exception 'BR:Original is unavailable or invalid. Upload a decodable recording to create a new job.';end if;
 select * into c from public.platform_config where id=true for update;
 if not c.ai_enabled then raise exception 'BR:AI disabled';end if;
 select * into u from public.band_usage where band_id=j.band_id for update;
 perform public.apply_account_storage(j.band_id);
 select * into e from public.entitlements where band_id=j.band_id;
 if u.stored_bytes+u.reserved_bytes+j.output_reserved_bytes>e.storage_limit
  or (e.plan<>'personal' and (select count(*) from public.processing_jobs where band_id=j.band_id and status in ('queued','processing'))>=20) then
  raise exception 'BR:Storage allowance or queue limit reached';
 end if;
 if e.plan<>'personal' then
  select coalesce(sum(seconds),0) into monthly from public.processing_usage where band_id=j.band_id and month=date_trunc('month',now())::date and state in ('consumed','reserved');
  select coalesce(sum(pu.seconds),0) into global_used from public.processing_usage pu left join public.entitlements ent on ent.band_id=pu.band_id where pu.month=date_trunc('month',now())::date and pu.state in ('consumed','reserved') and coalesce(ent.plan,'free')<>'personal';
  extra=case when exists(select 1 from public.processing_usage where job_id=job and state='consumed') then 0 else j.duration_seconds end;
  if (e.ai_monthly_seconds is not null and monthly+extra>e.ai_monthly_seconds) or global_used+extra>c.monthly_ai_seconds_cap then raise exception 'BR:Processing allowance reached';end if;
 end if;
 update public.processing_jobs set status='queued',error=null,lease_hash=null,updated_at=now() where id=job returning * into j;
 update public.band_usage set reserved_bytes=reserved_bytes+j.output_reserved_bytes where band_id=j.band_id;
 update public.processing_usage set state='reserved',month=date_trunc('month',now())::date where job_id=job and state='released';
 return j;
end$$;

-- App owner workspaces have no recognition call/retry caps.
create or replace function public.claim_recognition(b uuid,s uuid,acting_user uuid,hash text,lease_token text,retry boolean,global_cap integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare x public.recognition_scans;sc text;cap integer;n integer;unlimited boolean;
begin
 if not exists(select 1 from public.band_memberships m join public.bands band on band.id=m.band_id where m.band_id=b and m.user_id=acting_user and m.role in ('owner','admin','editor') and not band.suspended) or not exists(select 1 from public.songs where id=s and band_id=b) then raise exception 'BR:Song access denied';end if;
 perform pg_advisory_xact_lock(hashtext('recognition-claims'));
 unlimited=public.is_personal_band(b) or public.is_personal_owner(acting_user);
 select * into x from public.recognition_scans where song_id=s and sample_hash=hash for update;
 if found and (x.status in ('matched','not_found') or x.status='processing' and x.lease_until>now() or x.status='failed' and not retry) then return to_jsonb(x)||jsonb_build_object('claimed',false);end if;
 if found and not unlimited and x.attempt>=3 then raise exception 'BR:Recognition retry limit reached. Enter song information manually.';end if;
 if not unlimited then
  for sc,cap in select 'global:'||to_char(now(),'YYYY-MM'),greatest(0,least(global_cap,100000)) union all select 'band:'||b||':'||to_char(now(),'YYYY-MM'),200 union all select 'user:'||acting_user||':'||to_char(now(),'YYYY-MM-DD-HH24'),20 loop
   insert into public.recognition_usage values(sc,1) on conflict(scope) do update set calls=recognition_usage.calls+1 returning calls into n;
   if n>cap then raise exception 'BR:Song recognition allowance reached. Enter information manually or try later.';end if;
  end loop;
 end if;
 insert into public.recognition_scans(band_id,song_id,sample_hash,lease,lease_until)values(b,s,hash,lease_token,now()+interval '2 minutes') on conflict(song_id,sample_hash) do update set status='processing',result=null,attempt=recognition_scans.attempt+1,lease=lease_token,lease_until=now()+interval '2 minutes',updated_at=now() returning * into x;
 return to_jsonb(x)||jsonb_build_object('claimed',true);
end$$;

-- App owner workspaces have no 100-song setlist cap.
create or replace function public.save_named_setlist(target uuid,expected bigint,title text,ids uuid[])
returns bigint language plpgsql security invoker set search_path='' as $$
declare list public.setlists;item uuid;n integer=0;unlimited boolean;
begin
 select * into list from public.setlists where id=target for update;
 if list.id is null or not public.band_permission(list.band_id,array['owner','admin','editor']::public.band_role[]) then raise exception 'BR:Editor permission required';end if;
 if list.revision<>expected then raise exception 'BR:Setlist changed. Reload before saving.';end if;
 unlimited=exists(select 1 from public.entitlements where band_id=list.band_id and plan='personal');
 if length(trim(title)) not between 1 and 80 or (not unlimited and cardinality(ids)>100) then raise exception 'BR:Use a name and at most 100 songs';end if;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'BR:Duplicate song';end if;
 foreach item in array ids loop
  if not exists(select 1 from public.songs where id=item and band_id=list.band_id) then raise exception 'BR:Song outside workspace';end if;
 end loop;
 update public.setlists set name=trim(title),revision=revision+1 where id=target;
 delete from public.setlist_items where setlist_id=target;
 foreach item in array ids loop insert into public.setlist_items values(target,item,n);n=n+1;end loop;
 return list.revision+1;
end$$;

create or replace function public.replace_setlist(b uuid,ids uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare list uuid;i uuid;n integer=0;
begin
 if not public.band_permission(b,array['owner','admin','editor']::public.band_role[]) then raise exception 'BR:Editor permission required';end if;
 if not public.is_personal_band(b) and cardinality(ids)>100 then raise exception 'BR:Maximum 100 songs';end if;
 select id into list from public.setlists where band_id=b and is_default for update;
 delete from public.setlist_items where setlist_id=list;
 foreach i in array ids loop
  if not exists(select 1 from public.songs where id=i and band_id=b) then raise exception 'BR:Song outside workspace';end if;
  insert into public.setlist_items values(list,i,n);n=n+1;
 end loop;
 update public.setlists set revision=revision+1 where id=list;
end$$;

-- App owner workspaces have no 10-processor limit.
create or replace function public.approve_desktop_pair(code_hash text,b uuid,actor uuid) returns uuid
language plpgsql security invoker set search_path=public as $$
declare pair public.desktop_pairings;d uuid;
begin
 if not exists(select 1 from public.band_memberships m join public.bands bb on bb.id=m.band_id where m.band_id=b and m.user_id=actor and m.role in ('owner','admin','editor') and not bb.suspended) then raise exception 'BR:Editor permission required';end if;
 select * into pair from public.desktop_pairings p where p.code_hash=approve_desktop_pair.code_hash and expires_at>now() for update;
 if not found or pair.device_id is not null then raise exception 'BR:Connection code expired or already used';end if;
 if not public.is_personal_band(b) and (select count(*) from public.processor_devices where band_id=b and revoked_at is null)>=10 then raise exception 'BR:Remove an old processor before connecting another';end if;
 insert into public.processor_devices(band_id,user_id,token_hash,name,platform) values(b,actor,pair.poll_hash,pair.name,pair.platform) returning id into d;
 update public.desktop_pairings set band_id=b,user_id=actor,device_id=d where id=pair.id;return d;
end$$;

-- Ensure all existing app owners are in storage_account_overrides and refresh all band entitlements.
insert into public.storage_account_overrides(user_id,storage_limit,plan)
 select user_id,null,'personal' from public.invitation_owners
 on conflict (user_id) do nothing;

do $$declare b uuid;begin
 for b in select id from public.bands loop
  perform public.apply_account_storage(b);
 end loop;
end$$;

commit;
