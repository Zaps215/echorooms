-- Messaging Service: messages, replies, edits, soft deletion, and realtime.
--
-- Body-only messages are required for now; the Media Service migration will
-- relax the check to allow attachment-only messages.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  reply_to_id uuid references public.messages(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_body_present
    check (body is not null and char_length(trim(body)) between 1 and 4000)
);

create index messages_room_created_idx
  on public.messages (room_id, created_at desc);

alter table public.messages enable row level security;

create policy "Members can view room messages"
  on public.messages for select
  to authenticated
  using (exists (
    select 1 from public.room_members
    where room_members.room_id = messages.room_id
      and room_members.user_id = auth.uid()
  ));

create policy "Members can send messages as themselves"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.room_members
      where room_members.room_id = messages.room_id
        and room_members.user_id = auth.uid()
    )
  );

create policy "Senders can edit their own messages"
  on public.messages for update
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

create policy "Senders can delete their own messages"
  on public.messages for delete
  to authenticated
  using (sender_id = auth.uid());

-- Keep rooms.last_message_at fresh so the sidebar can sort by activity.
create or replace function public.touch_room_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rooms
  set last_message_at = new.created_at
  where id = new.room_id;
  return new;
end;
$$;

create trigger on_message_created
after insert on public.messages
for each row execute procedure public.touch_room_last_message();

-- Realtime needs the full old row so the client can filter deletes by room_id.
alter table public.messages replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end;
$$;
