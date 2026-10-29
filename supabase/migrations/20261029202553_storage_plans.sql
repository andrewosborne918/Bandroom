begin;
-- NULL is an unlimited storage allowance. Existing quota checks use >, so only
-- this storage ceiling is bypassed; file, processing, queue and role limits remain.
alter table public.entitlements alter column storage_limit drop not null;
alter table public.entitlements alter column plan set default 'free';
update public.entitlements set plan='free' where plan='beta';

-- Only the service role can grant account allowances. An allowance follows the
-- account's owned workspaces, and is never copied from user-editable metadata.
create table public.storage_account_overrides(
 user_id uuid primary key references auth.users(id) on delete cascade,
 storage_limit bigint check(storage_limit is null or storage_limit>0),
 plan text not null check(plan='personal'),
 created_at timestamptz not null default now(),
 check(storage_limit is null)
);
alter table public.storage_account_overrides enable row level security;
revoke all on public.storage_account_overrides from public,anon,authenticated;
grant select,insert,update,delete on public.storage_account_overrides to service_role;

create function public.apply_account_storage(b uuid) returns void
language plpgsql security definer set search_path=public as $$
declare allowance public.storage_account_overrides;
begin
 select o.* into allowance from public.storage_account_overrides o
 join public.band_memberships m on m.user_id=o.user_id
 where m.band_id=b and m.role='owner'
 order by o.storage_limit desc nulls first limit 1;
 if found then
  update public.entitlements set storage_limit=allowance.storage_limit,plan=allowance.plan where band_id=b;
 else
  update public.entitlements set storage_limit=2147483648,plan='free'
   where band_id=b and plan='personal';
 end if;
end$$;

create function public.refresh_band_storage() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='DELETE' then perform public.apply_account_storage(old.band_id);
 else perform public.apply_account_storage(new.band_id);end if;
 return null;
end$$;
create trigger storage_on_band_creation after insert on public.entitlements
 for each row execute function public.refresh_band_storage();
create trigger storage_on_ownership_change after insert or update or delete on public.band_memberships
 for each row execute function public.refresh_band_storage();

create function public.refresh_account_storage() returns trigger
language plpgsql security definer set search_path=public as $$
declare b uuid; old_user uuid; new_user uuid;
begin
 if tg_op<>'INSERT' then old_user=old.user_id;end if;
 if tg_op<>'DELETE' then new_user=new.user_id;end if;
 for b in select band_id from public.band_memberships
  where user_id in (old_user,new_user) and role='owner' order by band_id loop
  perform public.apply_account_storage(b);
 end loop;
 return null;
end$$;
create trigger storage_on_account_allowance after insert or update or delete on public.storage_account_overrides
 for each row execute function public.refresh_account_storage();
revoke execute on function public.apply_account_storage(uuid),public.refresh_band_storage(),public.refresh_account_storage() from public,anon,authenticated;
grant execute on function public.apply_account_storage(uuid),public.refresh_band_storage(),public.refresh_account_storage() to service_role;
commit;
