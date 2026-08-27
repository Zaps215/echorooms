# 09. Notification Service and Product Polish

## Purpose

Make EchoRooms dependable, accessible, and ready for production use.

## Dependencies

- Identity Service
- Room Service
- Messaging Service
- Reaction Service
- Media Service
- Task Service
- Search Service
- AI Service

## Owns

- In-app unread counts
- Notification preferences
- Future email notification Edge Function
- Cross-service quality and release checks

## Implementation

- Track the user's last read time per room.
- Add unread counts to the room sidebar.
- Add mention and direct-message notifications.
- Add notification preference controls.
- Complete mobile layout and touch interactions.
- Add keyboard navigation, visible focus states, and screen-reader labels.
- Test slow networks, offline recovery, long messages, large files, and large rooms.
- Document deployment, environment variables, backup, and account deletion behavior.

## Definition of Done

- Mobile layout is usable.
- Unread states and notifications are understandable.
- Keyboard-only navigation works for core flows.
- Core flows have automated tests.
- Production environment variables and deployment steps are documented.
- Realtime failures and service errors are observable.
