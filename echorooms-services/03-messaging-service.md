# 03. Messaging Service

## Purpose

Provide the primary realtime conversation experience.

## Dependencies

- Identity Service
- Room Service

## Owns

- `messages` table
- Message pagination and cursors
- Message body, replies, edits, and soft deletion
- Realtime message subscriptions

## Contracts

- `listMessages(roomId, cursor)`
- `sendMessage(roomId, messageInput)`
- `editMessage(messageId, body)`
- `deleteMessage(messageId)`
- `subscribeToRoom(roomId, handlers)`

## Implementation

- Display messages grouped by date.
- Add composer, send states, retry behavior, and optimistic updates.
- Support replies through `reply_to_id`.
- Support edit and soft-delete actions for the sender.
- Load older messages while scrolling upward.
- Subscribe only after room membership is confirmed.
- Clean up Realtime subscriptions when leaving a room.

## Ownership Updates (E2EE + usernames)

- Message bodies are now stored encrypted: `messages.iv` + `messages.ciphertext` are
  AES-GCM under the room's key, and `validate_message_payload` accepts either a plaintext
  `body` (legacy/verification path) or `iv+ciphertext`. The server can never read encrypted
  messages — this intentionally rules out server-side search, summarization, and AI features
  on message bodies (see program doc trade-off).
- Room keys live in `room_keys` (one AES-GCM key per room, wrapped per member with their
  RSA-OAEP public key). Key sharing/creating is owner/admin-gated; `is_room_admin`,
  `create_direct_room`, and `add_room_member` RPCs back the room keyring (0007).
- Identity keys are stored on `profiles` (`public_key`, `key_salt`,
  `encrypted_private_key`); email/password accounts wrap with PBKDF2, social logins
  use a device-bound IndexedDB copy. See `js/core/crypto.js` and `js/core/keyring.js`.
- Usernames are required for discoverability; `@username` labels, mention autocomplete,
  and direct rooms by username are implemented in the room/chat features.

## Implementation Status

Implemented:
- `messages` table, indexes, and RLS (read/insert for room members; update/delete for the sender) in `0005_messaging.sql`.
- Live `rooms.last_message_at` updates via an insert trigger; the table is in the `supabase_realtime` publication with `replica identity full`.
- `openRoom()` loads the newest 30 messages, subscribes to inserts/updates/deletes, and `closeRoom()` tears the channel down.
- Optimistic sends with sending/failed status and a retry action; edit and soft-delete via the shared confirm dialog.
- Older messages load when scrolling near the top, preserving scroll position.
- End-to-end encryption of message bodies (per-room AES-GCM key wrapped per member), with
  plaintext fallback for legacy rows. `0007_e2ee_and_usernames.sql` adds `iv`/`ciphertext`,
  `room_keys`, RPCs, and a payload validation trigger.
- `@username` sender labels, mention autocomplete in the composer, and direct rooms created
  by username search (`js/features/rooms.js` DM dialog + `create_direct_room` RPC).

Remaining:
- Reply threads (`reply_to_id` is stored but not yet shown in the UI).
- Attachment-only messages (the body check relaxes in the Media Service slice).
- Key sharing for members who are offline when a room/project key is created.

## Definition of Done

- Members can send, receive, edit, and delete text messages.
- Two browser sessions receive new messages in realtime.
- Message history is paginated.
- Failed messages show a retry action.
- RLS prevents access to messages in rooms the user cannot access.
