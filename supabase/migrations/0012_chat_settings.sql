-- Chat settings (slice 06): WhatsApp-style per-chat preferences.
--
-- Adds:
--   1. rooms.description / rooms.avatar_path / rooms.disappear_after + an
--      update policy so owners/admins (or either DM participant) can edit them.
--   2. room_prefs: per-user mute + wallpaper per room (client-applied).
--   3. blocks: contact blocking with a send-guard on direct messages and a
--      guard in create_direct_room so blocked (or blocking) users are kept out.
--   4. expire_room_messages: soft-deletes messages older than disappear_after
--      (attachments are purged, which also removes their storage ciphertext).
--   5. clear_room_messages: "clear for everyone" (admins in groups, either
--      participant in a direct chat).
--   6. room-avatars storage bucket for room photos (admins only).

-- ---------------------------------------------------------------------------
-- 1. Room settings columns + update policy
-- ---------------------------------------------------------------------------

alter table public.rooms
  add column if not exists description text,
  add column if not exists avatar_path text,
  add column if not exists disappear_after int
    check (disappear_after is null
           or disappear_after in (86400, 604800, 7776000));

-- Owners/admins may change a group's info; either participant may change a
-- direct chat's settings (e.g. disappearing messages).
create policy "Members can update room settings"
  on public.rooms for update
  to authenticated
  using (
    (room_type = 'group' and public.is_room_admin(id))
    or (room_type = 'direct' and public.is_room_member(id))
  )
  with check (
    (room_type = 'group' and public.is_room_admin(id))
    or (room_type = 'direct' and public.is_room_member(id))
  );

-- ---------------------------------------------------------------------------
-- 2. room_prefs (per-user, per-room)
-- ---------------------------------------------------------------------------

create table if not exists public.room_prefs (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  muted boolean not null default false,
  wallpaper text,
  primary key (room_id, user_id)
);

alter table public.room_prefs enable row level security;

create policy "Users can view their room prefs"
  on public.room_prefs for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can set their room prefs"
  on public.room_prefs for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their room prefs"
  on public.room_prefs for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Blocks + send guard
-- ---------------------------------------------------------------------------

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

create policy "Users can view their blocks"
  on public.blocks for select
  to authenticated
  using (blocker_id = auth.uid() or blocked_id = auth.uid());

create policy "Users can block as themselves"
  on public.blocks for insert
  to authenticated
  with check (blocker_id = auth.uid());

create policy "Users can unblock as themselves"
  on public.blocks for delete
  to authenticated
  using (blocker_id = auth.uid());

-- Neither side can keep messaging in a direct room once a block exists.
create or replace function public.prevent_blocked_messaging()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  other uuid;
begin
  if not exists (
    select 1 from public.rooms r
    where r.id = new.room_id and r.room_type = 'direct'
  ) then
    return new;
  end if;

  select rm.user_id into other
  from public.room_members rm
  where rm.room_id = new.room_id and rm.user_id <> new.sender_id
  limit 1;

  if other is null then
    return new;
  end if;

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = new.sender_id and b.blocked_id = other)
       or (b.blocker_id = other and b.blocked_id = new.sender_id)
  ) then
    raise exception 'Messaging blocked';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_blocked_guard on public.messages;
create trigger messages_blocked_guard
before insert on public.messages
for each row execute procedure public.prevent_blocked_messaging();

-- Block-aware direct room creation: refuse to create a DM with someone you've
-- blocked, or who has blocked you.
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

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = me and b.blocked_id = other_user_id)
       or (b.blocker_id = other_user_id and b.blocked_id = me)
  ) then
    raise exception 'Messaging blocked';
  end if;

  select r.id into found
  from public.rooms r
  join public.room_members a on a.room_id = r.id and a.user_id = me
  join public.room_members b on b.room_id = r.id and b.user_id = other_user_id
  where r.room_type = 'direct'
    and (r.deleted_at is null or r.created_by = me)
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

-- ---------------------------------------------------------------------------
-- 4. expire_room_messages (disappearing messages)
-- ---------------------------------------------------------------------------

create or replace function public.expire_room_messages(target_room_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff_ms int;
  exp int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_room_member(target_room_id) then
    raise exception 'Not a member';
  end if;

  select r.disappear_after into cutoff_ms
  from public.rooms r
  where r.id = target_room_id;

  if cutoff_ms is null then
    return 0;
  end if;

  -- Purging the attachments rows also removes their storage ciphertext via
  -- the purge_attachment_file trigger.
  delete from public.attachments a
  where a.room_id = target_room_id
    and a.message_id in (
      select m.id from public.messages m
      where m.room_id = target_room_id
        and m.deleted_at is null
        and m.created_at < now() - make_interval(secs => cutoff_ms)
    );

  update public.messages m
  set deleted_at = now(), body = null, ciphertext = null, iv = null
  where m.room_id = target_room_id
    and m.deleted_at is null
    and m.created_at < now() - make_interval(secs => cutoff_ms);

  get diagnostics exp = row_count;
  return exp;
end;
$$;

revoke all on function public.expire_room_messages(uuid) from public, anon;
grant execute on function public.expire_room_messages(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. clear_room_messages (clear for everyone)
-- ---------------------------------------------------------------------------

create or replace function public.clear_room_messages(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_room_member(target_room_id) then
    raise exception 'Not a member';
  end if;

  select r.room_type into t
  from public.rooms r
  where r.id = target_room_id;

  if t = 'group' and not public.is_room_admin(target_room_id) then
    raise exception 'Only admins can clear messages in groups';
  end if;

  delete from public.attachments a
  where a.room_id = target_room_id;

  update public.messages m
  set deleted_at = now(), body = null, ciphertext = null, iv = null
  where m.room_id = target_room_id and m.deleted_at is null;
end;
$$;

revoke all on function public.clear_room_messages(uuid) from public, anon;
grant execute on function public.clear_room_messages(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. room-avatars bucket (room photos; admins only)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('room-avatars', 'room-avatars', false)
on conflict (id) do nothing;

create policy "Admins can upload room avatars"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'room-avatars'
    and (storage.foldername(name))[1] is not null
    and public.is_room_admin((storage.foldername(name))[1]::uuid)
  );

create policy "Members can view room avatars"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'room-avatars'
    and (storage.foldername(name))[1] is not null
    and public.is_room_member((storage.foldername(name))[1]::uuid)
  );

create policy "Admins can update room avatars"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'room-avatars'
    and (storage.foldername(name))[1] is not null
    and public.is_room_admin((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'room-avatars'
    and (storage.foldername(name))[1] is not null
    and public.is_room_admin((storage.foldername(name))[1]::uuid)
  );

create policy "Admins can delete room avatars"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'room-avatars'
    and (storage.foldername(name))[1] is not null
    and public.is_room_admin((storage.foldername(name))[1]::uuid)
  );