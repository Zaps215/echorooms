-- EchoRooms complete database setup (idempotent).
--
-- Paste this whole file into the Supabase SQL editor of a project, then copy
-- the project URL and anon key into .env as VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY.
--
-- This consolidates every migration in order and can be run more than once.
-- It is the fast path for a fresh/paused project; the per-migration files in
-- supabase/migrations/ remain the source of truth for incremental changes.

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
revoke insert on public.room_members from anon, authenticated;

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

alter table public.room_members
  add column if not exists last_read_at timestamptz;

create or replace function public.get_unread_message_counts()
returns table (room_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    rm.room_id,
    count(m.id)::bigint as unread_count
  from public.room_members rm
  left join public.messages m
    on m.room_id = rm.room_id
    and m.sender_id <> auth.uid()
    and m.created_at > coalesce(rm.last_read_at, rm.joined_at)
  where rm.user_id = auth.uid()
  group by rm.room_id;
$$;

revoke all on function public.get_unread_message_counts() from public, anon;
grant execute on function public.get_unread_message_counts() to authenticated;

create or replace function public.mark_room_read(
  p_room_id uuid,
  p_read_through timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  reader_id uuid := auth.uid();
begin
  if reader_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.room_members rm
  set last_read_at = greatest(
    coalesce(rm.last_read_at, '-infinity'::timestamptz),
    least(coalesce(p_read_through, now()), now())
  )
  where rm.room_id = p_room_id
    and rm.user_id = reader_id;

  if not found then
    raise exception 'Not a member of this room';
  end if;
end;
$$;

revoke all on function public.mark_room_read(uuid, timestamptz) from public, anon;
grant execute on function public.mark_room_read(uuid, timestamptz) to authenticated;

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
-- Message reactions (added back as a small, room-scoped feature)
-- ===========================================================================

create table if not exists public.message_reactions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.message_reactions
  add column if not exists room_id uuid references public.rooms(id) on delete cascade;

update public.message_reactions r
set room_id = m.room_id
from public.messages m
where m.id = r.message_id and r.room_id is null;

alter table public.message_reactions
  alter column room_id set not null;

create unique index if not exists message_reactions_message_user_emoji_idx
  on public.message_reactions (message_id, user_id, emoji);
create index if not exists message_reactions_room_idx
  on public.message_reactions (room_id, message_id);

alter table public.message_reactions enable row level security;
grant select, insert, update, delete on public.message_reactions to authenticated;

drop policy if exists "Members can view room message reactions" on public.message_reactions;
drop policy if exists "Members can view reactions" on public.message_reactions;
create policy "Members can view room message reactions"
  on public.message_reactions for select
  to authenticated
  using (
    public.is_room_member(room_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and m.room_id = message_reactions.room_id
    )
  );

drop policy if exists "Members can add room message reactions" on public.message_reactions;
drop policy if exists "Users can react as themselves" on public.message_reactions;
create policy "Members can add room message reactions"
  on public.message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_room_member(room_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and m.room_id = message_reactions.room_id
        and m.deleted_at is null
    )
  );

drop policy if exists "Users can update their message reactions" on public.message_reactions;
create policy "Users can update their message reactions"
  on public.message_reactions for update
  to authenticated
  using (user_id = auth.uid() and public.is_room_member(room_id))
  with check (user_id = auth.uid() and public.is_room_member(room_id));

drop policy if exists "Users can remove their message reactions" on public.message_reactions;
drop policy if exists "Users can remove their own reactions" on public.message_reactions;
create policy "Users can remove their message reactions"
  on public.message_reactions for delete
  to authenticated
  using (user_id = auth.uid() and public.is_room_member(room_id));

alter table public.message_reactions replica identity full;

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
end;
$$;

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

  -- The RETURNS TABLE clause below declares output parameters as PL/pgSQL
  -- variables, so a bare `id` anywhere in this body is ambiguous between the
  -- variable and profiles.id (SQLSTATE 42702) and the RPC fails outright. Every
  -- such reference is table-qualified.
  if not exists (select 1 from public.profiles p where p.id = other_user_id) then
    raise exception 'User not found';
  end if;

  -- A deleted direct room is only reusable by the member who created it, so a
  -- dissolve does not force a duplicate conversation back into the list.
  select r.id into found
  from public.rooms r
  join public.room_members a on a.room_id = r.id and a.user_id = me
  join public.room_members b on b.room_id = r.id and b.user_id = other_user_id
  where r.room_type = 'direct'
    and (r.deleted_at is null or r.created_by = me)
  order by r.created_at asc
  limit 1;

  if found is null then
    insert into public.rooms as new_room (name, room_type, created_by)
    values (
      left(
        coalesce(
          nullif(trim((select p.display_name from public.profiles p where p.id = other_user_id)), ''),
          (select p.username from public.profiles p where p.id = other_user_id),
          'Direct'
        ),
        80
      ),
      'direct',
      me
    )
    returning new_room.id into found;

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

-- ===========================================================================
-- 0016: Social feed (separate from end-to-end-encrypted room messages)
-- ===========================================================================

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  media_path text,
  media_type text check (media_type in ('image', 'audio')),
  media_mime_type text,
  created_at timestamptz not null default now(),
  constraint social_posts_content_present check (
    (body is not null and char_length(trim(body)) between 1 and 2200)
    or media_path is not null
  ),
  constraint social_posts_media_consistent check (
    (media_path is null and media_type is null and media_mime_type is null)
    or (media_path is not null and media_type is not null and media_mime_type is not null)
  )
);

