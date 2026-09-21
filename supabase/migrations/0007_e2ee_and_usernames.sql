-- Usernames, E2EE identities, room keyring, direct rooms, and message payloads.
--
-- Hybrid E2EE: each profile owns an RSA-OAEP keypair. The private key never
-- leaves the client unencrypted. Email/password accounts wrap it with an
-- AES-GCM key derived (PBKDF2) from their password, so the same password
-- unlocks it on any device; social logins keep a device-bound copy. Each room
-- has an AES-GCM key stored once per member in room_keys, wrapped with that
-- member's public key. Messages store an iv + ciphertext instead of plaintext.

-- ---------------------------------------------------------------------------
-- Profiles: identity key material and guaranteed-unique usernames
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists public_key text,
  add column if not exists key_salt text,
  add column if not exists encrypted_private_key text;

create unique index if not exists profiles_username_unique
  on public.profiles (username);

-- ---------------------------------------------------------------------------
-- Permissions helper for room management (defined before the keyring policies)
-- ---------------------------------------------------------------------------

create or replace function public.is_room_admin(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_members.room_id = target_room_id
      and room_members.user_id = auth.uid()
      and room_members.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_room_admin(uuid) from public, anon;
grant execute on function public.is_room_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Room keys: per-member wrapped copies of each room's AES key
-- ---------------------------------------------------------------------------

create table if not exists public.room_keys (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  wrapped_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_keys enable row level security;

create policy "Users can read their own room keys"
  on public.room_keys for select
  to authenticated
  using (user_id = auth.uid());

create policy "Room managers can share keys with members"
  on public.room_keys for insert
  to authenticated
  with check (
    public.is_room_admin(room_id)
    and exists (
      select 1 from public.room_members as target
      where target.room_id = room_keys.room_id
        and target.user_id = room_keys.user_id
    )
  );

create policy "Users can update their own room key"
  on public.room_keys for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete their own room key"
  on public.room_keys for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Messages: encrypted payload columns replacing the plaintext-only check
-- ---------------------------------------------------------------------------

alter table public.messages
  drop constraint if exists messages_body_present,
  add column if not exists iv text,
  add column if not exists ciphertext text;

create or replace function public.validate_message_payload()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is not null then
    return new;
  end if;

  if new.ciphertext is null or new.iv is null then
    -- Plaintext path (legacy/verification): body required.
    if new.body is null or char_length(trim(new.body)) = 0 then
      raise exception 'Message needs a body or an encrypted payload';
    end if;
    if char_length(new.body) > 4000 then
      raise exception 'Message body too long';
    end if;
  else
    if char_length(new.ciphertext) < 16 then
      raise exception 'Encrypted payload too small';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_message_payload on public.messages;
create trigger validate_message_payload
before insert or update on public.messages
for each row execute procedure public.validate_message_payload();

-- ---------------------------------------------------------------------------
-- Permissions helper for room management
-- ---------------------------------------------------------------------------

create or replace function public.is_room_admin(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_members.room_id = target_room_id
      and room_members.user_id = auth.uid()
      and room_members.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_room_admin(uuid) from public, anon;
grant execute on function public.is_room_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Permissions helper for room management
-- ---------------------------------------------------------------------------

create or replace function public.is_room_admin(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_members.room_id = target_room_id
      and room_members.user_id = auth.uid()
      and room_members.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_room_admin(uuid) from public, anon;
grant execute on function public.is_room_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Direct rooms: a private two-person room, reused if one already exists
-- ---------------------------------------------------------------------------

create or replace function public.create_direct_room(other_user_id uuid)
returns table (
  id uuid,
  name text,
  room_type text,
  last_message_at timestamptz,
  created_at timestamptz,
  other_username text,
  other_display_name text,
  other_public_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  found uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  if other_user_id is null or other_user_id = me then
    raise exception 'Invalid user';
  end if;

  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found';
  end if;

  select r.id into found
  from public.rooms r
  join public.room_members a on a.room_id = r.id and a.user_id = me
  join public.room_members b on b.room_id = r.id and b.user_id = other_user_id
  where r.room_type = 'direct'
  order by r.created_at asc
  limit 1;

  if found is null then
    insert into public.rooms (name, room_type, created_by)
    values (
      coalesce((select display_name from public.profiles where id = other_user_id), 'Direct'),
      'direct',
      me
    )
    returning id into found;

    insert into public.room_members (room_id, user_id, role) values
      (found, me, 'owner'),
      (found, other_user_id, 'member');
  end if;

  return query
    select r.id, r.name, r.room_type, r.last_message_at, r.created_at,
           p.username, p.display_name, p.public_key
    from public.rooms r
    join public.profiles p on p.id = other_user_id
    where r.id = found;
end;
$$;

revoke all on function public.create_direct_room(uuid) from public, anon;
grant execute on function public.create_direct_room(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Add a member to an existing room (owner/admin only), for sharing keys later
-- ---------------------------------------------------------------------------

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
  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (room_id, other_user_id, coalesce(member_role, 'member'))
  on conflict (room_id, user_id) do nothing;
end;
$$;

revoke all on function public.add_room_member(uuid, uuid, text) from public, anon;
grant execute on function public.add_room_member(uuid, uuid, text) to authenticated;