begin;
create table public.desktop_pairings (
 id uuid primary key default gen_random_uuid(), code_hash text unique not null, poll_hash text unique not null,
 name text not null, platform text not null, band_id uuid references public.bands(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade, device_id uuid,
 expires_at timestamptz not null default now()+interval '10 minutes', created_at timestamptz not null default now()
);
create table public.processor_devices (
 id uuid primary key default gen_random_uuid(), band_id uuid not null references public.bands(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, token_hash text unique not null,
 name text not null, platform text not null, created_at timestamptz not null default now(),
 revoked_at timestamptz, last_seen timestamptz, health jsonb not null default '{}'
);
create index processor_band on public.processor_devices(band_id) where revoked_at is null;
create table public.desktop_request_limits(ip_hash text not null,window_start timestamptz not null,hits integer not null,primary key(ip_hash,window_start));
alter table public.desktop_pairings enable row level security;
alter table public.processor_devices enable row level security;
alter table public.desktop_request_limits enable row level security;
revoke all on public.desktop_pairings,public.processor_devices,public.desktop_request_limits from public,anon,authenticated;
grant all on public.desktop_pairings,public.processor_devices,public.desktop_request_limits to service_role;

create function public.start_desktop_pair(ip_hash text,device_name text,device_platform text,poll_hash text,code_hash text) returns public.desktop_pairings language plpgsql security invoker set search_path=public as $$
declare hits_now integer; pair public.desktop_pairings;
begin
 insert into public.desktop_request_limits values(ip_hash,date_trunc('minute',now()),1)
 on conflict on constraint desktop_request_limits_pkey do update set hits=desktop_request_limits.hits+1 returning hits into hits_now;
 if hits_now>6 then raise exception 'BR:Too many connection requests. Wait a minute.';end if;
 delete from public.desktop_pairings where expires_at<now();delete from public.desktop_request_limits where window_start<now()-interval '1 day';
 insert into public.desktop_pairings(name,platform,poll_hash,code_hash) values(left(device_name,80),left(device_platform,30),poll_hash,code_hash) returning * into pair;return pair;
end$$;
create function public.approve_desktop_pair(code_hash text,b uuid,actor uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare pair public.desktop_pairings; d uuid;
begin
 if not exists(select 1 from public.band_memberships m join public.bands bb on bb.id=m.band_id where m.band_id=b and m.user_id=actor and m.role in ('owner','admin','editor') and not bb.suspended) then raise exception 'BR:Editor permission required';end if;
 select * into pair from public.desktop_pairings p where p.code_hash=approve_desktop_pair.code_hash and expires_at>now() for update;
 if not found or pair.device_id is not null then raise exception 'BR:Connection code expired or already used';end if;
 if (select count(*) from public.processor_devices where band_id=b and revoked_at is null)>=10 then raise exception 'BR:Remove an old processor before connecting another';end if;
 insert into public.processor_devices(band_id,user_id,token_hash,name,platform) values(b,actor,pair.poll_hash,pair.name,pair.platform) returning id into d;
 update public.desktop_pairings set band_id=b,user_id=actor,device_id=d where id=pair.id;return d;
end$$;
create function public.claim_desktop_job(hash text,b uuid) returns jsonb language plpgsql security invoker set search_path=public as $$declare v public.verification_tasks;j public.processing_jobs;a public.audio_assets;begin

 select * into v from public.verification_tasks where exists(select 1 from public.audio_assets aa join public.bands bb on bb.id=aa.band_id where aa.id=asset_id and aa.band_id=b and not bb.suspended) and (status='queued' or status='processing' and lease_expires_at<now()) and attempt<3 order by created_at for update skip locked limit 1;
 if found then update public.verification_tasks set status='processing',attempt=attempt+1,lease_hash=hash,lease_expires_at=now()+interval '5 minutes' where id=v.id;select * into a from public.audio_assets where id=v.asset_id;return jsonb_build_object('kind','verification','id',v.id,'asset',to_jsonb(a));end if;
 select p.* into j from public.processing_jobs p join public.audio_assets aa on aa.id=p.input_asset_id join public.bands bb on bb.id=p.band_id where p.band_id=claim_desktop_job.b and (p.status='queued' or p.status='processing' and p.lease_expires_at<now()) and p.attempt<p.max_attempts and aa.status='verified' and not bb.suspended and (select ai_enabled from public.platform_config where id=true) order by p.created_at for update of p skip locked limit 1;
 if found then update public.processing_jobs set status='processing',attempt=attempt+1,lease_hash=hash,lease_expires_at=now()+interval '10 minutes',updated_at=now() where id=j.id;update public.processing_usage set state='consumed' where job_id=j.id;select * into a from public.audio_assets where id=j.input_asset_id;return jsonb_build_object('kind','separation','id',j.id,'asset',to_jsonb(a),'band_id',j.band_id,'song_id',j.song_id,'max_seconds',j.duration_seconds);end if;return null;
end$$;
create function public.claim_desktop_export(hash text,b uuid) returns jsonb language plpgsql security invoker set search_path=public as $$declare x public.export_jobs;begin select * into x from public.export_jobs where band_id=b and exists(select 1 from public.bands bb where bb.id=b and not bb.suspended) and expires_at>now() and attempt<3 and (status='queued' or status='processing' and lease_expires_at<now()) for update skip locked limit 1;if not found then return null;end if;update public.export_jobs set status='processing',attempt=attempt+1,lease_hash=hash,lease_expires_at=now()+interval '10 minutes',object_key='bands/'||band_id||'/exports/'||id||'.zip' where id=x.id returning * into x;return to_jsonb(x);end$$;
revoke execute on function public.start_desktop_pair(text,text,text,text,text),public.approve_desktop_pair(text,uuid,uuid),public.claim_desktop_job(text,uuid),public.claim_desktop_export(text,uuid) from public,anon,authenticated;
grant execute on function public.start_desktop_pair(text,text,text,text,text),public.approve_desktop_pair(text,uuid,uuid),public.claim_desktop_job(text,uuid),public.claim_desktop_export(text,uuid) to service_role;
commit;
