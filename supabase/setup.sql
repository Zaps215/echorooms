-- EchoRooms complete database setup (idempotent).
--
-- Paste this whole file into the Supabase SQL editor of a project, then copy
-- the project URL and anon key into .env as VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY.
--
-- This consolidates migrations 0001-0006 in order and can be run more than
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
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
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

create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members
    where room_members.room_id = target_room_id
      and room_members.user_id = auth.uid()
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
