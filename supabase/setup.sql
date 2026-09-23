-- EchoRooms complete database setup (idempotent).
--
-- Paste this whole file into the Supabase SQL editor of a project, then copy
-- the project URL and anon key into .env as VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY.
--
-- This consolidates migrations 0001-0007 in order and can be run more than
-- once. It is the fast path for a fresh/paused project; the per-migration files
-- in supabase/migrations/ remain the source of truth for incremental changes.

-- ===========================================================================
-- 0001: Identity and rooms
-- ===========================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default '',
  avatar_path text,
  status_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  room_type text not null default 'group' check (room_type in ('direct', 'group')),
  created_by uuid not null references public.profiles(id),
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

drop policy if exists "Users can view profiles" on public.profiles;
create policy "Users can view profiles"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Users can create rooms" on public.rooms;
create policy "Users can create rooms"
  on public.rooms for insert
  to authenticated
  with check (auth.uid() = created_by);

drop policy if exists "Users can join rooms as themselves" on public.room_members;
create policy "Users can join rooms as themselves"
  on public.room_members for insert
  to authenticated
  with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ===========================================================================
-- 0002: Account deletion
-- ===========================================================================

alter table public.rooms
  drop constraint if exists rooms_created_by_fkey,
  add constraint rooms_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete cascade;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ===========================================================================
-- 0003: create_room RPC
-- ===========================================================================

create or replace function public.create_room(room_name text)
returns table (
  id uuid,
  name text,
  room_type text,
  last_message_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if room_name is null or char_length(trim(room_name)) not between 1 and 80 then
    raise exception 'Room name must be between 1 and 80 characters';
  end if;

  insert into public.rooms (name, room_type, created_by)
  values (trim(room_name), 'group', auth.uid())
  returning * into new_room;

  insert into public.room_members (room_id, user_id, role)
  values (new_room.id, auth.uid(), 'owner');

  return query
    select new_room.id, new_room.name, new_room.room_type,
      new_room.last_message_at, new_room.created_at;
end;
$$;

revoke all on function public.create_room(text) from public;
grant execute on function public.create_room(text) to authenticated;

-- ===========================================================================
-- 0004: Profile timestamps and avatar storage
-- ===========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Authenticated users can view avatars" on storage.objects;
create policy "Authenticated users can view avatars"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

-- ===========================================================================
-- 0005: Messaging
-- ===========================================================================

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  reply_to_id uuid references public.messages(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_body_present
    check (body is not null and char_length(trim(body)) between 1 and 4000)
);

create index if not exists messages_room_created_idx
  on public.messages (room_id, created_at desc);

alter table public.messages enable row level security;

create or replace function public.touch_room_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rooms
  set last_message_at = new.created_at
  where id = new.room_id;
  return new;
end;
$$;

drop trigger if exists on_message_created on public.messages;
create trigger on_message_created
after insert on public.messages
for each row execute procedure public.touch_room_last_message();

alter table public.messages replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end;
$$;

-- ===========================================================================
-- 0006: Break room_members RLS recursion
-- ===========================================================================

-- Soft-delete for rooms (dissolve) and per-member chat deletion.
alter table public.rooms
  add column if not exists deleted_at timestamptz;
alter table public.room_members
  add column if not exists deleted_at timestamptz;

create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members rm
    join public.rooms r on r.id = rm.room_id
    where rm.room_id = target_room_id
      and rm.user_id = auth.uid()
      and (r.deleted_at is null or r.created_by = auth.uid())
  );
$$;

revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;

drop policy if exists "Members can view their rooms" on public.rooms;
create policy "Members can view their rooms"
  on public.rooms for select
  to authenticated
  using (public.is_room_member(id));

drop policy if exists "Members can view room membership" on public.room_members;
create policy "Members can view room membership"
  on public.room_members for select
  to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "Members can view room messages" on public.messages;
create policy "Members can view room messages"
  on public.messages for select
  to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "Members can send messages as themselves" on public.messages;
create policy "Members can send messages as themselves"
  on public.messages for insert
  to authenticated
  with check (sender_id = auth.uid() and public.is_room_member(room_id));

drop policy if exists "Senders can edit their own messages" on public.messages;
create policy "Senders can edit their own messages"
  on public.messages for update
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

drop policy if exists "Senders can delete their own messages" on public.messages;
create policy "Senders can delete their own messages"
  on public.messages for delete
  to authenticated
  using (sender_id = auth.uid());

-- ===========================================================================
-- 0007: Usernames, E2EE identities, room keyring, direct rooms
-- ===========================================================================