create index if not exists social_posts_created_idx
  on public.social_posts (created_at desc);
create index if not exists social_posts_author_created_idx
  on public.social_posts (author_id, created_at desc);

alter table public.social_posts enable row level security;

drop policy if exists "Signed-in members can view community posts" on public.social_posts;
create policy "Signed-in members can view community posts"
  on public.social_posts for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Members can publish their own posts" on public.social_posts;
create policy "Members can publish their own posts"
  on public.social_posts for insert to authenticated
  with check (
    author_id = auth.uid()
    and (media_path is null or media_path like auth.uid()::text || '/%')
  );

drop policy if exists "Authors can edit their own posts" on public.social_posts;
create policy "Authors can edit their own posts"
  on public.social_posts for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and (media_path is null or media_path like auth.uid()::text || '/%')
  );

drop policy if exists "Authors can delete their own posts" on public.social_posts;
create policy "Authors can delete their own posts"
  on public.social_posts for delete to authenticated
  using (author_id = auth.uid());

create table if not exists public.social_post_likes (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.social_post_likes enable row level security;

drop policy if exists "Signed-in members can view post likes" on public.social_post_likes;
create policy "Signed-in members can view post likes"
  on public.social_post_likes for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Members can like posts as themselves" on public.social_post_likes;
create policy "Members can like posts as themselves"
  on public.social_post_likes for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Members can remove their own likes" on public.social_post_likes;
create policy "Members can remove their own likes"
  on public.social_post_likes for delete to authenticated
  using (user_id = auth.uid());

create table if not exists public.social_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists social_post_comments_post_created_idx
  on public.social_post_comments (post_id, created_at desc);

alter table public.social_post_comments enable row level security;

drop policy if exists "Signed-in members can view post comments" on public.social_post_comments;
create policy "Signed-in members can view post comments"
  on public.social_post_comments for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Members can comment as themselves" on public.social_post_comments;
create policy "Members can comment as themselves"
  on public.social_post_comments for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "Authors can delete their own comments" on public.social_post_comments;
create policy "Authors can delete their own comments"
  on public.social_post_comments for delete to authenticated
  using (author_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-post-media',
  'social-post-media',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members can upload their own social post media" on storage.objects;
create policy "Members can upload their own social post media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'social-post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Signed-in members can view social post media" on storage.objects;
create policy "Signed-in members can view social post media"
  on storage.objects for select to authenticated
  using (bucket_id = 'social-post-media');

drop policy if exists "Authors can update their own social post media" on storage.objects;
create policy "Authors can update their own social post media"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'social-post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'social-post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Authors can delete their own social post media" on storage.objects;
create policy "Authors can delete their own social post media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'social-post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.purge_social_post_media()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if old.media_path is not null then
    delete from storage.objects
    where bucket_id = 'social-post-media' and name = old.media_path;
  end if;
  return old;
end;
$$;

drop trigger if exists social_posts_purge_media on public.social_posts;
create trigger social_posts_purge_media
after delete on public.social_posts
for each row execute procedure public.purge_social_post_media();

alter table public.social_posts replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'social_posts'
  ) then
    execute 'alter publication supabase_realtime add table public.social_posts';
  end if;
end;
$$;

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
  if coalesce(member_role, 'member') <> 'member' then
    raise exception 'Invited members must be assigned the member role';
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
-- 0011: Encrypted attachments (Media Service)
-- ===========================================================================

-- The server never sees file content: the client AES-GCM-encrypts each file
-- under the room key before uploading ciphertext to the `room-files` bucket.
-- Storage layout is `{room_id}/{sender_id}/{uuid}.bin` so RLS can prove room
-- membership from the path alone.

-- Attachment-only messages: the body becomes optional, but never blank.
-- Both constraints are dropped first: `add constraint` has no "if not exists"
-- form, so a second run would otherwise fail on the existing constraint.
alter table public.messages
  drop constraint if exists messages_body_present,
  drop constraint if exists messages_body_optional;

alter table public.messages
  add constraint messages_body_optional
  check (body is null or char_length(trim(body)) between 1 and 4000);

create or replace function public.validate_message_body()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.body is not null and char_length(trim(new.body)) = 0 then
    raise exception 'Message body cannot be blank';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_validate_body on public.messages;
create trigger messages_validate_body
before insert or update on public.messages
for each row execute procedure public.validate_message_body();

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 1 and 127),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_path text not null unique,
  iv text not null check (char_length(iv) > 0),
  created_at timestamptz not null default now()
);

