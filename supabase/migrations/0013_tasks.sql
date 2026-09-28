-- Task Service (slice 06): turn conversation context into trackable actions.
--
-- One `tasks` row per action item. `room_id` is denormalized (same reasoning as
-- message_reactions) so realtime subscriptions can filter a whole room with a
-- single predicate. `message_id` is the optional link back to the message the
-- task came from and uses ON DELETE SET NULL: a deleted or expired source
-- message must not silently delete the work it spawned.
--
-- Task titles are plain text by design. Unlike message bodies, a task is a
-- shared checklist item the server must be able to sort and filter, so it is
-- not end-to-end encrypted.

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  assignee_id uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'done')),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_room_idx
  on public.tasks (room_id, created_at desc);
create index if not exists tasks_message_idx
  on public.tasks (message_id);
create index if not exists tasks_assignee_idx
  on public.tasks (room_id, assignee_id);

alter table public.tasks enable row level security;

-- Only room members can see the room's tasks.
drop policy if exists "Members can view tasks" on public.tasks;
create policy "Members can view tasks"
  on public.tasks for select
  to authenticated
  using (public.is_room_member(room_id));

-- Members can create tasks in rooms they belong to, as themselves. The
-- assignee must also be a member of the same room, otherwise the task would
-- surface a profile to someone outside the room. (is_room_member() always
-- checks auth.uid(), so the assignee check is an explicit room_members lookup.)
drop policy if exists "Members can create tasks" on public.tasks;
create policy "Members can create tasks"
  on public.tasks for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_room_member(room_id)
    and (
      assignee_id is null
      or exists (
        select 1 from public.room_members rm
        where rm.room_id = room_id and rm.user_id = assignee_id
      )
    )
    and (
      message_id is null
      or exists (
        select 1 from public.messages m
        where m.id = message_id and m.room_id = room_id
      )
    )
  );

-- Editing is a collaborative act: the creator, the assignee, and room
-- admins/owners may all update a task's state or details.
drop policy if exists "Members can update tasks" on public.tasks;
create policy "Members can update tasks"
  on public.tasks for update
  to authenticated
  using (
    created_by = auth.uid()
    or public.is_room_admin(room_id)
    or assignee_id = auth.uid()
  )
  with check (
    public.is_room_member(room_id)
    and (
      assignee_id is null
      or exists (
        select 1 from public.room_members rm
        where rm.room_id = room_id and rm.user_id = assignee_id
      )
    )
  );

-- Deleting is narrower than editing: the task's creator or a room admin.
drop policy if exists "Members can delete tasks" on public.tasks;
create policy "Members can delete tasks"
  on public.tasks for delete
  to authenticated
  using (created_by = auth.uid() or public.is_room_admin(room_id));

-- Keep updated_at honest and mirror 'done' into completed_at so the room
-- panel can sort and filter without recomputing it in the client.
create or replace function public.touch_task()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();

  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    if new.completed_at is null then
      new.completed_at = now();
    end if;
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch
before insert or update on public.tasks
for each row execute procedure public.touch_task();

-- ---------------------------------------------------------------------------
-- Realtime delivery (RLS still applies on the stream).
-- ---------------------------------------------------------------------------

alter table public.tasks replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.tasks';
  end if;
end;
$$;
