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

## Implementation Status

Implemented:
- `messages` table, indexes, and RLS (read/insert for room members; update/delete for the sender) in `0005_messaging.sql`.
- Live `rooms.last_message_at` updates via an insert trigger; the table is in the `supabase_realtime` publication with `replica identity full`.
- `openRoom()` loads the newest 30 messages, subscribes to inserts/updates/deletes, and `closeRoom()` tears the channel down.
- Optimistic sends with sending/failed status and a retry action; edit and soft-delete via the shared confirm dialog.
- Older messages load when scrolling near the top, preserving scroll position.

Remaining:
- Reply threads (`reply_to_id` is stored but not yet shown in the UI).
- Attachment-only messages (the body check relaxes in the Media Service slice).

## Definition of Done

- Members can send, receive, edit, and delete text messages.
- Two browser sessions receive new messages in realtime.
- Message history is paginated.
- Failed messages show a retry action.
- RLS prevents access to messages in rooms the user cannot access.
