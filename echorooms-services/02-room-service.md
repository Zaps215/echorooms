# 02. Room Service

## Purpose

Create rooms, manage membership, and control room-level permissions.

## Dependencies

- Shared Foundation
- Identity Service

## Owns

- `rooms` table
- `room_members` table
- `room_invitations` table
- Room roles: `owner`, `admin`, and `member`

## Contracts

- `listUserRooms()`
- `createRoom(roomInput)`
- `getRoom(roomId)`
- `inviteMember(roomId, email)`
- `removeMember(roomId, userId)`

## Implementation

- Build recent-room sidebar and create-room dialog.
- Support direct and group room types.
- Add member list and role display.
- Add invitation creation through the `create-invitation` Edge Function.
- Use short-lived, hashed invitation tokens.
- Add RLS requiring room membership for room reads.
- Allow only owners and admins to manage invitations and membership.

## Definition of Done

- A user can create a private group room.
- Members and roles are visible.
- Invitations can be accepted and expired invitations are rejected.
- Non-members cannot query room data.
- Empty, loading, and permission-denied states work.
