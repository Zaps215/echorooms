create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default '',
  avatar_path text,
  status_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  room_type text not null default 'group' check (room_type in ('direct', 'group')),
  created_by uuid not null references public.profiles(id),
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

create policy "Users can view profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Members can view their rooms"
  on public.rooms for select
  to authenticated
  using (exists (
    select 1 from public.room_members
    where room_members.room_id = rooms.id
      and room_members.user_id = auth.uid()
  ));

create policy "Users can create rooms"
  on public.rooms for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Members can view room membership"
  on public.room_members for select
  to authenticated
  using (exists (
    select 1 from public.room_members own_membership
    where own_membership.room_id = room_members.room_id
      and own_membership.user_id = auth.uid()
  ));

create policy "Users can join rooms as themselves"
  on public.room_members for insert
  to authenticated
  with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
