begin;
-- Private, derived playback objects retain their source asset's access boundary.
create table public.audio_playbacks(
 asset_id uuid primary key references public.audio_assets(id) on delete cascade,
 band_id uuid not null references public.bands(id) on delete cascade,
 state text not null default 'queued' check(state in ('queued','processing','ready','failed')),
 attempts integer not null default 0,lease_hash text,lease_expires_at timestamptz,
 object_key text,bytes bigint not null default 0 check(bytes>=0),reserved_bytes bigint not null default 0 check(reserved_bytes>=0),
 error text,created_at timestamptz not null default now()
);
alter table public.audio_playbacks enable row level security;
revoke all on public.audio_playbacks from public,anon,authenticated;
grant all on public.audio_playbacks to service_role;
create index audio_playbacks_pending on public.audio_playbacks(band_id,created_at) where state in ('queued','processing');
create function public.queue_audio_playback() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.status='verified' and new.source<>'original' then insert into public.audio_playbacks(asset_id,band_id) values(new.id,new.band_id) on conflict do nothing;
 elsif new.status='deleting' then delete from public.audio_playbacks where asset_id=new.id;end if;return new;
end$$;
revoke execute on function public.queue_audio_playback() from public,anon,authenticated;
create trigger queue_audio_playback after insert or update of status on public.audio_assets for each row execute function public.queue_audio_playback();
create function public.cleanup_audio_playback() returns trigger language plpgsql security definer set search_path=public as $$begin
 if old.object_key is not null then insert into public.cleanup_jobs(band_id,bucket,object_key) values(old.band_id,'stems',old.object_key) on conflict(bucket,object_key) do nothing;end if;
 update public.band_usage set stored_bytes=greatest(0,stored_bytes-old.bytes),reserved_bytes=greatest(0,reserved_bytes-old.reserved_bytes) where band_id=old.band_id;return old;
