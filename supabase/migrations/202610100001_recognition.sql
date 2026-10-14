begin;
create table public.recognition_scans(id uuid primary key default gen_random_uuid(),band_id uuid not null,song_id uuid not null,sample_hash text not null,status text not null default 'processing' check(status in ('processing','matched','not_found','failed')),result jsonb,attempt integer not null default 1,lease text,lease_until timestamptz,updated_at timestamptz not null default now(),foreign key(song_id,band_id) references public.songs(id,band_id) on delete cascade,unique(song_id,sample_hash));
create table public.recognition_usage(scope text primary key,calls integer not null default 0);
alter table public.recognition_scans enable row level security;
alter table public.recognition_usage enable row level security;
create policy recognition_read on public.recognition_scans for select to authenticated using(public.band_permission(band_id,array['owner','admin','editor']::public.band_role[]));
grant select on public.recognition_scans to authenticated;
grant all on public.recognition_scans,public.recognition_usage to service_role;
create function public.claim_recognition(b uuid,s uuid,acting_user uuid,hash text,lease_token text,retry boolean,global_cap integer) returns jsonb language plpgsql security definer set search_path=public as $$declare x public.recognition_scans;sc text;cap integer;n integer;begin
 if not exists(select 1 from public.band_memberships m join public.bands band on band.id=m.band_id where m.band_id=b and m.user_id=acting_user and m.role in ('owner','admin','editor') and not band.suspended) or not exists(select 1 from public.songs where id=s and band_id=b) then raise exception 'BR:Song access denied';end if;
 perform pg_advisory_xact_lock(hashtext('recognition-claims'));
 select * into x from public.recognition_scans where song_id=s and sample_hash=hash for update;
 if found and (x.status in ('matched','not_found') or x.status='processing' and x.lease_until>now() or x.status='failed' and not retry) then return to_jsonb(x)||jsonb_build_object('claimed',false);end if;
 if found and x.attempt>=3 then raise exception 'BR:Recognition retry limit reached. Enter song information manually.';end if;
 for sc,cap in select 'global:'||to_char(now(),'YYYY-MM'),greatest(0,least(global_cap,100000)) union all select 'band:'||b||':'||to_char(now(),'YYYY-MM'),200 union all select 'user:'||acting_user||':'||to_char(now(),'YYYY-MM-DD-HH24'),20 loop
 insert into public.recognition_usage values(sc,1) on conflict(scope) do update set calls=recognition_usage.calls+1 returning calls into n;if n>cap then raise exception 'BR:Song recognition allowance reached. Enter information manually or try later.';end if;end loop;
 insert into public.recognition_scans(band_id,song_id,sample_hash,lease,lease_until)values(b,s,hash,lease_token,now()+interval '2 minutes') on conflict(song_id,sample_hash) do update set status='processing',result=null,attempt=recognition_scans.attempt+1,lease=lease_token,lease_until=now()+interval '2 minutes',updated_at=now() returning * into x;return to_jsonb(x)||jsonb_build_object('claimed',true);
end$$;
revoke execute on function public.claim_recognition(uuid,uuid,uuid,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.claim_recognition(uuid,uuid,uuid,text,text,boolean,integer) to service_role;
commit;
