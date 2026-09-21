-- Fix direct-room creation when the other user has an empty display_name.
--
-- profiles.display_name defaults to '' (not null), so email/OTP users who only
-- claimed a username previously produced a room named '' inside
-- create_direct_room's `coalesce(display_name, 'Direct')` — coalesce does not
-- treat '' as "missing", and rooms.name rejects char_length '' (must be 1-80).
-- That constraint error made the create_direct_room RPC fail with
-- "Could not start that conversation. Try again." whenever a DM was opened to
-- a user whose display_name was blank.
--
-- The room now falls back to display_name -> username -> 'Direct'.

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
      coalesce(
        nullif(trim((select display_name from public.profiles where id = other_user_id)), ''),
        (select username from public.profiles where id = other_user_id),
        'Direct'
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