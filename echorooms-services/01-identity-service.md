# 01. Identity Service

## Purpose

Manage authentication, profiles, sessions, and avatars.

## Dependencies

- Shared Foundation
- Supabase Auth

## Owns

- `profiles` table
- Auth session state
- Profile display name, username, status, and avatar path
- Avatar Storage bucket and policies

## Contracts

- `getCurrentUser()`
- `updateProfile(profileInput)`
- `uploadAvatar(file)`

## Implementation

- Enable email/password authentication.
- Add sign-up, login, logout, and password-reset screens.
- Add a Google social sign-in button to **both** the sign-in and sign-up screens, routed through a shared OAuth handler.
- Create a profile row when a user registers.
- Protect the application shell from unauthenticated users.
- Validate profile fields and avatar MIME type and size.
- Add RLS so users can read appropriate profiles and update only their own profile.

## Definition of Done

- A user can sign up, log in, log out, and reset a password (email + Google).
- A profile is created automatically.
- Profile updates and avatar uploads work.
- Expired sessions redirect to login.
- Users cannot modify another user's profile.