end$$;
revoke execute on function public.cleanup_audio_playback() from public,anon,authenticated;
create trigger cleanup_audio_playback before delete on public.audio_playbacks for each row execute function public.cleanup_audio_playback();
create function public.claim_audio_playback(b uuid,hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.audio_playbacks;a public.audio_assets;u public.band_usage;lim bigint;reserve bigint;begin
 select * into u from public.band_usage where band_id=b for update;
 -- Expired attempts release reservations before another worker may claim them.
 update public.band_usage set reserved_bytes=greatest(0,reserved_bytes-coalesce((select sum(reserved_bytes) from public.audio_playbacks where band_id=b and state='processing' and lease_expires_at<now()),0)) where band_id=b;
 update public.audio_playbacks set state=case when attempts>=3 then 'failed' else 'queued' end,reserved_bytes=0,lease_hash=null where band_id=b and state='processing' and lease_expires_at<now();
 if exists(select 1 from public.audio_playbacks where band_id=b and state='processing') then return null;end if;
 select q.* into p from public.audio_playbacks q join public.audio_assets source_asset on source_asset.id=q.asset_id where q.band_id=b and q.state='queued' and source_asset.status='verified' order by q.created_at,q.asset_id limit 1 for update of q skip locked;
 if not found then return null;end if;select * into a from public.audio_assets where id=p.asset_id;
 reserve=ceil(a.duration*32000)::bigint+262144;select storage_limit into lim from public.entitlements where band_id=b;
 select * into u from public.band_usage where band_id=b;
 if u.stored_bytes+u.reserved_bytes+reserve>lim then update public.audio_playbacks set state='failed',error='Not enough storage for an optimized playback copy' where asset_id=p.asset_id;return null;end if;
 update public.audio_playbacks set state='processing',attempts=attempts+1,lease_hash=hash,lease_expires_at=now()+interval '10 minutes',reserved_bytes=reserve,object_key='bands/'||b||'/songs/'||a.song_id||'/'||a.id||'/playback-'||hash||'.bna',error=null where asset_id=p.asset_id returning * into p;
 update public.band_usage set reserved_bytes=reserved_bytes+reserve where band_id=b;
 return jsonb_build_object('id',p.asset_id,'kind','playback','filename',a.filename,'asset',to_jsonb(a),'reserved_bytes',reserve);
end$$;
create function public.finish_audio_playback(asset uuid,hash text,size bigint,job_error text default null) returns void language plpgsql security definer set search_path=public as $$
declare p public.audio_playbacks;begin
 select * into p from public.audio_playbacks where asset_id=asset for update;
 if p.state='ready' and p.lease_hash=hash then return;end if;
 if p.state<>'processing' or p.lease_hash is distinct from hash or p.lease_expires_at<now() or p.asset_id is null then raise exception 'BR:Stale playback job';end if;
 if job_error is null and (size<=0 or size>p.reserved_bytes) then raise exception 'BR:Playback exceeds reservation';end if;
 update public.band_usage set reserved_bytes=greatest(0,reserved_bytes-p.reserved_bytes),stored_bytes=stored_bytes+case when job_error is null then size else 0 end where band_id=p.band_id;
 update public.audio_playbacks set state=case when job_error is null then 'ready' else 'failed' end,bytes=case when job_error is null then size else 0 end,reserved_bytes=0,error=left(job_error,300) where asset_id=asset;
 if job_error is null then delete from public.cleanup_jobs where bucket='stems' and object_key=p.object_key;end if;
end$$;
revoke execute on function public.claim_audio_playback(uuid,text),public.finish_audio_playback(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.claim_audio_playback(uuid,text),public.finish_audio_playback(uuid,text,bigint,text) to service_role;
insert into public.audio_playbacks(asset_id,band_id) select id,band_id from public.audio_assets where status='verified' and source<>'original' on conflict do nothing;

-- A play request first prepares the exact requested position on every device.
alter table public.session_devices add column ready_run text;
alter table public.session_devices add column clock_error_ms double precision;
create function public.report_audio_ready(session uuid,device uuid,ready_state boolean,song uuid,run text,clock_error double precision) returns void language plpgsql security definer set search_path=public as $$begin
 if clock_error is null or clock_error<0 or clock_error>100 then ready_state=false;end if;
 update public.session_devices set ready=ready_state,song_id=song,ready_run=case when ready_state then left(run,80) else null end,clock_error_ms=clock_error,last_seen=now() where id=device and session_id=session and user_id=auth.uid() and public.session_access(session_id);
 if not found then raise exception 'BR:Device access denied';end if;
end$$;
create function public.start_prepared_audio(session uuid,run text) returns void language plpgsql security definer set search_path=public as $$
declare p public.playback_sessions;begin
 select * into p from public.playback_sessions where id=session for update;
 if p.expires_at<now() or p.data->'transport'->>'status'<>'preparing' or p.data->'transport'->>'run' is distinct from run then return;end if;
 if not exists(select 1 from public.session_devices where session_id=session and user_id=p.leader_id and last_seen>now()-interval '30 seconds') then return;end if;
 if exists(select 1 from public.session_devices where session_id=session and last_seen>now()-interval '30 seconds' and (not ready or song_id is distinct from (p.data->>'songId')::uuid or ready_run is distinct from run or clock_error_ms is null or clock_error_ms>100)) then return;end if;
 update public.playback_sessions set data=jsonb_set(jsonb_set(data,'{transport,status}','"playing"'),'{transport,startAt}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)+3000+((data->'transport'->>'countIn')::numeric*1000))),revision=revision+1 where id=session;
end$$;
revoke execute on function public.report_audio_ready(uuid,uuid,boolean,uuid,text,double precision) from public,anon;
grant execute on function public.report_audio_ready(uuid,uuid,boolean,uuid,text,double precision) to authenticated;
revoke execute on function public.start_prepared_audio(uuid,text) from public,anon,authenticated;
grant execute on function public.start_prepared_audio(uuid,text) to service_role;

create or replace function public.reconcile_usage(b uuid) returns void
language plpgsql security definer set search_path=public as $$
declare stored bigint; reserved bigint;
begin
 perform 1 from public.band_usage where band_id=b for update;
 select coalesce(sum(bytes),0) into stored from public.audio_assets
  where band_id=b and status='verified';
 select stored+coalesce(sum(bytes),0) into stored from public.export_jobs
  where band_id=b and status='completed';
 select stored+coalesce(sum(bytes),0) into stored from public.audio_playbacks where band_id=b and state='ready';
 -- Keep expired-but-unreleased uploads reserved until maintenance cancels them.
 select coalesce(sum(bytes),0) into reserved from public.storage_reservations
  where band_id=b and state='active';
 select reserved+coalesce(sum(output_reserved_bytes),0) into reserved
  from public.processing_jobs where band_id=b and status in ('queued','processing');
 select reserved+coalesce(sum(reserved_bytes),0) into reserved
  from public.export_jobs where band_id=b and status in ('queued','processing');
 select reserved+coalesce(sum(reserved_bytes),0) into reserved from public.audio_playbacks where band_id=b and state='processing';
 update public.band_usage set stored_bytes=stored,reserved_bytes=reserved,updated_at=now()
  where band_id=b;
end$$;

commit;
