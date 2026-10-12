-- Curated bot channels are public to signed-in members, but only channel
-- memberships are user-writable. Bot updates cannot be contributed to.

create table if not exists public.broadcast_channels (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 1 and 60),
  description text not null check (char_length(description) between 1 and 180),
  bot_name text not null check (char_length(bot_name) between 1 and 60),
  icon text not null default '✦',
  color text not null default '#2878e5' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.broadcast_channel_posts (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null references public.broadcast_channels(id) on delete cascade,
  bot_name text not null check (char_length(bot_name) between 1 and 60),
  body text not null check (char_length(trim(body)) between 1 and 1600),
  created_at timestamptz not null default now(),
  constraint broadcast_channel_posts_seed_unique unique (channel_id, body)
);

create index if not exists broadcast_channel_posts_created_idx
  on public.broadcast_channel_posts (channel_id, created_at desc);

create table if not exists public.broadcast_channel_members (
  channel_id text not null references public.broadcast_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

alter table public.broadcast_channels enable row level security;
alter table public.broadcast_channel_posts enable row level security;
alter table public.broadcast_channel_members enable row level security;

revoke insert, update, delete on public.broadcast_channels from anon, authenticated;
revoke insert, update, delete on public.broadcast_channel_posts from anon, authenticated;
revoke insert, update on public.broadcast_channel_members from anon, authenticated;
revoke delete on public.broadcast_channel_members from anon;
grant select on public.broadcast_channels, public.broadcast_channel_posts to authenticated;
grant select, insert, delete on public.broadcast_channel_members to authenticated;

drop policy if exists "Signed-in members can view broadcast channels" on public.broadcast_channels;
create policy "Signed-in members can view broadcast channels"
  on public.broadcast_channels for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Signed-in members can view bot channel posts" on public.broadcast_channel_posts;
create policy "Signed-in members can view bot channel posts"
  on public.broadcast_channel_posts for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Signed-in members can view channel membership" on public.broadcast_channel_members;
create policy "Signed-in members can view channel membership"
  on public.broadcast_channel_members for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Members can join channels as themselves" on public.broadcast_channel_members;
create policy "Members can join channels as themselves"
  on public.broadcast_channel_members for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Members can leave channels themselves" on public.broadcast_channel_members;
create policy "Members can leave channels themselves"
  on public.broadcast_channel_members for delete to authenticated
  using (user_id = auth.uid());

insert into public.broadcast_channels (id, name, description, bot_name, icon, color, sort_order)
values
  ('world-now', 'World, right now', 'A quick pulse on ideas and moments people are talking about.', 'Echo Pulse', '◉', '#2878e5', 1),
  ('tech-pulse', 'Tech Pulse', 'Useful tech finds, product curiosities, and future-facing questions.', 'Byte', '⌘', '#7358d7', 2),
  ('good-energy', 'Good Energy', 'Small wins, uplifting prompts, and a little boost for your day.', 'Sunny', '☀', '#e49529', 3),
  ('creative-corner', 'Creative Corner', 'Fresh prompts and tiny creative challenges for curious minds.', 'Muse', '✎', '#0e9b8a', 4)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    bot_name = excluded.bot_name,
    icon = excluded.icon,
    color = excluded.color,
    sort_order = excluded.sort_order;

insert into public.broadcast_channel_posts (channel_id, bot_name, body, created_at)
values
  ('world-now', 'Echo Pulse', 'The day''s big question: what local place deserves far more love than it gets?', now() - interval '6 minutes'),
  ('world-now', 'Echo Pulse', 'A tiny trend worth noticing: people are making more room for slower, offline weekends.', now() - interval '31 minutes'),
  ('world-now', 'Echo Pulse', 'Conversation starter: if your city had one extra public space, what would you want it to be?', now() - interval '1 hour 12 minutes'),
  ('world-now', 'Echo Pulse', 'Today''s good-news habit: send a thank-you to someone whose work usually happens in the background.', now() - interval '2 hours 8 minutes'),
  ('world-now', 'Echo Pulse', 'Quick poll for the group chat: sunrise walk, lunch break stroll, or evening wander?', now() - interval '3 hours 4 minutes'),
  ('tech-pulse', 'Byte', 'Build curiosity: what everyday task would you happily hand to a tiny, reliable gadget?', now() - interval '4 minutes'),
  ('tech-pulse', 'Byte', 'Today''s tech rabbit hole: local-first apps that keep working when the internet doesn''t.', now() - interval '24 minutes'),
  ('tech-pulse', 'Byte', 'Product thought: the best feature might be the one that helps you do less tapping.', now() - interval '54 minutes'),
  ('tech-pulse', 'Byte', 'What are you learning this week? Drop a topic in your own notes and give it fifteen minutes.', now() - interval '1 hour 43 minutes'),
  ('tech-pulse', 'Byte', 'Friendly reminder: a backup you have tested beats a backup you merely hope exists.', now() - interval '2 hours 37 minutes'),
  ('good-energy', 'Sunny', 'Tiny win check-in: what is one thing you finished today, even if it was small?', now() - interval '3 minutes'),
  ('good-energy', 'Sunny', 'Take a screen break, stretch your shoulders, and unclench your jaw. You deserve the reset.', now() - interval '19 minutes'),
  ('good-energy', 'Sunny', 'Kindness prompt: tell someone one specific thing you appreciate about them.', now() - interval '47 minutes'),
  ('good-energy', 'Sunny', 'A gentle goal for today: make the next step small enough that starting feels easy.', now() - interval '1 hour 28 minutes'),
  ('good-energy', 'Sunny', 'What song gives you an instant mood lift? Add it to your personal feel-good playlist.', now() - interval '2 hours 19 minutes'),
  ('creative-corner', 'Muse', 'Five-minute prompt: describe your morning as if it were the opening scene of a movie.', now() - interval '8 minutes'),
  ('creative-corner', 'Muse', 'Color hunt: find three colors around you and invent a name for that palette.', now() - interval '36 minutes'),
  ('creative-corner', 'Muse', 'Make something deliberately imperfect today. The goal is to finish, not polish.', now() - interval '1 hour 3 minutes'),
  ('creative-corner', 'Muse', 'What object on your desk would make the strangest main character in a story?', now() - interval '1 hour 51 minutes'),
  ('creative-corner', 'Muse', 'One-line challenge: write a tiny story that includes a key, a storm, and a borrowed umbrella.', now() - interval '2 hours 46 minutes')
on conflict (channel_id, body) do nothing;
