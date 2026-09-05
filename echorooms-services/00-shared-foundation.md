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
- `js/main.js` is the single client entry point; it wires the auth-session lifecycle and bootstraps the feature modules.
- `js/core/` holds shared concerns: `dom.js` (DOM registry), `state.js` (app state), `supabase.js` (client access), `utils.js` (helpers), `navigation.js` (shell/auth-form navigation).
- `js/features/` holds feature logic, one module per area: `auth.js`, `otp.js`, `rooms.js`, `profile.js`, `chat.js`, `home.js` (first-run homepage).
- `js/supabase-client.js` initializes the Supabase client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- One stylesheet (`css/styles.css`) with `:root` design tokens.
- Auth pages use a centered single-card layout: a professional white card on a soft light gradient background with subtle shadows, with the EchoRooms logo centered above the form.
- Define the light visual language: white/surface base, blue primary accent, warm amber highlights.
- Create the `supabase/migrations/` and `supabase/functions/` folders.
- Build a responsive shell with a left sidebar (brand, search, All/Groups tabs, room list, and profile footer), a conversation area, and an information panel.
- Show a first-run homepage with a welcome greeting and a "create your first room" call-to-action when a signed-in user has no rooms to open.
- Make the shell mobile-first: below `720px` the sidebar becomes an off-canvas drawer opened from a hamburger button (home header) and the back arrow (chat header); below `1080px` the information panel becomes a right-hand drawer opened from the room header. A shared backdrop plus Escape closes either drawer, with all drawer logic centralized in `core/navigation.js`.
- Respect viewport safe-area insets, use `100dvh` for the app height, and size form/chat inputs at 16px to prevent iOS focus-zoom.

## Definition of Done

- The static frontend loads on desktop and mobile.
- The info panel appears on desktop as the right column and on mobile as an openable right-hand drawer (it was previously hidden entirely).
- Drawers open/close via a shared backdrop and Escape without per-feature drawer juggling.
- Supabase connection succeeds without exposing private keys.
- Environment setup and migration commands are documented.
- Shared focus, loading, empty, and error states exist.
- No service-specific business logic is added to shared UI modules.
