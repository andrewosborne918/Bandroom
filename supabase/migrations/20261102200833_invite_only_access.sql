begin;
-- Only the existing personal account owner may admit new people.
create table public.invitation_owners(
 user_id uuid primary key references auth.users(id) on delete cascade deferrable initially deferred
);
alter table public.invitation_owners enable row level security;
revoke all on public.invitation_owners from public,anon,authenticated;
grant select,insert,update,delete on public.invitation_owners to service_role;
insert into public.invitation_owners(user_id)
 select distinct o.user_id from public.storage_account_overrides o
 join public.band_memberships m on m.user_id=o.user_id and m.role='owner'
 where o.plan='personal';
create function public.is_invitation_owner() returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.invitation_owners where user_id=auth.uid());
$$;
revoke execute on function public.is_invitation_owner() from public,anon;
grant execute on function public.is_invitation_owner() to authenticated,service_role;

create function public.require_invited_signup() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.invitation_owners where user_id=new.id)
 and not exists(select 1 from public.invitations i join public.invitation_owners o on o.user_id=i.created_by
  join public.bands b on b.id=i.band_id
  where i.email=lower(trim(new.email)) and i.expires_at>now()
   and i.accepted_at is null and i.declined_at is null and not b.suspended) then
  raise exception 'Bndrm is invite-only. Ask the owner for an invitation.';
 end if;
 return new;
end$$;
revoke execute on function public.require_invited_signup() from public,anon,authenticated;
create trigger require_invited_signup before insert on auth.users
 for each row execute function public.require_invited_signup();
create or replace function public.create_band(band_name text) returns uuid language plpgsql security definer set search_path=public as $$declare b uuid;begin if not public.is_invitation_owner() then raise exception 'BR:Only the app owner can create workspaces';end if;perform public.take_request('band.create',5);perform pg_advisory_xact_lock(hashtext(auth.uid()::text));if (select count(*) from public.band_memberships where user_id=auth.uid() and role='owner')>=5 then raise exception 'BR:Five owned workspaces maximum. Contact the app administrator.';end if;insert into public.bands(name) values(trim(band_name)) returning id into b;insert into public.band_memberships values(b,auth.uid(),'owner',now());insert into public.entitlements(band_id) values(b);insert into public.band_usage(band_id) values(b);insert into public.setlists(band_id) values(b);insert into public.audit_events(band_id,actor_id,action) values(b,auth.uid(),'band.created');return b;end$$;
create or replace function public.invite_member(b uuid,invite_email text,invite_role public.band_role,hash text) returns uuid language plpgsql security definer set search_path=public as $$declare i uuid;begin if not public.is_invitation_owner() or not public.band_permission(b,array['owner','admin']::public.band_role[]) or invite_role='owner' or (invite_role='admin' and not public.band_owner(b)) then raise exception 'BR:Invitation permission denied';end if;perform public.take_request('band.invite',30);update public.invitations set declined_at=now() where band_id=b and email=lower(trim(invite_email)) and accepted_at is null and declined_at is null;insert into public.invitations(band_id,email,role,token_hash,created_by) values(b,lower(trim(invite_email)),invite_role,hash,auth.uid()) returning id into i;insert into public.audit_events(band_id,actor_id,action,details) values(b,auth.uid(),'member.invited',jsonb_build_object('invitation',i));return i;end$$;
-- Existing members retain their workspaces. Uninvited accounts cannot create one.
commit;
