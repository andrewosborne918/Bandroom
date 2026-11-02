begin;
alter table public.bands add column billing_closing boolean not null default false;
alter table public.bands add column billing_closed boolean not null default false;
create table public.band_billing(
 band_id uuid not null references public.bands(id) on delete cascade,
 livemode boolean not null,
 primary key(band_id,livemode),
 customer_id text not null unique,
 subscription_id text,
 status text not null default 'none',
 price_id text,
 period_end timestamptz,
 cancel_at_period_end boolean not null default false,
 has_plus boolean not null default false,
 review_required boolean not null default false,
 risk_event_id text,
 checked_at timestamptz,
 checkout_attempt uuid,
 checkout_interval text check(checkout_interval in ('month','year')),
 checkout_session_id text,
 created_at timestamptz not null default now()
);
create table public.billing_events(
 id text primary key,
 band_id uuid not null references public.bands(id) on delete cascade,
 kind text not null,
 received_at timestamptz not null default now()
);
create index billing_events_band on public.billing_events(band_id);
alter table public.band_billing enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.band_billing,public.billing_events from public,anon,authenticated;
grant select,insert,update,delete on public.band_billing,public.billing_events to service_role;

create or replace function public.apply_account_storage(b uuid) returns void
language plpgsql security definer set search_path=public as $$
declare allowance public.storage_account_overrides;
begin
 select o.* into allowance from public.storage_account_overrides o
 join public.band_memberships m on m.user_id=o.user_id
 where m.band_id=b and m.role='owner'
 order by o.storage_limit desc nulls first limit 1;
 if found then
  update public.entitlements set storage_limit=allowance.storage_limit,plan=allowance.plan where band_id=b and (storage_limit,plan) is distinct from (allowance.storage_limit,allowance.plan);
 elsif exists(select 1 from public.band_billing where band_id=b and livemode and has_plus
  and not review_required and period_end>now()) then
  update public.entitlements set storage_limit=26843545600,plan='plus' where band_id=b and (storage_limit,plan) is distinct from (26843545600::bigint,'plus'::text);
 else
  update public.entitlements set storage_limit=2147483648,plan='free'
   where band_id=b and plan in ('personal','plus');
 end if;
end$$;

create function public.billing_checkout_attempt(b uuid,period text,live boolean) returns uuid
language plpgsql security definer set search_path=public as $$
declare account public.band_billing; attempt uuid;
begin
 if period not in ('month','year') then raise exception 'BR:Choose monthly or annual billing';end if;
 perform 1 from public.bands where id=b and not billing_closing for update;
 if not found then raise exception 'BR:Workspace is closing. New checkout is unavailable.';end if;
 select * into account from public.band_billing where band_id=b and livemode=live for update;
 if not found then raise exception 'BR:Billing account unavailable';end if;
 if account.checkout_attempt is not null then
  if account.checkout_interval<>period then raise exception 'BR:Cancel the pending checkout before changing billing interval';end if;
  return account.checkout_attempt;
 end if;
 attempt=gen_random_uuid();
 update public.band_billing set checkout_attempt=attempt,checkout_interval=period where band_id=b and livemode=live;
 return attempt;
