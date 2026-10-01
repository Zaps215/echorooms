-- Simplification pass: drop the feature slices that are no longer part of the
-- app. Reactions, pins, tasks, per-room chat settings, contact blocking and the
-- unused read-receipt column all go away together so the frontend can be a plain
-- chat client.
--
-- Order matters only for readability; these tables have no inbound foreign keys
-- from anything that survives.

-- Tasks were created by migration 0013.
drop table if exists public.tasks;

-- Reactions and pins were created by migration 0010.
drop table if exists public.message_reactions;
drop table if exists public.pins;

-- Per-room chat settings (mute, wallpaper) were created by migration 0012.
drop table if exists public.room_prefs;

-- Contact blocking was part of migration 0012 and is dropped with it. The
-- guard trigger has to go first: PL/pgSQL bodies are not validated when the
-- function is created, so leaving it behind would only fail at runtime.
drop trigger if exists messages_blocked_guard on public.messages;
drop function if exists public.prevent_blocked_messaging();

-- Disappearing-message and clear-chat RPCs came from migration 0012.
drop function if exists public.expire_room_messages(uuid);
drop function if exists public.clear_room_messages(uuid);

-- The room-avatars bucket only backed editable room avatars in the settings panel.
delete from storage.buckets where id = 'room-avatars';

-- Columns added by 0012 for the settings panel.
alter table public.rooms drop column if exists description;
alter table public.rooms drop column if exists avatar_path;
alter table public.rooms drop column if exists disappear_after;

-- Read receipts were never written or read by any client.
alter table public.room_members drop column if exists last_read_at;

-- 0014 shipped a block-aware create_direct_room; re-apply it without the guard
-- so direct rooms work again now that public.blocks is gone.
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

  if not exists (select 1 from public.profiles p where p.id = other_user_id) then
    raise exception 'User not found';
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