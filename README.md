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

Create a local `.env.local` file with the project values:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Apply the first migration through the Supabase dashboard SQL editor or with the Supabase CLI after linking your project:

```bash
supabase db push
```

Start the local frontend:

```bash
npm run dev
```

Open the URL printed by Vite. The Shared Foundation and Identity Service slices are implemented, including OTP email verification. Room creation and room listing are also available; realtime messaging and invitations are next.

## Current Checkpoint

- [x] Email/password sign-up and sign-in
- [x] Google sign-in and sign-up (shared OAuth handler on both screens)
- [x] Automatic profile creation
- [x] Email OTP verification on sign-up (6-digit code in a Telegram-style box UI) to block fake accounts
- [x] Password reset via email OTP (replaces the reset-link flow)
- [x] Profile editing with username and status
- [x] Private avatar uploads with authenticated storage policies
- [x] Session changes return unauthenticated users to the login view
- [x] Secure room creation and room listing
- [x] Centered, single-card auth layout with the logo above the form
- [x] Light theme (blue primary, amber highlights) applied across the app shell
- [x] Telegram-style three-pane app homepage (sidebar with All/Groups tabs and round avatars, chat pane, and a room-info panel that lists members)
- [x] Draft Terms &amp; Conditions and Privacy Policy pages linked from the signup form
- [ ] Realtime messaging (the chat pane currently shows a welcome state)
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
- `js/core/` holds shared concerns — the DOM registry (`dom.js`), app state (`state.js`), Supabase access (`supabase.js`), and reusable helpers (`utils.js`, `navigation.js`).
- `js/features/` holds feature logic — auth (`auth.js`), email OTP verification (`otp.js`), rooms (`rooms.js`), profile/account (`profile.js`), and chat (`chat.js`).
- `js/supabase-client.js` initializes the Supabase client.
- `supabase/migrations/` contains database migrations and RLS policies.
- `supabase/functions/` is reserved for secure Edge Functions.
- `echorooms-services/` contains the numbered service build plans.
- `ECHOROOMS_PROGRAM.md` is the complete product specification.

Never commit `.env.local` or service-role keys.

The site favicon is the Flaticon speech-bubble icon served from the official Flaticon CDN. Flaticon attribution: https://www.flaticon.com/free-icons/chat
