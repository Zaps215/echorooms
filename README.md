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

Open the URL printed by Vite. The signed-in app has separate Feed and Chats sections. Feed is the social-style home and links to the user's existing private rooms; Chats contains room creation and listing, encrypted direct and group messaging with @username handles and mentions, member invitations, and encrypted attachments. Published social posts and stories are planned, not yet backed by storage.

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
- [x] Feed home with shortcuts to the user's actual private rooms; no sample or public content is shown
- [x] Secure room creation and room listing
- [x] Centered, single-card auth layout with the logo above the form
- [x] Light theme (violet primary, warm highlights) applied across the app shell
- [x] Two-pane layout: room list (All/Groups tabs, room filter, round initial avatars) beside the conversation pane
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
- [ ] Persistent social posts, stories, likes, comments, and follow/privacy controls (planned; see `ECHOROOMS_PROGRAM.md`)
- [ ] Instagram-style discovery, server search, recommendations, and AI features (planned for explicitly public/consented social content; existing chats remain end-to-end encrypted)

## Commands

- `npm run dev` starts the Vite development server.
- `npm run build` creates a production build in `dist/`.
- `npm run preview` serves the production build locally.
- `npm test` runs the unit and UI smoke tests.

## Project Structure

- `index.html` contains authentication, the Feed/Chats application shell, and dialogs.
- `public/` contains static pages served as-is (Terms and Conditions and Privacy Policy).
- `css/` contains the visual foundation and responsive social-style app shell.
- `js/main.js` is the entry point: it wires the auth-session lifecycle and bootstraps each feature module.
- `js/core/` holds shared concerns — the DOM registry (`dom.js`), app state (`state.js`), Supabase access (`supabase.js`), reusable helpers (`utils.js`, `navigation.js`), Feed/Chats navigation, dialogs (`confirm.js`), the conversation header view model (`chat-header.js`), and the E2EE primitives (`crypto.js`) with the identity/keyring manager (`keyring.js`).
- `js/features/` holds feature logic — auth (`auth.js`), email OTP verification (`otp.js`), rooms and member management (`rooms.js`), profile/account (`profile.js`), chat (`chat.js`), and encrypted attachment handling (`media.js`).
- `js/supabase-client.js` initializes the Supabase client.
- `supabase/setup.sql` is the consolidated schema; `supabase/migrations/` contains the incremental migrations that produced it, including `0015_drop_removed_features.sql` which strips features from a database deployed against earlier revisions. `supabase/verify.sql` holds ad-hoc verification queries.
- `supabase/functions/` is reserved for secure Edge Functions.
- `tests/` contains the Node test suite. `crypto.mjs` covers the encryption primitives; `chat-header.mjs` covers the header view model; `auth-errors.mjs` covers credential/network messaging and async button state; `setup-sql.mjs` checks `setup.sql` is re-runnable; `sql-ambiguity.mjs` checks queries avoid ambiguous column references; `schema-queries.mjs` checks every table and column the client sorts or filters by actually exists.
- `echorooms-services/` contains the original numbered service build plans. Several of those slices (reactions, pins, presence, 2FA, onboarding, chat settings, tasks, search) are not part of the current app.
- `ECHOROOMS_PROGRAM.md` is the complete product specification.

Never commit `.env` or service-role keys.

The site favicon is the Flaticon speech-bubble icon served from the official Flaticon CDN. Flaticon attribution: https://www.flaticon.com/free-icons/chat
