begin;
create table public.export_jobs(id uuid primary key default gen_random_uuid(),band_id uuid not null references public.bands(id) on delete cascade,processing_job_id uuid unique not null references public.processing_jobs(id) on delete cascade,status public.job_state not null default 'queued',object_key text,lease_hash text,lease_expires_at timestamptz,error text,created_at timestamptz not null default now());
alter table public.export_jobs enable row level security;
create policy exports_read on public.export_jobs for select to authenticated using(public.band_permission(band_id));
grant select on public.export_jobs to authenticated;grant all on public.export_jobs to service_role;
-- Approved content is visible to members. Drafts and processing remain editable-role only.
drop policy band_read on public.songs;
create policy song_read on public.songs for select to authenticated using(public.band_permission(band_id) and (approved or public.band_permission(band_id,array['owner','admin','editor']::public.band_role[])));
drop policy band_read on public.invitations;
create policy invitation_admin_read on public.invitations for select to authenticated using(public.band_permission(band_id,array['owner','admin']::public.band_role[]));
drop policy band_read on public.processing_jobs;
create policy jobs_editor_read on public.processing_jobs for select to authenticated using(public.band_permission(band_id,array['owner','admin','editor']::public.band_role[]));
-- Keep revoked membership from retaining leadership rights through a deleted auth account.
alter table public.playback_sessions drop constraint playback_sessions_leader_id_fkey;
alter table public.playback_sessions add constraint playback_sessions_leader_id_fkey foreign key(leader_id) references auth.users(id) on delete cascade;
-- Finish validates actual metadata against reservations, including duration (declared client metadata is untrusted).
create function public.guard_verified_metadata() returns trigger language plpgsql set search_path=public as $$begin if old.status='pending' and new.status='verified' and (new.duration>old.duration+1 or new.sample_rate not between 8000 and 192000) then raise exception 'BR:Audio metadata differs from the reserved input';end if;return new;end$$;
create trigger verified_metadata before update on public.audio_assets for each row execute function public.guard_verified_metadata();
-- Audit direct song edits without including lyrics or audio content in logs.
create function public.audit_song_edit() returns trigger language plpgsql security definer set search_path=public as $$begin insert into public.audit_events(band_id,actor_id,action,details) values(coalesce(new.band_id,old.band_id),auth.uid(),'song.'||lower(TG_OP),jsonb_build_object('song',coalesce(new.id,old.id)));return coalesce(new,old);end$$;
create trigger song_audit after insert or update or delete on public.songs for each row execute function public.audit_song_edit();
revoke execute on function public.guard_verified_metadata(),public.audit_song_edit() from public,anon,authenticated;
grant execute on function public.guard_verified_metadata(),public.audit_song_edit() to service_role;
commit;

begin;
create function public.reconcile_usage(b uuid) returns void language plpgsql security definer set search_path=public as $$declare total bigint;begin perform 1 from public.band_usage where band_id=b for update;select coalesce(sum(bytes),0) into total from public.audio_assets where band_id=b and status='verified';update public.band_usage set stored_bytes=total,updated_at=now() where band_id=b;end$$;
create function public.record_authorized_download(b uuid,size bigint) returns void language plpgsql security definer set search_path=public as $$begin update public.band_usage set downloaded_bytes=downloaded_bytes+greatest(0,size) where band_id=b;end$$;
revoke execute on function public.reconcile_usage(uuid),public.record_authorized_download(uuid,bigint) from public,anon,authenticated;
grant execute on function public.reconcile_usage(uuid),public.record_authorized_download(uuid,bigint) to service_role;
commit;