create index if not exists attachments_room_idx on public.attachments (room_id);
create index if not exists attachments_message_idx on public.attachments (message_id);

alter table public.attachments enable row level security;

drop policy if exists "Members can view attachments" on public.attachments;
create policy "Members can view attachments"
  on public.attachments for select
  to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "Members can attach files as themselves" on public.attachments;
create policy "Members can attach files as themselves"
  on public.attachments for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_room_member(room_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.room_id = room_id
    )
  );

drop policy if exists "Senders can delete their attachments" on public.attachments;
create policy "Senders can delete their attachments"
  on public.attachments for delete
  to authenticated
  using (sender_id = auth.uid());

drop policy if exists "Admins can delete attachments" on public.attachments;
create policy "Admins can delete attachments"
  on public.attachments for delete
  to authenticated
  using (public.is_room_admin(room_id));

-- Remove the stored ciphertext whenever an attachments row goes away (message
-- delete, room dissolve, account deletion). The object may already be gone, so
-- swallow errors.
create or replace function public.purge_attachment_file()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  begin
    delete from storage.objects
    where bucket_id = 'room-files' and name = old.storage_path;
  exception when others then
    null;
  end;
  return old;
end;
$$;

drop trigger if exists attachments_purge_storage on public.attachments;
create trigger attachments_purge_storage
after delete on public.attachments
for each row execute procedure public.purge_attachment_file();

insert into storage.buckets (id, name, public)
values ('room-files', 'room-files', false)
on conflict (id) do nothing;

drop policy if exists "Members can upload files to their rooms" on storage.objects;
create policy "Members can upload files to their rooms"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'room-files'
    and (storage.foldername(name))[1] is not null
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_room_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Members can read files in their rooms" on storage.objects;
create policy "Members can read files in their rooms"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'room-files'
    and (storage.foldername(name))[1] is not null
    and public.is_room_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Senders can update their own files" on storage.objects;
create policy "Senders can update their own files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'room-files'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'room-files'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Senders can delete their own files" on storage.objects;
create policy "Senders can delete their own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'room-files'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

alter table public.attachments replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attachments'
  ) then
    execute 'alter publication supabase_realtime add table public.attachments';
  end if;
end;
$$;

-- ===========================================================================
-- 0017: Read-only curated channels
-- ===========================================================================

create table if not exists public.broadcast_channels (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 1 and 60),
  description text not null check (char_length(description) between 1 and 180),
  bot_name text not null check (char_length(bot_name) between 1 and 60),
  icon text not null default '✦',
  color text not null default '#2878e5' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.broadcast_channel_posts (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null references public.broadcast_channels(id) on delete cascade,
  bot_name text not null check (char_length(bot_name) between 1 and 60),
  body text not null check (char_length(trim(body)) between 1 and 1600),
  created_at timestamptz not null default now(),
  constraint broadcast_channel_posts_seed_unique unique (channel_id, body)
);

create index if not exists broadcast_channel_posts_created_idx
  on public.broadcast_channel_posts (channel_id, created_at desc);

