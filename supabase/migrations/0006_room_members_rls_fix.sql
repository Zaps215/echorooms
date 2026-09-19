-- Break RLS recursion on room_members.
--
-- The original room_members SELECT policy referenced room_members from inside
-- its own USING expression. PostgreSQL rejects that at query time with
-- "infinite recursion detected in policy for relation room_members", which
-- breaks room listing and every room-scoped read (messages included).
--
-- A SECURITY DEFINER helper evaluates membership while bypassing RLS, so all
-- room-scoped policies can share one recursion-free predicate.

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

-- Rooms: a member can read a room.
drop policy if exists "Members can view their rooms" on public.rooms;
create policy "Members can view their rooms"
  on public.rooms for select
  to authenticated
  using (public.is_room_member(id));

-- Membership: a member can read the membership rows of their rooms.
drop policy if exists "Members can view room membership" on public.room_members;
create policy "Members can view room membership"
  on public.room_members for select
  to authenticated
  using (public.is_room_member(room_id));

-- Messages: read and insert only within rooms the user belongs to.
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
