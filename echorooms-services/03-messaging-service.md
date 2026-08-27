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

## Definition of Done

- Members can send, receive, edit, and delete text messages.
- Two browser sessions receive new messages in realtime.
- Message history is paginated.
- Failed messages show a retry action.
- RLS prevents access to messages in rooms the user cannot access.
