# 04. Reaction Service

## Purpose

Add lightweight conversation interactions and room activity signals.

## Dependencies

- Identity Service
- Room Service
- Messaging Service

## Owns

- `message_reactions` table
- `pins` table
- Ephemeral typing indicators
- Realtime presence state

## Contracts

- `toggleReaction(messageId, emoji)`
- `pinMessage(roomId, messageId)`
- `unpinMessage(roomId, messageId)`
- `subscribeToPresence(roomId, handlers)`
- `broadcastTyping(roomId, isTyping)`

## Implementation

- Add emoji picker and reaction counts.
- Allow users to add or remove their own reactions.
- Allow owners and admins to pin and unpin messages.
- Add online, idle, and offline presence.
- Keep typing indicators out of Postgres.
- Show pinned messages in the room information panel.

## Definition of Done

- Reactions update for all connected members.
- Users can manage only their own reactions.
- Pins are visible and permission-protected.
- Typing indicators are ephemeral.
- Presence subscriptions are removed when leaving a room.