end$$;
create function public.store_billing_checkout(b uuid,live boolean,attempt uuid,session text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.bands where id=b and not billing_closing for update;
 if not found then return false;end if;
 update public.band_billing set checkout_session_id=session
  where band_id=b and livemode=live and checkout_attempt=attempt;
 return found;
end$$;
revoke execute on function public.store_billing_checkout(uuid,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.store_billing_checkout(uuid,boolean,uuid,text) to service_role;

create function public.sync_band_billing(customer text,subscription text,state text,price text,
 through timestamptz,cancels boolean,plus boolean,observed timestamptz,
 event_id text,event_kind text,review boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare account public.band_billing;
begin
 select * into account from public.band_billing where customer_id=customer for update;
 if not found then return;end if;
 if event_id is not null then
  insert into public.billing_events(id,band_id,kind) values(event_id,account.band_id,event_kind)
   on conflict do nothing;
  if not found then return;end if;
 end if;
 -- Risk holds survive ordinary renewals and require an operator's review.
 update public.band_billing set review_required=review_required or review,
  risk_event_id=case when review then event_id else risk_event_id end
  where band_id=account.band_id and livemode=account.livemode;
 if account.checked_at is null or observed>=account.checked_at then
  update public.band_billing set subscription_id=subscription,status=state,price_id=price,
   period_end=through,cancel_at_period_end=cancels,has_plus=plus,checked_at=observed
   where band_id=account.band_id and livemode=account.livemode;
 end if;
 perform public.apply_account_storage(account.band_id);
end$$;
create function public.resolve_billing_review(b uuid,live boolean,reviewed_event text) returns void
language plpgsql security definer set search_path=public as $$
begin
 update public.band_billing set review_required=false
  where band_id=b and livemode=live and risk_event_id=reviewed_event and review_required;
 if not found then raise exception 'BR:Billing review changed. Refresh and inspect the latest event.';end if;
 perform public.apply_account_storage(b);
end$$;
revoke execute on function public.resolve_billing_review(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.resolve_billing_review(uuid,boolean,text) to service_role;
revoke execute on function public.billing_checkout_attempt(uuid,text,boolean),
 public.sync_band_billing(text,text,text,text,timestamptz,boolean,boolean,timestamptz,text,text,boolean)
 from public,anon,authenticated;
grant execute on function public.billing_checkout_attempt(uuid,text,boolean),
 public.sync_band_billing(text,text,text,text,timestamptz,boolean,boolean,timestamptz,text,text,boolean)
 to service_role;
-- Enforce expiry at every storage reservation, including direct authenticated RPCs.
create or replace function public.reserve_upload(b uuid,s uuid,a uuid,reservation uuid,file_name text,file_bytes bigint,file_duration double precision,file_rate integer,asset_source text) returns public.audio_assets language plpgsql security definer set search_path=public as $$declare u public.band_usage;e public.entitlements;asset public.audio_assets;k text;bucket_name text;reserve_bytes bigint;begin if not public.band_permission(b,array['owner','admin','editor']::public.band_role[]) then raise exception 'BR:Editor permission required';end if;perform public.take_request('audio.upload',60);select * into u from public.band_usage where band_id=b for update;perform public.apply_account_storage(b);select * into e from public.entitlements where band_id=b;select * into asset from public.audio_assets where id=a;if found then if asset.band_id<>b or asset.song_id<>s then raise exception 'BR:Conflicting upload';end if;return asset;end if;if not exists(select 1 from public.songs where id=s and band_id=b) then raise exception 'BR:Song missing';end if;if asset_source='import' and (select count(*) from public.audio_assets where song_id=s and source='import' and status<>'deleting')>=24 then raise exception 'BR:Maximum 24 imported stems';end if;if file_bytes<=0 or file_bytes>e.file_limit or file_duration<=0 or file_duration>7200 or file_rate not between 8000 and 192000 then raise exception 'BR:Invalid audio size or metadata';end if;bucket_name=case when asset_source='original' then 'originals' else 'temporary' end;select file_size_limit into reserve_bytes from storage.buckets where id=bucket_name;reserve_bytes=greatest(file_bytes,coalesce(reserve_bytes,e.file_limit));if u.stored_bytes+u.reserved_bytes+reserve_bytes>e.storage_limit then raise exception 'BR:Storage allowance exceeded';end if;bucket_name=case when asset_source='original' then 'originals' else 'temporary' end;k='bands/'||b||'/songs/'||s||'/'||a||'/'||regexp_replace(left(file_name,100),'[^a-zA-Z0-9_.-]','_','g');insert into public.audio_assets(id,band_id,song_id,bucket,object_key,filename,bytes,duration,sample_rate,source) values(a,b,s,bucket_name,k,left(file_name,100),file_bytes,file_duration,file_rate,asset_source) returning * into asset;insert into public.storage_reservations(id,band_id,song_id,user_id,asset_id,bytes) values(reservation,b,s,auth.uid(),a,reserve_bytes);update public.band_usage set reserved_bytes=reserved_bytes+reserve_bytes,updated_at=now() where band_id=b;return asset;end$$;

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
 reserve=ceil(a.duration)::bigint*44100*6*4+1048576;
 if u.stored_bytes+u.reserved_bytes+reserve>e.storage_limit then raise exception 'BR:Not enough space for four lossless stems';end if;
 insert into public.processing_jobs(id,band_id,song_id,input_asset_id,created_by,idempotency_key,duration_seconds,output_reserved_bytes) values(job,b,s,input,auth.uid(),idem,ceil(a.duration),reserve) returning * into j;
 update public.band_usage set reserved_bytes=reserved_bytes+reserve where band_id=b;insert into public.processing_usage(job_id,band_id,month,seconds,state) values(job,b,date_trunc('month',now())::date,ceil(a.duration),'reserved');return j;
end$$;

create or replace function public.retry_separation(job uuid) returns public.processing_jobs language plpgsql security definer set search_path=public as $$declare j public.processing_jobs;e public.entitlements;u public.band_usage;c public.platform_config;monthly bigint;global_used bigint;begin select * into j from public.processing_jobs where id=job for update;if not public.band_permission(j.band_id,array['owner','admin','editor']::public.band_role[]) or j.status<>'failed' or j.attempt>=j.max_attempts then raise exception 'BR:Retry unavailable';end if;if not exists(select 1 from public.audio_assets where id=j.input_asset_id and status='verified') then raise exception 'BR:Original is unavailable or invalid. Upload a decodable recording to create a new job.';end if;select * into c from public.platform_config where id=true for update;if not c.ai_enabled then raise exception 'BR:AI disabled';end if;select * into u from public.band_usage where band_id=j.band_id for update;perform public.apply_account_storage(j.band_id);select * into e from public.entitlements where band_id=j.band_id;if u.stored_bytes+u.reserved_bytes+j.output_reserved_bytes>e.storage_limit or (select count(*) from public.processing_jobs where band_id=j.band_id and status in ('queued','processing'))>=20 then raise exception 'BR:Storage allowance or queue limit reached';end if;select coalesce(sum(seconds),0) into monthly from public.processing_usage where band_id=j.band_id and month=date_trunc('month',now())::date and state in ('consumed','reserved');select coalesce(sum(seconds),0) into global_used from public.processing_usage where month=date_trunc('month',now())::date and state in ('consumed','reserved');if monthly+(case when exists(select 1 from public.processing_usage where job_id=job and state='consumed') then 0 else j.duration_seconds end)>e.ai_monthly_seconds or global_used+(case when exists(select 1 from public.processing_usage where job_id=job and state='consumed') then 0 else j.duration_seconds end)>c.monthly_ai_seconds_cap then raise exception 'BR:Processing allowance reached';end if;update public.processing_jobs set status='queued',error=null,lease_hash=null,updated_at=now() where id=job returning * into j;update public.band_usage set reserved_bytes=reserved_bytes+j.output_reserved_bytes where band_id=j.band_id;update public.processing_usage set state='reserved',month=date_trunc('month',now())::date where job_id=job and state='released';return j;end$$;

create or replace function public.request_export(job uuid) returns public.export_jobs language plpgsql security definer set search_path=public as $$declare j public.processing_jobs;x public.export_jobs;u public.band_usage;e public.entitlements;n bigint;begin
 select * into j from public.processing_jobs where id=job;if j.status<>'completed' or not public.band_permission(j.band_id,array['owner','admin','editor']::public.band_role[]) then raise exception 'BR:Export permission denied';end if;
 select * into u from public.band_usage where band_id=j.band_id for update;select * into x from public.export_jobs where processing_job_id=job for update;if found and x.status in ('queued','processing','completed') then return x;end if;
 perform public.apply_account_storage(j.band_id);select * into e from public.entitlements where band_id=j.band_id;select coalesce(sum((v->>'bytes')::bigint),0)+65536 into n from jsonb_array_elements(j.results)v;if u.stored_bytes+u.reserved_bytes+n>e.storage_limit then raise exception 'BR:Not enough space for temporary ZIP. Download individual stems instead.';end if;
 insert into public.export_jobs(band_id,processing_job_id,reserved_bytes)values(j.band_id,job,n) on conflict(processing_job_id) do update set status='queued',error=null,reserved_bytes=n,bytes=0,attempt=0,expires_at=now()+interval '24 hours' returning * into x;update public.band_usage set reserved_bytes=reserved_bytes+n where band_id=j.band_id;return x;end$$;
create or replace function public.delete_band(b uuid) returns void language plpgsql security definer set search_path=public as $$begin if not public.band_owner(b) then raise exception 'BR:Only the owner can delete a band';end if;insert into public.audit_events(actor_id,action,details) values(auth.uid(),'band.deleted',jsonb_build_object('band',b));if exists(select 1 from public.band_billing where band_id=b) and not exists(select 1 from public.bands where id=b and billing_closed) then raise exception 'BR:Cancel billing through the app before deleting this workspace';end if;delete from public.songs where band_id=b;delete from public.bands where id=b;end$$;
commit;
