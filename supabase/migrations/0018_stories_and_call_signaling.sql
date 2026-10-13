-- Stories are visible to signed-in members only when the author chose
-- everyone, or explicitly included the viewer. Calls use short-lived,
-- room-member-only Supabase Realtime broadcast signaling.

create table if not exists public.social_stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text check (body is null or char_length(trim(body)) between 1 and 500),
  media_path text,
  audience_mode text not null check (audience_mode in ('everyone', 'selected')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint social_stories_content_present check (
    (body is not null and char_length(trim(body)) > 0) or media_path is not null
  ),
  constraint social_stories_media_owner_path check (
    media_path is null or media_path like author_id::text || '/%'
  )
);

create index if not exists social_stories_expiry_created_idx
  on public.social_stories (expires_at, created_at desc);
create index if not exists social_stories_author_expiry_idx
  on public.social_stories (author_id, expires_at desc);

create table if not exists public.social_story_recipients (
  story_id uuid not null references public.social_stories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (story_id, user_id)
);

alter table public.social_stories enable row level security;
alter table public.social_story_recipients enable row level security;

drop policy if exists "Story audience can view active stories" on public.social_stories;
create policy "Story audience can view active stories"
  on public.social_stories for select to authenticated
  using (
    expires_at > now()
    and (
      author_id = auth.uid()
      or audience_mode = 'everyone'
      or exists (
        select 1 from public.social_story_recipients recipient
        where recipient.story_id = social_stories.id
          and recipient.user_id = auth.uid()
      )
    )
  );

drop policy if exists "Members can create their own stories" on public.social_stories;
create policy "Members can create their own stories"
  on public.social_stories for insert to authenticated
  with check (
    author_id = auth.uid()
    and expires_at > now()
    and expires_at <= now() + interval '25 hours'
  );

drop policy if exists "Authors can delete their own stories" on public.social_stories;
create policy "Authors can delete their own stories"
  on public.social_stories for delete to authenticated
  using (author_id = auth.uid());

drop policy if exists "Story authors and viewers can see recipients" on public.social_story_recipients;
create policy "Story authors and viewers can see recipients"
  on public.social_story_recipients for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Authors can choose story viewers" on public.social_story_recipients;
create policy "Authors can choose story viewers"
  on public.social_story_recipients for insert to authenticated
  with check (
    user_id <> auth.uid()
    and exists (
      select 1 from public.social_stories story
      where story.id = social_story_recipients.story_id
        and story.author_id = auth.uid()
        and story.audience_mode = 'selected'
        and story.expires_at > now()
    )
  );

grant select, insert, delete on public.social_stories to authenticated;
grant select, insert on public.social_story_recipients to authenticated;
revoke update on public.social_stories, public.social_story_recipients from anon, authenticated;

drop policy if exists "Signed-in members can view social post media" on storage.objects;
create policy "Signed-in members can view social post media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'social-post-media'
    and (
      exists (
        select 1 from public.social_posts post
        where post.media_path = storage.objects.name
      )
      or exists (
        select 1 from public.social_stories story
        where story.media_path = storage.objects.name
          and story.expires_at > now()
          and (
            story.author_id = auth.uid()
            or story.audience_mode = 'everyone'
            or exists (
              select 1 from public.social_story_recipients recipient
              where recipient.story_id = story.id
                and recipient.user_id = auth.uid()
            )
          )
      )
    )
  );

drop trigger if exists social_stories_purge_media on public.social_stories;
create trigger social_stories_purge_media
after delete on public.social_stories
for each row execute procedure public.purge_social_post_media();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'social_stories'
  ) then
    execute 'alter publication supabase_realtime add table public.social_stories';
  end if;
end;
$$;

drop policy if exists "Room members can signal calls" on realtime.messages;
create policy "Room members can signal calls"
  on realtime.messages for all to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() ~ '^calls:[0-9a-fA-F-]{36}$'
    and exists (
      select 1 from public.room_members member
      where member.room_id::text = split_part(realtime.topic(), ':', 2)
        and member.user_id = auth.uid()
    )
  )
  with check (
    extension = 'broadcast'
    and realtime.topic() ~ '^calls:[0-9a-fA-F-]{36}$'
    and exists (
      select 1 from public.room_members member
      where member.room_id::text = split_part(realtime.topic(), ':', 2)
        and member.user_id = auth.uid()
    )
  );
