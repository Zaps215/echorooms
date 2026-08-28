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