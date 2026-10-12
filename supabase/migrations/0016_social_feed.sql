-- Social feed MVP. Social media is stored separately from encrypted room chats.

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  media_path text,
  media_type text check (media_type in ('image', 'audio')),
  media_mime_type text,
  created_at timestamptz not null default now(),
  constraint social_posts_content_present check (
    (body is not null and char_length(trim(body)) between 1 and 2200)
    or media_path is not null
  ),
  constraint social_posts_media_consistent check (
    (media_path is null and media_type is null and media_mime_type is null)
    or (media_path is not null and media_type is not null and media_mime_type is not null)
  )
);

create index if not exists social_posts_created_idx
  on public.social_posts (created_at desc);
create index if not exists social_posts_author_created_idx
  on public.social_posts (author_id, created_at desc);

alter table public.social_posts enable row level security;

drop policy if exists "Signed-in members can view community posts" on public.social_posts;
create policy "Signed-in members can view community posts"
  on public.social_posts for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Members can publish their own posts" on public.social_posts;
create policy "Members can publish their own posts"
  on public.social_posts for insert to authenticated
  with check (
    author_id = auth.uid()
    and (media_path is null or media_path like auth.uid()::text || '/%')
  );

drop policy if exists "Authors can edit their own posts" on public.social_posts;
create policy "Authors can edit their own posts"
  on public.social_posts for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and (media_path is null or media_path like auth.uid()::text || '/%')
  );

drop policy if exists "Authors can delete their own posts" on public.social_posts;
create policy "Authors can delete their own posts"
  on public.social_posts for delete to authenticated
  using (author_id = auth.uid());

create table if not exists public.social_post_likes (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.social_post_likes enable row level security;

drop policy if exists "Signed-in members can view post likes" on public.social_post_likes;
create policy "Signed-in members can view post likes"
  on public.social_post_likes for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Members can like posts as themselves" on public.social_post_likes;
create policy "Members can like posts as themselves"
  on public.social_post_likes for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Members can remove their own likes" on public.social_post_likes;
create policy "Members can remove their own likes"
  on public.social_post_likes for delete to authenticated
  using (user_id = auth.uid());

create table if not exists public.social_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists social_post_comments_post_created_idx
  on public.social_post_comments (post_id, created_at desc);

alter table public.social_post_comments enable row level security;

drop policy if exists "Signed-in members can view post comments" on public.social_post_comments;
create policy "Signed-in members can view post comments"
  on public.social_post_comments for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Members can comment as themselves" on public.social_post_comments;
create policy "Members can comment as themselves"
  on public.social_post_comments for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "Authors can delete their own comments" on public.social_post_comments;
create policy "Authors can delete their own comments"
  on public.social_post_comments for delete to authenticated
  using (author_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-post-media',
  'social-post-media',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members can upload their own social post media" on storage.objects;
create policy "Members can upload their own social post media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'social-post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Signed-in members can view social post media" on storage.objects;
create policy "Signed-in members can view social post media"
  on storage.objects for select to authenticated
  using (bucket_id = 'social-post-media');

drop policy if exists "Authors can update their own social post media" on storage.objects;
create policy "Authors can update their own social post media"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'social-post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'social-post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Authors can delete their own social post media" on storage.objects;
create policy "Authors can delete their own social post media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'social-post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.purge_social_post_media()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if old.media_path is not null then
    delete from storage.objects
    where bucket_id = 'social-post-media' and name = old.media_path;
  end if;
  return old;
end;
$$;

drop trigger if exists social_posts_purge_media on public.social_posts;
create trigger social_posts_purge_media
after delete on public.social_posts
for each row execute procedure public.purge_social_post_media();

alter table public.social_posts replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'social_posts'
  ) then
    execute 'alter publication supabase_realtime add table public.social_posts';
  end if;
end;
$$;
