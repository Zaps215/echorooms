# 00. Shared Foundation

## Purpose

Create the common application shell, Supabase connection, design system, and migration workflow used by every later service.

## Dependencies

None.

## Owns

- Application entry point
- Environment configuration
- Shared CSS tokens and layout
- Supabase client initialization
- Database migration conventions
- Shared loading, empty, error, and permission-denied UI states

## Implementation

- Single-page app: `index.html` holds the auth views and the application shell. There is no separate `login.html` / `app.html` / `settings.html`.
- One client entry point (`js/main.js`) and one stylesheet (`css/styles.css`) with `:root` design tokens.
- `js/supabase-client.js` initializes the Supabase client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Auth pages use a centered single-card layout: a professional white card on a soft light gradient background with subtle shadows, with the EchoRooms logo centered above the form.
- Define the light visual language: white/surface base, blue primary accent, warm amber highlights.
- Create the `supabase/migrations/` and `supabase/functions/` folders.
- Build a responsive shell with a left sidebar (brand, search, All/Groups tabs, room list, and profile footer), a conversation area, and an information panel.

## Definition of Done

- The static frontend loads on desktop and mobile.
- Supabase connection succeeds without exposing private keys.
- Environment setup and migration commands are documented.
- Shared focus, loading, empty, and error states exist.
- No service-specific business logic is added to shared UI modules.
