# 00. Shared Foundation

## Purpose

Create the common application shell, Supabase connection, design system, and migration workflow used by every later service.

## Dependencies

None.

## Owns

- Application entry points
- Environment configuration
- Shared CSS tokens and layout
- Supabase client initialization
- Database migration conventions
- Shared loading, empty, error, and permission-denied UI states

## Implementation

- Create `index.html`, `login.html`, `app.html`, and `settings.html`.
- Add `css/tokens.css`, `base.css`, `layout.css`, `components.css`, and `responsive.css`.
- Add `js/supabase-client.js`, `js/ui.js`, and the service folder.
- Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` through environment variables.
- Create the `supabase/migrations/` and `supabase/functions/` folders.
- Define the dark charcoal, coral, and cyan visual language.
- Build a responsive shell with room sidebar, conversation area, and information panel placeholders.

## Definition of Done

- The static frontend loads on desktop and mobile.
- Supabase connection succeeds without exposing private keys.
- Environment setup and migration commands are documented.
- Shared focus, loading, empty, and error states exist.
- No service-specific business logic is added to shared UI modules.