create table if not exists public.broadcast_channel_members (
  channel_id text not null references public.broadcast_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

alter table public.broadcast_channels enable row level security;
alter table public.broadcast_channel_posts enable row level security;
alter table public.broadcast_channel_members enable row level security;

revoke insert, update, delete on public.broadcast_channels from anon, authenticated;
revoke insert, update, delete on public.broadcast_channel_posts from anon, authenticated;
revoke insert, update on public.broadcast_channel_members from anon, authenticated;
revoke delete on public.broadcast_channel_members from anon;
grant select on public.broadcast_channels, public.broadcast_channel_posts to authenticated;
grant select, insert, delete on public.broadcast_channel_members to authenticated;

drop policy if exists "Signed-in members can view broadcast channels" on public.broadcast_channels;
create policy "Signed-in members can view broadcast channels"
  on public.broadcast_channels for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Signed-in members can view bot channel posts" on public.broadcast_channel_posts;
create policy "Signed-in members can view bot channel posts"
  on public.broadcast_channel_posts for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Signed-in members can view channel membership" on public.broadcast_channel_members;
create policy "Signed-in members can view channel membership"
  on public.broadcast_channel_members for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Members can join channels as themselves" on public.broadcast_channel_members;
create policy "Members can join channels as themselves"
  on public.broadcast_channel_members for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Members can leave channels themselves" on public.broadcast_channel_members;
create policy "Members can leave channels themselves"
  on public.broadcast_channel_members for delete to authenticated
  using (user_id = auth.uid());

insert into public.broadcast_channels (id, name, description, bot_name, icon, color, sort_order)
values
  ('world-now', 'World, right now', 'A quick pulse on ideas and moments people are talking about.', 'Echo Pulse', '◉', '#2878e5', 1),
  ('tech-pulse', 'Tech Pulse', 'Useful tech finds, product curiosities, and future-facing questions.', 'Byte', '⌘', '#7358d7', 2),
  ('good-energy', 'Good Energy', 'Small wins, uplifting prompts, and a little boost for your day.', 'Sunny', '☀', '#e49529', 3),
  ('creative-corner', 'Creative Corner', 'Fresh prompts and tiny creative challenges for curious minds.', 'Muse', '✎', '#0e9b8a', 4)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    bot_name = excluded.bot_name,
    icon = excluded.icon,
    color = excluded.color,
    sort_order = excluded.sort_order;

insert into public.broadcast_channel_posts (channel_id, bot_name, body, created_at)
values
  ('world-now', 'Echo Pulse', 'The day''s big question: what local place deserves far more love than it gets?', now() - interval '6 minutes'),
  ('world-now', 'Echo Pulse', 'A tiny trend worth noticing: people are making more room for slower, offline weekends.', now() - interval '31 minutes'),
  ('world-now', 'Echo Pulse', 'Conversation starter: if your city had one extra public space, what would you want it to be?', now() - interval '1 hour 12 minutes'),
  ('world-now', 'Echo Pulse', 'Today''s good-news habit: send a thank-you to someone whose work usually happens in the background.', now() - interval '2 hours 8 minutes'),
  ('world-now', 'Echo Pulse', 'Quick poll for the group chat: sunrise walk, lunch break stroll, or evening wander?', now() - interval '3 hours 4 minutes'),
  ('tech-pulse', 'Byte', 'Build curiosity: what everyday task would you happily hand to a tiny, reliable gadget?', now() - interval '4 minutes'),
  ('tech-pulse', 'Byte', 'Today''s tech rabbit hole: local-first apps that keep working when the internet doesn''t.', now() - interval '24 minutes'),
  ('tech-pulse', 'Byte', 'Product thought: the best feature might be the one that helps you do less tapping.', now() - interval '54 minutes'),
  ('tech-pulse', 'Byte', 'What are you learning this week? Drop a topic in your own notes and give it fifteen minutes.', now() - interval '1 hour 43 minutes'),
  ('tech-pulse', 'Byte', 'Friendly reminder: a backup you have tested beats a backup you merely hope exists.', now() - interval '2 hours 37 minutes'),
  ('good-energy', 'Sunny', 'Tiny win check-in: what is one thing you finished today, even if it was small?', now() - interval '3 minutes'),
  ('good-energy', 'Sunny', 'Take a screen break, stretch your shoulders, and unclench your jaw. You deserve the reset.', now() - interval '19 minutes'),
  ('good-energy', 'Sunny', 'Kindness prompt: tell someone one specific thing you appreciate about them.', now() - interval '47 minutes'),
  ('good-energy', 'Sunny', 'A gentle goal for today: make the next step small enough that starting feels easy.', now() - interval '1 hour 28 minutes'),
  ('good-energy', 'Sunny', 'What song gives you an instant mood lift? Add it to your personal feel-good playlist.', now() - interval '2 hours 19 minutes'),
  ('creative-corner', 'Muse', 'Five-minute prompt: describe your morning as if it were the opening scene of a movie.', now() - interval '8 minutes'),
  ('creative-corner', 'Muse', 'Color hunt: find three colors around you and invent a name for that palette.', now() - interval '36 minutes'),
  ('creative-corner', 'Muse', 'Make something deliberately imperfect today. The goal is to finish, not polish.', now() - interval '1 hour 3 minutes'),
  ('creative-corner', 'Muse', 'What object on your desk would make the strangest main character in a story?', now() - interval '1 hour 51 minutes'),
  ('creative-corner', 'Muse', 'One-line challenge: write a tiny story that includes a key, a storm, and a borrowed umbrella.', now() - interval '2 hours 46 minutes')
on conflict (channel_id, body) do nothing;

-- ===========================================================================
-- 0018: Stories and private one-to-one call signaling
-- ===========================================================================

create table if not exists public.social_stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text check (body is null or char_length(trim(body)) between 1 and 500),
  media_path text,
  audience_mode text not null check (audience_mode in ('everyone', 'selected')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint social_stories_content_present check (
    (body is not null and char_length(trim(body)) > 0) or media_path is not null
  ),
  constraint social_stories_media_owner_path check (
    media_path is null or media_path like author_id::text || '/%'
  )
);

create index if not exists social_stories_expiry_created_idx
  on public.social_stories (expires_at, created_at desc);
create index if not exists social_stories_author_expiry_idx
  on public.social_stories (author_id, expires_at desc);

create table if not exists public.social_story_recipients (
  story_id uuid not null references public.social_stories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (story_id, user_id)
);

alter table public.social_stories enable row level security;
alter table public.social_story_recipients enable row level security;

drop policy if exists "Story audience can view active stories" on public.social_stories;
create policy "Story audience can view active stories"
  on public.social_stories for select to authenticated
  using (
    expires_at > now()
    and (
      author_id = auth.uid()
      or audience_mode = 'everyone'
      or exists (
        select 1 from public.social_story_recipients recipient
        where recipient.story_id = social_stories.id
          and recipient.user_id = auth.uid()
      )
    )
  );

drop policy if exists "Members can create their own stories" on public.social_stories;
create policy "Members can create their own stories"
  on public.social_stories for insert to authenticated
  with check (
    author_id = auth.uid()
    and expires_at > now()
    and expires_at <= now() + interval '25 hours'
  );

drop policy if exists "Authors can delete their own stories" on public.social_stories;
create policy "Authors can delete their own stories"
  on public.social_stories for delete to authenticated
  using (author_id = auth.uid());

drop policy if exists "Story authors and viewers can see recipients" on public.social_story_recipients;
create policy "Story authors and viewers can see recipients"
  on public.social_story_recipients for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Authors can choose story viewers" on public.social_story_recipients;
create policy "Authors can choose story viewers"
  on public.social_story_recipients for insert to authenticated
  with check (
    user_id <> auth.uid()
    and exists (
      select 1 from public.social_stories story
      where story.id = social_story_recipients.story_id
        and story.author_id = auth.uid()
        and story.audience_mode = 'selected'
        and story.expires_at > now()
    )
  );

grant select, insert, delete on public.social_stories to authenticated;
grant select, insert on public.social_story_recipients to authenticated;
revoke update on public.social_stories, public.social_story_recipients from anon, authenticated;

drop policy if exists "Signed-in members can view social post media" on storage.objects;
create policy "Signed-in members can view social post media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'social-post-media'
    and (
      exists (
        select 1 from public.social_posts post
        where post.media_path = storage.objects.name
      )
      or exists (
        select 1 from public.social_stories story
        where story.media_path = storage.objects.name
          and story.expires_at > now()
          and (
            story.author_id = auth.uid()
            or story.audience_mode = 'everyone'
            or exists (
              select 1 from public.social_story_recipients recipient
              where recipient.story_id = story.id
                and recipient.user_id = auth.uid()
            )
          )
      )
    )
  );

drop trigger if exists social_stories_purge_media on public.social_stories;
create trigger social_stories_purge_media
after delete on public.social_stories
for each row execute procedure public.purge_social_post_media();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'social_stories'
  ) then
    execute 'alter publication supabase_realtime add table public.social_stories';
  end if;
end;
$$;

drop policy if exists "Room members can signal calls" on realtime.messages;
create policy "Room members can signal calls"
  on realtime.messages for all to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() ~ '^calls:[0-9a-fA-F-]{36}$'
    and exists (
      select 1 from public.room_members member
      where member.room_id::text = split_part(realtime.topic(), ':', 2)
        and member.user_id = auth.uid()
    )
  )
  with check (
    extension = 'broadcast'
    and realtime.topic() ~ '^calls:[0-9a-fA-F-]{36}$'
    and exists (
      select 1 from public.room_members member
      where member.room_id::text = split_part(realtime.topic(), ':', 2)
        and member.user_id = auth.uid()
    )
  );

-- ===========================================================================
-- 0020: Versioned policy acceptance
-- ===========================================================================

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
