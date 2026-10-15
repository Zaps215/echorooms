-- Restore per-message emoji reactions with room-scoped RLS and realtime.

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
