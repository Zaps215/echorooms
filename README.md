# EchoRooms

EchoRooms is a realtime messaging workspace built with vanilla HTML, CSS, JavaScript, Supabase, and Vite.

## Requirements

- Node.js 20 or newer
- A Supabase project
- Supabase CLI for applying local migrations

## Setup

```bash
npm install
```

Create a local `.env` file with the project values (copy `.env.example`):

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Set up the database by pasting `supabase/setup.sql` into the Supabase SQL editor, or by applying the incremental files with the Supabase CLI after linking your project:

```bash
supabase db push
```

`supabase/setup.sql` is idempotent and consolidates every migration, so it is the fastest path for a fresh or recreated project. The per-file migrations in `supabase/migrations/` remain the source of truth.

An existing deployment that still has the removed features should be updated with `supabase/migrations/0015_drop_removed_features.sql`, which drops their tables, columns, RPCs, and policies. That migration is destructive — back up the project first. A fresh install already reflects the reduced schema, so it does not need it.

Start the local frontend:

```bash
npm run dev
```

Open the URL printed by Vite. The signed-in app has separate Feed and Chats sections. Feed supports text and photo posts, voice notes, likes, comments, and a profile post grid. Chats includes room creation, encrypted direct and group messaging with @username handles and mentions, member invitations, encrypted attachments, and All/Groups/Channels filters. Channels includes four bot-curated read-only streams with seeded starter updates; members can join or leave, but cannot post. Profile includes account controls and settings for appearance and browser notifications.

Feed posts and their media are separate from private room data. Posts and comments are visible to all signed-in EchoRooms members in this MVP; follows, private-account audiences, reporting, and moderation tools are not implemented. Channel updates are sample starter content, not a live external news or automated bot service. Private room messages and attachments remain end-to-end encrypted. Apply migrations `0016_social_feed.sql` and `0017_read_only_channels.sql` (or use the consolidated `supabase/setup.sql`) before using the social feed and channels with Supabase. Camera and microphone permissions are requested only after the user chooses those actions; choosing a gallery photo opens the device's file picker rather than requesting a broad gallery permission.

## Current Checkpoint

- [x] Email/password sign-up and sign-in
- [x] Google sign-in and sign-up (shared OAuth handler on both screens)
- [x] Automatic profile creation
- [x] Email OTP verification on sign-up (6-digit code in a Telegram-style box UI) to block fake accounts
- [x] Password reset via email OTP (replaces the reset-link flow)
- [x] Sign-up collects a display name and unique @username before email verification; password strength requires at least 8 characters
- [x] Sign-in and profile actions show progress, recover cleanly from request errors, and give actionable credential/network feedback
- [x] Profile editing with username and status
- [x] Dedicated Telegram-style profile page: name in the header, large centered avatar with camera badge, name/handle/status, and a row of circular action buttons (Edit, Sign out, Delete)
- [x] Confirm-on-logout and type-your-email confirm-on-delete flows via a shared confirmation dialog
- [x] Private avatar uploads with authenticated storage policies
- [x] Session changes return unauthenticated users to the login view
- [x] Instagram-inspired Feed and Chats navigation with a responsive app rail/bottom bar
- [x] Persistent text/photo community feed with camera capture, likes, comments, and post deletion
- [x] Optional voice-note posts with explicit microphone consent and browser permission prompts
- [x] Profile post grid and post count; Settings page for appearance and browser notifications
- [x] Feed media stored in a private Supabase bucket with signed viewing URLs
- [x] Feed, likes, and comments protected by authenticated-user policies and separate from encrypted room messages
- [x] Feed home with shortcuts to the user's actual private rooms
- [x] Chat sidebar filters for All, Groups, and Channels; chat colors match the blue EchoRooms logo
- [x] Four joinable, read-only bot-curated channels with seeded update streams
- [x] Secure room creation and room listing
- [x] Centered, single-card auth layout with the logo above the form
- [x] Light theme (violet social Feed, blue Chats, warm highlights)
- [x] Two-pane layout: room list (All/Groups/Channels filters, room filter, round initial avatars) beside the conversation pane
- [x] Room info slide-over with members, invites, attachments, encryption details, and clear/delete/dissolve/restore actions
- [x] Mobile single-pane layout: the room list and conversation swap via a back button, with the info panel as an overlay drawer
- [x] Draft Terms &amp; Conditions and Privacy Policy pages linked from the signup form
- [x] Realtime messaging: paginated history, day-grouped stream, optimistic sends with retry, edit and soft-delete, and live updates per room
- [x] Unique @username claimed on first login; used for sender labels, mention autocomplete, and direct-room search
- [x] Hybrid end-to-end encryption: per-room AES-GCM keys wrapped per member with RSA-OAEP identities; email/password keys recoverable via PBKDF2, social logins device-bound; edits/deletes re-encrypt
- [x] Direct rooms: search a user by username and open a private encrypted conversation
- [x] Invite members to a group room by username (room admin adds the member and hands off the group key)
- [x] Member role management and invite acceptance
- [x] Room creation with the owner automatically provisioning the room's encryption key
- [x] Replies with an inline quoted preview of the original message
- [x] E2EE attachments: encrypted image, video, audio, and document uploads
- [ ] Follow relationships, private-profile audiences, stories, reporting, and moderation controls (planned; see `ECHOROOMS_PROGRAM.md`)
- [ ] Instagram-style discovery, server search, recommendations, and AI features (planned for explicitly public/consented social content; existing chats remain end-to-end encrypted)

