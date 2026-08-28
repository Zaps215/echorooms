# EchoRooms

EchoRooms is a realtime messaging workspace built with vanilla HTML, CSS, JavaScript, Supabase, and Vite.

## Requirements

- Node.js 20 or newer
- A Supabase project
- Supabase CLI for applying local migrations

## Setup

```bash
npm install
cp .env.example .env.local
```

Add the project values to `.env.local`:

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

Open the URL printed by Vite. The Shared Foundation and Identity Service slices are implemented. Room creation and room listing are also available; invitations and membership management are next.

## Current Checkpoint

- [x] Email/password sign-up and sign-in
- [x] Google sign-in and secure sign-out
- [x] Automatic profile creation
- [x] Password reset email and new-password recovery flow
- [x] Profile editing with username and status
- [x] Private avatar uploads with authenticated storage policies
- [x] Session changes return unauthenticated users to the login view
- [x] Secure room creation and room listing
- [ ] Room invitations, acceptance, and member role management

## Commands

- `npm run dev` starts the Vite development server.
- `npm run build` creates a production build in `dist/`.
- `npm run preview` serves the production build locally.

## Project Structure

- `index.html` contains the initial application shell.
- `css/` contains the visual foundation.
- `js/` contains the Supabase client and frontend modules.
- `supabase/migrations/` contains database migrations and RLS policies.
- `supabase/functions/` is reserved for secure Edge Functions.
- `echorooms-services/` contains the numbered service build plans.
- `ECHOROOMS_PROGRAM.md` is the complete product specification.

Never commit `.env.local` or service-role keys.

The site favicon is the Flaticon speech-bubble icon served from the official Flaticon CDN. Flaticon attribution: https://www.flaticon.com/free-icons/chat
