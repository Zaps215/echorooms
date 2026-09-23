-- Reaction Service (slice 04): light conversation interactions.
--
-- 1. message_reactions: one row per emoji per user per message. `room_id` is
--    denormalized so realtime subscriptions can filter a whole room with a
--    single predicate (the messages table uses `replica identity full`, but
--    DELETE payloads only carry the primary key otherwise).
-- 2. pins: one row per pinned message, per room. Only owners/admins may pin,
--    matching the existing is_room_admin contract.
-- 3. Both tables are added to supabase_realtime with `replica identity full`
--    so the room filter keeps working on DELETE events.
--
-- Typing indicators and presence intentionally live OUTSIDE Postgres: they use
-- the realtime broadcast + presence features on the room channel instead.

-- ---------------------------------------------------------------------------
-- message_reactions
-- ---------------------------------------------------------------------------

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists message_reactions_room_idx
  on public.message_reactions (room_id);
create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

drop policy if exists "Members can view reactions" on public.message_reactions;
create policy "Members can view reactions"
  on public.message_reactions for select
  to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "Users can react as themselves" on public.message_reactions;
create policy "Users can react as themselves"
  on public.message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_room_member(room_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.room_id = room_id
    )
  );

drop policy if exists "Users can remove their own reactions" on public.message_reactions;
create policy "Users can remove their own reactions"
  on public.message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- pins
-- ---------------------------------------------------------------------------

create table if not exists public.pins (
  room_id uuid not null references public.rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, message_id)
);

alter table public.pins enable row level security;

drop policy if exists "Members can view pins" on public.pins;
create policy "Members can view pins"
  on public.pins for select
  to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "Admins can pin messages" on public.pins;
create policy "Admins can pin messages"
  on public.pins for insert
  to authenticated
  with check (public.is_room_admin(room_id));

drop policy if exists "Admins can unpin messages" on public.pins;
create policy "Admins can unpin messages"
  on public.pins for delete
  to authenticated
  using (public.is_room_admin(room_id));

-- ---------------------------------------------------------------------------
-- Realtime delivery (RLS still applies on the stream).
-- ---------------------------------------------------------------------------

alter table public.message_reactions replica identity full;
alter table public.pins replica identity full;

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

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pins'
  ) then
    execute 'alter publication supabase_realtime add table public.pins';
  end if;
end;
$$;