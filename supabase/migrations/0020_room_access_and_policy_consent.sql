-- Remove direct self-service room membership writes. Room membership is
-- granted only through the SECURITY DEFINER room-creation and invite RPCs.
drop policy if exists "Users can join rooms as themselves" on public.room_members;
revoke insert on public.room_members from anon, authenticated;

create or replace function public.add_room_member(room_id uuid, other_user_id uuid, member_role text default 'member')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_room_admin(room_id) then
    raise exception 'Not authorized';
  end if;
  if coalesce(member_role, 'member') <> 'member' then
    raise exception 'Invited members must be assigned the member role';
  end if;
  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (room_id, other_user_id, 'member')
  on conflict (room_id, user_id) do nothing;
end;
$$;

revoke all on function public.add_room_member(uuid, uuid, text) from public, anon;
grant execute on function public.add_room_member(uuid, uuid, text) to authenticated;

create table if not exists public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  acceptance_method text not null check (acceptance_method in ('email_otp', 'google_oauth')),
  accepted_at timestamptz not null default now(),
  unique (user_id, terms_version, privacy_version)
);

alter table public.policy_acceptances enable row level security;
drop policy if exists "Users can view their policy acceptances" on public.policy_acceptances;
create policy "Users can view their policy acceptances"
  on public.policy_acceptances for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.policy_acceptances from anon, authenticated;
grant select on public.policy_acceptances to authenticated;

create or replace function public.record_policy_acceptance(
  accepted_terms_version text,
  accepted_privacy_version text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  accepting_user_id uuid := auth.uid();
  provider text := coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', 'email');
begin
  if accepting_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if accepted_terms_version <> '2026-10-17'
    or accepted_privacy_version <> '2026-10-17' then
    raise exception 'Unsupported policy version';
  end if;

  insert into public.policy_acceptances (
    user_id, terms_version, privacy_version, acceptance_method
  )
  values (
    accepting_user_id,
    accepted_terms_version,
    accepted_privacy_version,
    case when provider = 'google' then 'google_oauth' else 'email_otp' end
  )
  on conflict (user_id, terms_version, privacy_version) do nothing;
end;
$$;

revoke all on function public.record_policy_acceptance(text, text) from public, anon;
grant execute on function public.record_policy_acceptance(text, text) to authenticated;

create or replace function public.prevent_message_identity_changes()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
    or new.room_id is distinct from old.room_id
    or new.sender_id is distinct from old.sender_id
    or new.reply_to_id is distinct from old.reply_to_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Message identity and routing fields cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_identity_immutable on public.messages;
create trigger messages_identity_immutable
before update on public.messages
for each row execute procedure public.prevent_message_identity_changes();

create or replace function public.prevent_post_identity_changes()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
    or new.author_id is distinct from old.author_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Post identity fields cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists social_posts_identity_immutable on public.social_posts;
create trigger social_posts_identity_immutable
before update on public.social_posts
for each row execute procedure public.prevent_post_identity_changes();
