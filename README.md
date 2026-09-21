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

Start the local frontend:

```bash
npm run dev
```

Open the URL printed by Vite. The Shared Foundation, Identity Service, Room Service, and Messaging Service slices are implemented, including OTP email verification, room creation and listing, realtime text messaging with end-to-end encryption, @username handles and direct messages. Room invitations and the reaction/media services are next.

## Current Checkpoint

- [x] Email/password sign-up and sign-in
- [x] Google sign-in and sign-up (shared OAuth handler on both screens)
- [x] Automatic profile creation
- [x] Email OTP verification on sign-up (6-digit code in a Telegram-style box UI) to block fake accounts
- [x] Password reset via email OTP (replaces the reset-link flow)
- [x] Profile editing with username and status
- [x] Dedicated Telegram-style profile page: name in the header, large centered avatar with camera badge, name/handle/status, and a row of circular action buttons (Edit, Sign out, Delete)
- [x] Confirm-on-logout and type-your-email confirm-on-delete flows via a shared confirmation dialog
- [x] Private avatar uploads with authenticated storage policies
- [x] Session changes return unauthenticated users to the login view
- [x] Secure room creation and room listing
- [x] Centered, single-card auth layout with the logo above the form
- [x] Light theme (blue primary, amber highlights) applied across the app shell
- [x] Telegram-style three-pane app homepage (sidebar with All/Groups tabs and round avatars, chat pane, and a room-info panel that lists members)
- [x] First-run homepage with a welcome greeting and "create your first room" call-to-action when a new user has no rooms
- [x] Draft Terms &amp; Conditions and Privacy Policy pages linked from the signup form
- [x] Mobile-responsive app shell: off-canvas room-list and info-panel drawers, hamburger menu, shared tap-anywhere/Escape close, safe-area insets, 16px inputs (no iOS focus-zoom), and a fixed bug where the info panel never appeared previously
- [x] Realtime messaging: paginated history, day-grouped stream, optimistic sends with retry, edit and soft-delete, and live updates per room
- [x] Required unique @username claimed on first login (onboarding dialog); used for sender labels, mention autocomplete, and direct-room search by username
- [x] Hybrid end-to-end encryption: per-room AES-GCM keys wrapped per member with RSA-OAEP identities; email/password keys recoverable via PBKDF2, social logins device-bound; edits/deletes re-encrypt
- [x] Direct rooms: search a user by username and open a private encrypted conversation
- [ ] Room invitations, acceptance, and member role management

## Commands

- `npm run dev` starts the Vite development server.
- `npm run build` creates a production build in `dist/`.
- `npm run preview` serves the production build locally.

## Project Structure

- `index.html` contains the initial application shell.
- `public/` contains static pages served as-is (Terms &amp; Conditions and Privacy Policy).
- `css/` contains the visual foundation.
- `js/main.js` is the entry point: it wires the auth-session lifecycle and bootstraps each feature module.
- `js/core/` holds shared concerns — the DOM registry (`dom.js`), app state (`state.js`), Supabase access (`supabase.js`), and reusable helpers (`utils.js`, `navigation.js`), plus the E2EE primitives (`crypto.js`) and identity/keyring manager (`keyring.js`).
- `js/features/` holds feature logic — auth (`auth.js`), email OTP verification (`otp.js`), rooms (`rooms.js`), profile/account (`profile.js`), chat (`chat.js`), and the first-run homepage (`home.js`).
- `js/supabase-client.js` initializes the Supabase client.
- `supabase/migrations/` contains database migrations and RLS policies.
- `supabase/functions/` is reserved for secure Edge Functions.
- `echorooms-services/` contains the numbered service build plans.
- `ECHOROOMS_PROGRAM.md` is the complete product specification.

Never commit `.env` or service-role keys.

The site favicon is the Flaticon speech-bubble icon served from the official Flaticon CDN. Flaticon attribution: https://www.flaticon.com/free-icons/chat
