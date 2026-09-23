-- Soft-delete for rooms and per-member chat deletion, plus harder room names.
--
-- 1. create_direct_room now truncates the computed room name to 80 characters
--    so a target profile with a very long display_name can no longer violate
--    `rooms.name check (char_length(name) between 1 and 80)`.
-- 2. handle_new_user clamps display_name to 80 characters at signup.
-- 3. New columns:
--      rooms.deleted_at         -> "dissolve" (owner/admin, hides for everyone)
--      room_members.deleted_at  -> "delete chat" (hides for just that member)
-- 4. is_room_member treats a dissolved room as unreadable for everyone except
--    the owner, so dissolve genuinely locks the room out; restore_room reopens.

-- ---------------------------------------------------------------------------
-- Harden the direct-room name (also fixes the DM "could not start" error when
-- the other user's display_name is blank or extremely long).
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
-- Clamp the profile display name at creation so it can never overflow the
-- 80-character room-name budget when used to name a direct room.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Soft-delete columns
-- ---------------------------------------------------------------------------

alter table public.rooms
  add column if not exists deleted_at timestamptz;

alter table public.room_members
  add column if not exists deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- is_room_member: members lose access to a dissolved room; the owner keeps
-- visibility so the room can be restored.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Dissolve (for everyone) / restore a room  -- owner or admin only.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Delete / restore a chat for the current member only.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Room reads stay open for owners of a dissolved room (restore path set up
-- above), but existing room-name policies are unchanged otherwise.
-- ---------------------------------------------------------------------------
