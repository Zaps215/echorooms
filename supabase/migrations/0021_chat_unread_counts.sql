-- Restore per-member read cursors for unread chat counts. Migration 0015
-- removed the unused cursor before read tracking was implemented.
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
