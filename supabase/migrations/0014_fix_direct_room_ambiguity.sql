-- Fix create_direct_room failing with "column reference \"id\" is ambiguous".
--
-- The function is declared RETURNS TABLE (... id uuid, name text, ...), and
-- PL/pgSQL turns every output column into a variable. A bare `id` in the body
-- is therefore ambiguous between that variable and profiles.id, and with the
-- default plpgsql.variable_conflict = error the RPC aborts (SQLSTATE 42702).
--
-- The client showed only its generic failure copy ("Could not start that
-- conversation. Try again."), so searching for a user worked but tapping the
-- result never opened a conversation. No console error appeared, because
-- Supabase returns the failure in the response rather than throwing.
--
-- Every column reference that collides with an output parameter name is now
-- table-qualified, and the INSERT aliases its target so RETURNING cannot be
-- confused with the `id` output variable. This redefines the version last set
-- by 0012_chat_settings.sql.

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
