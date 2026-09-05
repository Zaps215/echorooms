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
- Add an email OTP verification screen (6-digit code in Telegram-style boxes) used for both sign-up and password reset, blocking fake or unreachable accounts.
- Add a Google social sign-in button to **both** the sign-in and sign-up screens, routed through a shared OAuth handler.
- Create a profile row when a user registers.
- Protect the application shell from unauthenticated users.
- Validate profile fields and avatar MIME type and size.
- Add RLS so users can read appropriate profiles and update only their own profile.
- Provide a dedicated Telegram-style profile page (opened from the sidebar footer): the display name appears as the header title, with a large centered avatar (camera badge opens editing), name, handle, and status, plus a row of circular action buttons for edit profile, sign out, and delete account.
- Route sign-out and account deletion through a shared, promise-based confirm dialog (`js/core/confirm.js`). Deletion is a danger action that requires the user to type their own email to confirm, then runs the server-side `delete_my_account` RPC.

## Definition of Done

- A user can sign up, log in, log out, and reset a password (email + Google).
- Sign-up and password reset require a one-time email code that verifies the address is reachable.
- A profile is created automatically.
- Profile updates and avatar uploads work.
- Expired sessions redirect to login.
- Users cannot modify another user's profile.
- Signing out and deleting the account both require an explicit confirmation; deletion is gated on typing the account email.
