# EchoRooms Services

These files split the EchoRooms program into buildable service slices. Build them in numeric order.

| Order | File | Service |
| --- | --- | --- |
| 00 | [00-shared-foundation.md](00-shared-foundation.md) | Shared foundation |
| 01 | [01-identity-service.md](01-identity-service.md) | Identity |
| 02 | [02-room-service.md](02-room-service.md) | Rooms and membership |
| 03 | [03-messaging-service.md](03-messaging-service.md) | Realtime messaging |
| 04 | [04-reaction-service.md](04-reaction-service.md) | Reactions and presence |
| 05 | [05-media-service.md](05-media-service.md) | Attachments |
| 06 | [06-task-service.md](06-task-service.md) | Tasks |
| 07 | [07-search-service.md](07-search-service.md) | Search |
| 08 | [08-ai-service.md](08-ai-service.md) | AI summaries and actions |
| 09 | [09-notifications-and-polish.md](09-notifications-and-polish.md) | Notifications and polish |

The complete product specification remains in [../ECHOROOMS_PROGRAM.md](../ECHOROOMS_PROGRAM.md). These files are implementation slices, not replacements for that full document.

## Working Rule

Keep one Supabase project and database during the MVP. Separate services by ownership, modules, RLS policies, and Edge Functions. Extract a service into its own deployment only when scale or operational ownership makes that worthwhile.