## Commands

- `npm run dev` starts the Vite development server.
- `npm run build` creates a production build in `dist/`.
- `npm run preview` serves the production build locally.
- `npm test` runs the unit, UI, and schema regression tests.

## Project Structure

- `index.html` contains authentication, the Feed/Chats application shell, and dialogs.
- `public/` contains static pages served as-is (Terms and Conditions and Privacy Policy).
- `css/` contains the visual foundation and responsive social-style app shell.
- `js/main.js` is the entry point: it wires the auth-session lifecycle and bootstraps each feature module.
- `js/core/` holds shared concerns — the DOM registry (`dom.js`), app state (`state.js`), Supabase access (`supabase.js`), reusable helpers (`utils.js`, `navigation.js`), Feed/Chats navigation, dialogs (`confirm.js`), the conversation header view model (`chat-header.js`), and the E2EE primitives (`crypto.js`) with the identity/keyring manager (`keyring.js`).
- `js/features/` holds feature logic — auth (`auth.js`), email OTP verification (`otp.js`), rooms and member management (`rooms.js`), profile/account/settings (`profile.js`), social feed (`feed.js`), chat (`chat.js`), and encrypted attachment handling (`media.js`).
- `js/supabase-client.js` initializes the Supabase client.
- `supabase/setup.sql` is the consolidated schema; `supabase/migrations/` contains the incremental migrations that produced it, including `0015_drop_removed_features.sql`, `0016_social_feed.sql`, and `0017_read_only_channels.sql`. `supabase/verify.sql` holds ad-hoc verification queries.
- `supabase/functions/` is reserved for secure Edge Functions.
- `tests/` contains the Node test suite. `crypto.mjs` covers the encryption primitives; `chat-header.mjs` covers the header view model; `auth-errors.mjs` covers credential/network messaging and async button state; `setup-sql.mjs` checks `setup.sql` is re-runnable; `sql-ambiguity.mjs` checks queries avoid ambiguous column references; `schema-queries.mjs` checks every table and column the client sorts or filters by actually exists; `social-feed.mjs` and `channels.mjs` check social feature schema and access behavior.
- `echorooms-services/` contains the original numbered service build plans. Several of those slices (reactions, pins, presence, 2FA, onboarding, chat settings, tasks, search) are not part of the current app.
- `ECHOROOMS_PROGRAM.md` is the complete product specification.

Never commit `.env` or service-role keys.

The site favicon is the Flaticon speech-bubble icon served from the official Flaticon CDN. Flaticon attribution: https://www.flaticon.com/free-icons/chat
