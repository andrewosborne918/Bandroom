-- Keep the original default set; allow any number of non-default sets.
alter table public.setlists drop constraint setlists_band_id_is_default_key;
create unique index setlists_one_default on public.setlists(band_id) where is_default;
alter table public.setlists add column revision bigint not null default 1;
create index songs_band_catalog on public.songs(band_id,created_at,id);
create index session_devices_session_seen on public.session_devices(session_id,last_seen);

-- RLS stays enabled. Mutations use invoker permissions, never a service-role bypass.
grant insert on public.setlists to authenticated;
grant update(name,revision) on public.setlists to authenticated;
grant insert,update,delete on public.setlist_items to authenticated;
create policy setlists_edit on public.setlists for all to authenticated
 using(public.band_permission(band_id,array['owner','admin','editor']::public.band_role[]))
 with check(public.band_permission(band_id,array['owner','admin','editor']::public.band_role[]));
create policy set_items_edit on public.setlist_items for all to authenticated
 using(exists(select 1 from public.setlists s where s.id=setlist_id and public.band_permission(s.band_id,array['owner','admin','editor']::public.band_role[])))
 with check(exists(select 1 from public.setlists s where s.id=setlist_id and public.band_permission(s.band_id,array['owner','admin','editor']::public.band_role[]))
 and exists(select 1 from public.setlists s join public.songs song on song.band_id=s.band_id where s.id=setlist_id and song.id=song_id));

create function public.save_named_setlist(target uuid, expected bigint, title text, ids uuid[])
returns bigint language plpgsql security invoker set search_path='' as $$
declare list public.setlists; item uuid; n integer=0;
begin
 select * into list from public.setlists where id=target for update;
 if list.id is null or not public.band_permission(list.band_id,array['owner','admin','editor']::public.band_role[]) then raise exception 'BR:Editor permission required'; end if;
 if list.revision<>expected then raise exception 'BR:Setlist changed. Reload before saving.';end if;
 if length(trim(title)) not between 1 and 80 or cardinality(ids)>100 then raise exception 'BR:Use a name and at most 100 songs';end if;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'BR:Duplicate song';end if;
 foreach item in array ids loop
  if not exists(select 1 from public.songs where id=item and band_id=list.band_id) then raise exception 'BR:Song outside workspace';end if;
 end loop;
 update public.setlists set name=trim(title),revision=revision+1 where id=target;
 delete from public.setlist_items where setlist_id=target;
 foreach item in array ids loop insert into public.setlist_items values(target,item,n);n=n+1;end loop;
 return list.revision+1;
end $$;
revoke all on function public.save_named_setlist(uuid,bigint,text,uuid[]) from public,anon;
grant execute on function public.save_named_setlist(uuid,bigint,text,uuid[]) to authenticated;

-- A fixed-scope, checked gateway to the existing shared request limiter.
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;
create function private.admit_band_request(b uuid, scope text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.band_permission(b) then raise exception 'BR:Workspace access denied';end if;
 if scope='diagnostics' then perform public.take_request('band.diagnostics',120);
 elsif scope='read' then perform public.take_request('band.read',12000);
 elsif scope='write' then perform public.take_request('band.write',1200);
 else raise exception 'BR:Invalid request scope';end if;
end $$;
revoke all on function private.admit_band_request(uuid,text) from public,anon;
grant execute on function private.admit_band_request(uuid,text) to authenticated;
create function public.admit_band_request(b uuid, scope text) returns void
language sql security invoker set search_path='' as $$select private.admit_band_request(b,scope)$$;
revoke all on function public.admit_band_request(uuid,text) from public,anon;
grant execute on function public.admit_band_request(uuid,text) to authenticated;

create function public.song_catalog(b uuid, query text default '', skip integer default 0, take integer default 50)
returns table(id uuid,title text,artist text,bpm double precision,key text,duration double precision,stem_count integer,reviewed boolean)
language sql stable security invoker set search_path='' as $$
 select s.id,s.data->>'title',coalesce(s.data->>'artist',''),coalesce((s.data->>'bpm')::double precision,120),coalesce(s.data->>'key',''),coalesce((s.data->>'duration')::double precision,0),jsonb_array_length(coalesce(s.data->'stems','[]'::jsonb)),coalesce((s.data->'info'->>'playbackConfirmed')::boolean,false)
 from public.songs s where s.band_id=b and (query='' or strpos(lower(coalesce(s.data->>'title','')||' '||coalesce(s.data->>'artist','')),lower(left(query,100)))>0)
 order by s.created_at,s.id offset greatest(0,least(skip,100000)) limit greatest(1,least(take,101))
$$;
revoke all on function public.song_catalog(uuid,text,integer,integer) from public,anon;
grant execute on function public.song_catalog(uuid,text,integer,integer) to authenticated;

-- Older clients still write the default set through this RPC; bump its version too.
create or replace function public.replace_setlist(b uuid,ids uuid[]) returns void language plpgsql security definer set search_path=public as $$
declare list uuid;i uuid;n integer=0;
begin
 if not public.band_permission(b,array['owner','admin','editor']::public.band_role[]) then raise exception 'BR:Editor permission required';end if;
 if cardinality(ids)>100 then raise exception 'BR:Maximum 100 songs';end if;
 select id into list from public.setlists where band_id=b and is_default for update;
 delete from public.setlist_items where setlist_id=list;
 foreach i in array ids loop
  if not exists(select 1 from public.songs where id=i and band_id=b) then raise exception 'BR:Song outside workspace';end if;
  insert into public.setlist_items values(list,i,n);n=n+1;
 end loop;
 update public.setlists set revision=revision+1 where id=list;
end $$;
