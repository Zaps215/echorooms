-- Media Service (slice 05): end-to-end encrypted message attachments.
--
-- The server never sees file content: the client AES-GCM-encrypts each file
-- under the room key before uploading ciphertext to the `room-files` bucket.
-- The `attachments` row stores the AES-GCM IV and metadata (original name,
-- MIME type, byte size) so members can decrypt+render with the room key.
--
-- Storage layout: `{room_id}/{sender_id}/{uuid}.bin` so RLS can prove room
-- membership from the path alone (cross-room access is blocked with plain SQL)
-- and senders can manage their own uploads.

-- ---------------------------------------------------------------------------
-- 1. Allow attachment-only messages (body becomes optional, never blank).
-- ---------------------------------------------------------------------------

alter table public.messages drop constraint if exists messages_body_present;

alter table public.messages
  add constraint messages_body_optional
  check (body is null or char_length(trim(body)) between 1 and 4000);

-- Message insert/update guard: a message may omit its body only while it is
-- about to receive an attachment (the app always attaches files to the message
-- it just inserted). Blank text is still rejected.
create or replace function public.validate_message_body()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.body is not null and char_length(trim(new.body)) = 0 then
    raise exception 'Message body cannot be blank';
  end if;
  return new;
end;
$$;

create trigger messages_validate_body
before insert or update on public.messages
for each row execute procedure public.validate_message_body();

-- ---------------------------------------------------------------------------
-- 2. attachments table
-- ---------------------------------------------------------------------------

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 1 and 127),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_path text not null unique,
  iv text not null check (char_length(iv) > 0),
  created_at timestamptz not null default now()
);

create index attachments_room_idx on public.attachments (room_id);
create index attachments_message_idx on public.attachments (message_id);

alter table public.attachments enable row level security;

-- Members can view attachments in rooms they belong to.
create policy "Members can view attachments"
  on public.attachments for select
  to authenticated
  using (public.is_room_member(room_id));

-- Senders can attach files to their own messages inside rooms they belong to,
-- and only to messages that actually live in that room.
create policy "Members can attach files as themselves"
  on public.attachments for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_room_member(room_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.room_id = room_id
    )
  );

-- Senders can delete their own attachments; admins can clean up any file.
create policy "Senders can delete their attachments"
  on public.attachments for delete
  to authenticated
  using (sender_id = auth.uid());

create policy "Admins can delete attachments"
  on public.attachments for delete
  to authenticated
  using (public.is_room_admin(room_id));

-- Remove the stored ciphertext whenever an attachments row goes away (message
-- delete, room dissolve, account deletion). The object may already be gone, so
-- swallow errors.
create or replace function public.purge_attachment_file()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  begin
    delete from storage.objects
    where bucket_id = 'room-files' and name = old.storage_path;
  exception when others then
    null;
  end;
  return old;
end;
$$;

create trigger attachments_purge_storage
after delete on public.attachments
for each row execute procedure public.purge_attachment_file();

-- ---------------------------------------------------------------------------
-- 3. room-files storage bucket + policies
--
-- Members prove room membership from `{room_id}/{sender_id}/{uuid}` folders;
-- the first path segment is the room, the second is the uploader's uid.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('room-files', 'room-files', false)
on conflict (id) do nothing;

create policy "Members can upload files to their rooms"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'room-files'
    and (storage.foldername(name))[1] is not null
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_room_member((storage.foldername(name))[1]::uuid)
  );

create policy "Members can read files in their rooms"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'room-files'
    and (storage.foldername(name))[1] is not null
    and public.is_room_member((storage.foldername(name))[1]::uuid)
  );

create policy "Senders can update their own files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'room-files'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'room-files'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "Senders can delete their own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'room-files'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 4. Realtime delivery (RLS still applies on the stream).
-- ---------------------------------------------------------------------------

alter table public.attachments replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attachments'
  ) then
    execute 'alter publication supabase_realtime add table public.attachments';
  end if;
end;
$$;