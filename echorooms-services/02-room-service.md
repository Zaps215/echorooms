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
- **Direct rooms** (`create_direct_room` RPC): private two-person rooms, reused when one exists, created by username search from the DM dialog.
- **Invite members** dialog: a room admin searches by username, calls `add_room_member`, and the room key is handed off via `shareRoomKey`/`shareMissingKeys` (0007). Invited membership appears in the member list immediately for the inviter and for the invitee on their next load.

Remaining:
- Invitation acceptance flow and short-lived hashed invite tokens (Edge Function).
- Role display and permission gating in the UI beyond owner/admin checks in the RPCs.
- `removeMember` / role change RPCs and UI.
- Empty, loading, and permission-denied states.

## Definition of Done

- A user can create a private group room.
- Members and roles are visible.
- Invitations can be accepted and expired invitations are rejected.
- Non-members cannot query room data.
- Empty, loading, and permission-denied states work.
