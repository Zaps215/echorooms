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

## Implementation Status

Implemented:
- A member can create a private group room through the `create_room` RPC.
- Created rooms appear in the searchable sidebar and can be selected.
- RLS requires room membership for room reads.
- The information panel scaffold exists (members, options).

Remaining:
- Direct room type.
- Member list population, invite dialogs, and invitation acceptance.
- Role display and permission gating (owner/admin only for invitations and membership).
- The `create-invitation` Edge Function with short-lived, hashed invitation tokens.
- Empty, loading, and permission-denied states.

## Definition of Done

- A user can create a private group room.
- Members and roles are visible.
- Invitations can be accepted and expired invitations are rejected.
- Non-members cannot query room data.
- Empty, loading, and permission-denied states work.
