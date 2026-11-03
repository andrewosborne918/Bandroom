-- Preserve existing co-controller permissions during coordinated starts.
create or replace function public.start_prepared_audio(session uuid,run text) returns void language plpgsql security definer set search_path=public as $$
declare p public.playback_sessions;begin
 select * into p from public.playback_sessions where id=session for update;
 if p.expires_at<now() or p.data->'transport'->>'status'<>'preparing' or p.data->'transport'->>'run' is distinct from run then return;end if;
 if not exists(select 1 from public.session_devices d join public.band_memberships m on m.band_id=p.band_id and m.user_id=d.user_id where d.session_id=session and d.last_seen>now()-interval '30 seconds' and (d.user_id=p.leader_id or exists(select 1 from public.session_controllers c where c.session_id=session and c.user_id=d.user_id))) then return;end if;
 if exists(select 1 from public.session_devices where session_id=session and last_seen>now()-interval '30 seconds' and (not ready or song_id is distinct from (p.data->>'songId')::uuid or ready_run is distinct from run or clock_error_ms is null or clock_error_ms>100)) then return;end if;
 update public.playback_sessions set data=jsonb_set(jsonb_set(data,'{transport,status}','"playing"'),'{transport,startAt}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)+3000+((data->'transport'->>'countIn')::numeric*1000))),revision=revision+1 where id=session;
end$$;