-- Profiles: identity key material and guaranteed-unique usernames.
alter table public.profiles
  add column if not exists public_key text,
  add column if not exists key_salt text,
  add column if not exists encrypted_private_key text;

create unique index if not exists profiles_username_unique
  on public.profiles (username);

-- Permissions helper for room management (must exist before the keyring policy).
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

-- Room keys: per-member wrapped copies of each room's AES key.
create table if not exists public.room_keys (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  wrapped_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_keys enable row level security;

drop policy if exists "Users can read their own room keys" on public.room_keys;
create policy "Users can read their own room keys"
  on public.room_keys for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Room managers can share keys with members" on public.room_keys;
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

drop policy if exists "Users can update their own room key" on public.room_keys;
create policy "Users can update their own room key"
  on public.room_keys for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their own room key" on public.room_keys;
create policy "Users can delete their own room key"
  on public.room_keys for delete
  to authenticated
  using (user_id = auth.uid());

-- Messages: encrypted payload columns replacing the plaintext-only check.
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

-- Direct rooms: a private two-person room, reused if one already exists.
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
      left(
        coalesce(
          nullif(trim((select display_name from public.profiles where id = other_user_id)), ''),
          (select username from public.profiles where id = other_user_id),
          'Direct'
        ),
        80
      ),
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

-- Add a member to an existing room (owner/admin only), for sharing keys later.
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

-- ===========================================================================
-- 0009: Dissolve / delete a room or chat, and restore it back
-- ===========================================================================

-- Dissolve a room for everyone (owner/admin only); restorable by owner/admin.
create or replace function public.dissolve_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_room_admin(target_room_id) then
    raise exception 'Not authorized';
  end if;
  update public.rooms
  set deleted_at = now()
  where id = target_room_id;
end;
$$;

create or replace function public.restore_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_room_admin(target_room_id) then
    raise exception 'Not authorized';
  end if;
  update public.rooms
  set deleted_at = null
  where id = target_room_id;
end;
$$;

revoke all on function public.dissolve_room(uuid) from public, anon;
revoke all on function public.restore_room(uuid) from public, anon;
grant execute on function public.dissolve_room(uuid) to authenticated;
grant execute on function public.restore_room(uuid) to authenticated;

-- Delete / restore a chat for the current member only.
create or replace function public.delete_chat(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_room_member(target_room_id) then
    raise exception 'Not a member';
  end if;
  update public.room_members
  set deleted_at = now()
  where room_id = target_room_id and user_id = auth.uid();
end;
$$;

create or replace function public.restore_chat(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_room_member(target_room_id) then
    raise exception 'Not a member';
  end if;
  update public.room_members
  set deleted_at = null
  where room_id = target_room_id and user_id = auth.uid();
end;
$$;

revoke all on function public.delete_chat(uuid) from public, anon;
revoke all on function public.restore_chat(uuid) from public, anon;
grant execute on function public.delete_chat(uuid) to authenticated;
grant execute on function public.restore_chat(uuid) to authenticated;

-- ===========================================================================
-- 0010: Reactions and pins (Reaction Service)
-- ===========================================================================

-- Light conversation interactions. Typing indicators and presence are
-- intentionally NOT stored here; they ride the realtime channel instead.

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists message_reactions_room_idx
  on public.message_reactions (room_id);
create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

drop policy if exists "Members can view reactions" on public.message_reactions;
create policy "Members can view reactions"
  on public.message_reactions for select
  to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "Users can react as themselves" on public.message_reactions;
create policy "Users can react as themselves"
  on public.message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_room_member(room_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.room_id = room_id
    )
  );

drop policy if exists "Users can remove their own reactions" on public.message_reactions;
create policy "Users can remove their own reactions"
  on public.message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

create table if not exists public.pins (
  room_id uuid not null references public.rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, message_id)
);

alter table public.pins enable row level security;

drop policy if exists "Members can view pins" on public.pins;
create policy "Members can view pins"
  on public.pins for select
  to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "Admins can pin messages" on public.pins;
create policy "Admins can pin messages"
  on public.pins for insert
  to authenticated
  with check (public.is_room_admin(room_id));

drop policy if exists "Admins can unpin messages" on public.pins;
create policy "Admins can unpin messages"
  on public.pins for delete
  to authenticated
  using (public.is_room_admin(room_id));

alter table public.message_reactions replica identity full;
alter table public.pins replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reactions'
  ) then
    execute 'alter publication supabase_realtime add table public.message_reactions';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pins'
  ) then
    execute 'alter publication supabase_realtime add table public.pins';
  end if;
end;
$$;
