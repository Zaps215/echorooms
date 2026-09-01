# EchoRooms

## Product Specification and Build Plan

EchoRooms is a realtime messaging platform that helps people communicate without losing the useful parts of their conversations.

Its core promise is:

> A messaging app that remembers, organizes, and acts on your conversations.

Unlike a basic chat clone, EchoRooms turns messages into durable knowledge. A conversation can produce decisions, tasks, files, polls, summaries, and searchable history.

---

## 1. Product Vision

### Problem

Important information disappears inside fast-moving chats. People forget decisions, lose shared files, miss tasks, and struggle to find an old conversation.

### Target users

- Student project teams
- Freelancers and clients
- Small remote teams
- Friend groups planning trips or events
- Personal users who want organized private conversations

### Main user outcome

After using EchoRooms, a user should be able to have a natural conversation and later recover what was said, what was decided, and what needs to happen next.

### Product differentiator

Every room is both a live chat and a lightweight workspace. The message stream remains central, but useful information can be promoted into structured objects.

---

## 2. Core User Experience

### Primary workflow

1. A user signs up or logs in.
2. They create a room or accept an invitation.
3. Members exchange realtime messages.
4. They reply to messages, react, upload files, and mention members.
5. A member turns a message into a task, decision, poll, or event.
6. The room automatically keeps those items visible in its information panel.
7. Members search the conversation or request an AI summary.
8. The room becomes a useful record instead of an unreadable message archive.

### Core loop

**Talk -> capture important context -> act -> return to the room.**

---

## 3. MVP Scope

### Must-have features

- Email and password authentication
- User profile with display name and avatar
- One-to-one rooms
- Group rooms
- Room membership and roles
- Realtime text messages
- Message editing and deletion
- Replies and emoji reactions
- Typing indicators and online presence
- Image and file attachments
- Room invitations
- Message search
- Pinned messages
- Tasks extracted manually from messages
- Room overview showing pinned messages and open tasks
- Responsive desktop and mobile interface

### Version 1.1 features

- AI-generated room summaries
- AI extraction of tasks and decisions
- Polls
- Scheduled messages
- Read receipts
- Unread counts and notification preferences
- Message bookmarks
- Rich link previews

### Later features

- Temporary disappearing rooms
- Calendar event objects
- Voice messages
- End-to-end encryption
- Public communities
- Integrations with external calendars and task managers
- Native mobile applications

### Explicit non-goals for the MVP

- Building a complete project-management system
- Building a social media feed
- Supporting video calls
- Supporting public discovery of private rooms
- Building custom encryption before the product workflow is validated
- Adding multiple AI providers or complex agent workflows

---

## 4. Screens and UI States

### Authentication

- Sign-up screen
- Login screen
- Password reset screen
- Loading, validation-error, and session-expired states

### Main application shell

- Left sidebar with rooms and unread counts
- Main conversation panel
- Right room-information panel on desktop
- Bottom navigation or collapsible panels on mobile

### Room list

- Recent rooms
- Search rooms
- Create-room button
- Invitation indicator
- Empty state for a new account

### Conversation view

- Room header with name, members, presence, and actions
- Message list grouped by date
- Reply threads
- Attachment previews
- Composer with text, attachment, emoji, and send controls
- Typing indicator
- Loading, disconnected, and send-failed states

### Room information panel

- Members
- Pinned messages
- Open tasks
- Recent files
- Room summary action

### Search view

- Search input
- Results grouped by room and date
- Highlighted matching text
- Empty, loading, and error states

### Settings

- Profile settings
- Avatar upload
- Notification preferences
- Theme preference
- Account deletion
- Sign out

---

## 5. Visual Direction

EchoRooms should feel like a calm, intelligent workspace rather than a noisy social feed.

- Use a clean light base with a blue primary accent and warm amber highlights.
- Use a distinctive display font for room names and headings, paired with a highly readable sans-serif for messages.
- Keep message density comfortable and scanning-friendly.
- Use color to distinguish message status, task status, presence, and system events.
- Use restrained motion for new-message arrival, panel transitions, and loading states.
- Make the conversation the primary visual focus; side panels should support it without competing.
- Ensure touch targets, composer controls, and attachment previews work on small screens.

Do not use decorative cards inside other cards. Use framed surfaces only for individual tools, dialogs, and repeated room items.

---

## 6. Service-Based Architecture

EchoRooms is separated into small logical services. Each service owns one business capability and exposes a narrow interface. During the MVP, these services run as Supabase tables, RLS policies, client modules, database functions, and Edge Functions inside one repository.

This is the practical version of microservices for a personal project: services are separated in code and responsibility first, and can be deployed independently later. Do not create a separate server and database for every feature until real scale or team ownership requires it.

### Service map

| Service | Owns | Supabase implementation | Depends on |
| --- | --- | --- | --- |
| Identity Service | Profiles, sessions, avatars | Auth, `profiles`, Storage | Supabase Auth |
| Room Service | Rooms, membership, roles, invitations | `rooms`, `room_members`, `room_invitations`, RLS | Identity |
| Messaging Service | Messages, replies, edits, deletes | `messages`, Realtime, RLS | Identity, Room |
| Reaction Service | Emoji reactions and pins | `message_reactions`, `pins`, RLS | Messaging, Room |
| Media Service | Uploads, metadata, access URLs | Storage, `attachments`, upload Edge Function | Identity, Room, Messaging |
| Task Service | Tasks extracted from messages | `tasks`, task Edge Functions, RLS | Identity, Room, Messaging |
| Search Service | Keyword and semantic message search | Postgres indexes, later pgvector | Identity, Room, Messaging |
| AI Service | Summaries and proposed actions | Edge Functions, `room_summaries` | Identity, Room, Messaging, Task |
| Notification Service | In-app and future email notifications | Realtime, notification Edge Function | Identity, Room, Messaging |

### Service rules

- A service may write only the tables it owns, except through an explicit database function or Edge Function contract.
- Services communicate through typed function inputs and outputs, not by reaching into another service's UI state.
- Room membership is the authorization dependency for every room-scoped service.
- Realtime broadcasts database changes; it is not a replacement for authorization.
- The browser uses the Supabase anon key. Service-role keys stay inside Edge Functions.
- Each service should have its own folder, tests, migration notes, and acceptance criteria.

### Future extraction path

If EchoRooms grows beyond Supabase's simple boundaries, extract services in this order:

1. AI Service into a separate worker because AI calls have different latency and cost behavior.
2. Notification Service into a queue-backed worker because delivery can be asynchronous.
3. Search Service into a dedicated search provider if Postgres search becomes a bottleneck.
4. Messaging Service only when message volume, fan-out, or operational ownership justifies it.

Keep one Postgres database and one deployment during the MVP.

---

## 7. Database Model

### profiles

- `id uuid primary key references auth.users(id)`
- `username text unique`
- `display_name text not null`
- `avatar_path text`
- `status_text text`
- `created_at timestamptz`
- `updated_at timestamptz`

### rooms

- `id uuid primary key`
- `name text not null`
- `room_type text not null` (`direct` or `group`)
- `created_by uuid references profiles(id)`
- `last_message_at timestamptz`
- `created_at timestamptz`

### room_members

- `room_id uuid references rooms(id)`
- `user_id uuid references profiles(id)`
- `role text not null` (`owner`, `admin`, or `member`)
- `last_read_at timestamptz`
- `joined_at timestamptz`
- Primary key: `room_id, user_id`

### messages

- `id uuid primary key`
- `room_id uuid references rooms(id) on delete cascade`
- `sender_id uuid references profiles(id)`
- `body text`
- `reply_to_id uuid references messages(id)`
- `edited_at timestamptz`
- `deleted_at timestamptz`
- `created_at timestamptz`

At least one of `body` or an attachment must exist for a message.

### message_reactions

- `message_id uuid references messages(id) on delete cascade`
- `user_id uuid references profiles(id) on delete cascade`
- `emoji text not null`
- `created_at timestamptz`
- Primary key: `message_id, user_id, emoji`

### attachments

- `id uuid primary key`
- `message_id uuid references messages(id) on delete cascade`
- `room_id uuid references rooms(id) on delete cascade`
- `uploaded_by uuid references profiles(id)`
- `storage_path text not null`
- `file_name text not null`
- `mime_type text not null`
- `file_size bigint not null`
- `created_at timestamptz`

### pins

- `room_id uuid references rooms(id) on delete cascade`
- `message_id uuid references messages(id) on delete cascade`
- `pinned_by uuid references profiles(id)`
- `created_at timestamptz`
- Primary key: `room_id, message_id`

### tasks

- `id uuid primary key`
- `room_id uuid references rooms(id) on delete cascade`
- `source_message_id uuid references messages(id)`
- `title text not null`
- `description text`
- `assigned_to uuid references profiles(id)`
- `created_by uuid references profiles(id)`
- `status text not null` (`open`, `in_progress`, or `done`)
- `due_at timestamptz`
- `created_at timestamptz`
- `updated_at timestamptz`

### room_invitations

- `id uuid primary key`
- `room_id uuid references rooms(id) on delete cascade`
- `invited_by uuid references profiles(id)`
- `invitee_email text not null`
- `token_hash text unique not null`
- `status text not null` (`pending`, `accepted`, or `expired`)
- `expires_at timestamptz not null`
- `created_at timestamptz`

### room_summaries

- `id uuid primary key`
- `room_id uuid references rooms(id) on delete cascade`
- `requested_by uuid references profiles(id)`
- `summary text not null`
- `message_count integer not null`
- `created_at timestamptz`

---

## 8. Security and Data Rules

Row Level Security is required on every user-owned table.

- A user can read a room only when they are a member.
- A user can read messages only from rooms they belong to.
- A user can insert messages only as themselves and only into rooms they belong to.
- A user can update or delete only their own messages, except room admins may moderate messages according to the product policy.
- A user can manage reactions only for their own account.
- Only room owners and admins can invite members, pin messages, or manage membership.
- Storage policies must verify room membership before allowing attachment access.
- File uploads must enforce size and MIME-type limits.
- Search results must be filtered by room membership.
- AI requests must never send data from rooms the requesting user cannot access.
- Account deletion must remove or anonymize all user-owned records according to the chosen retention policy.

Never trust room IDs, user IDs, or permissions supplied by the browser. Supabase policies are the final authorization boundary.

---

## 9. Realtime Behavior

Subscribe to a room only after confirming that the current user is a member.

Realtime events should support:

- New message insertion
- Message edits and soft deletions
- Reaction changes
- Pin changes
- Task changes
- Presence updates
- Typing indicators

The client should optimistically display a sent message, reconcile it with the database response, and show a retry action when delivery fails. Pagination should load older messages when the user scrolls upward. Do not load the entire room history at once.

Typing indicators should be ephemeral and should not be stored in Postgres. Presence should show active, idle, or offline states without pretending to provide exact user activity.

---

## 10. Frontend Responsibilities

Use HTML, CSS, and JavaScript for the first frontend. The client should be split by service rather than one large script.

Suggested structure:

```text
echorooms/
|-- index.html
|-- login.html
|-- app.html
|-- settings.html
|-- css/
|   |-- tokens.css
|   |-- base.css
|   |-- layout.css
|   |-- components.css
|   `-- responsive.css
|-- js/
|   |-- supabase-client.js
|   |-- services/
|   |   |-- identity-service.js
|   |   |-- room-service.js
|   |   |-- messaging-service.js
|   |   |-- reaction-service.js
|   |   |-- media-service.js
|   |   |-- task-service.js
|   |   |-- search-service.js
|   |   |-- ai-service.js
|   |   `-- notification-service.js
|   |-- realtime/
|   |   |-- message-events.js
|   |   |-- presence-events.js
|   |   `-- room-events.js
|   `-- ui.js
|-- supabase/
|   |-- migrations/
|   `-- functions/
|       |-- create-invitation/
|       |-- create-upload-url/
|       |-- generate-room-summary/
|       `-- extract-room-actions/
`-- README.md
```

The frontend should handle loading, empty, permission-denied, offline, and failure states as carefully as successful states.

---

## 11. Service Contracts and Edge Functions

Most normal CRUD operations can use the Supabase JavaScript client directly with RLS. The following contracts keep the frontend independent from table details:

### Identity Service

- `getCurrentUser()`
- `updateProfile(profileInput)`
- `uploadAvatar(file)`

### Room Service

- `listUserRooms()`
- `createRoom(roomInput)`
- `getRoom(roomId)`
- `inviteMember(roomId, email)`
- `removeMember(roomId, userId)`

### Messaging Service

- `listMessages(roomId, cursor)`
- `sendMessage(roomId, messageInput)`
- `editMessage(messageId, body)`
- `deleteMessage(messageId)`
- `subscribeToRoom(roomId, handlers)`

### Reaction, Media, Task, and Search Services

- `toggleReaction(messageId, emoji)`
- `pinMessage(roomId, messageId)`
- `uploadAttachment(roomId, messageId, file)`
- `createTaskFromMessage(messageId, taskInput)`
- `updateTask(taskId, taskInput)`
- `searchMessages(query, filters)`

Use Edge Functions for operations that require secrets, privileged access, or external services:

### `generate-room-summary`

- Verify the caller is a room member.
- Fetch a bounded set of recent messages.
- Send sanitized context to the configured AI provider.
- Store the resulting summary.
- Return the summary ID and text.

### `extract-room-actions`

- Verify room membership.
- Analyze selected messages.
- Return proposed tasks and decisions.
- Require user confirmation before inserting structured records.

### `create-invitation`

- Verify owner or admin permission.
- Create a short-lived invitation token.
- Store only a hash of the token.
- Send or return the invitation link.

### `create-upload-url`

- Verify room membership.
- Validate the requested file type and size.
- Return a constrained upload path or signed URL.

---

## 12. Microservice Build Order

Build one vertical service at a time. Every service must be useful through the UI before starting the next one.

### Service 0: Shared foundation

Definition of done:

- Static frontend loads.
- Supabase project is connected through environment variables.
- Database migration workflow is documented.
- Basic design tokens and responsive shell exist.

### Service 1: Identity Service

Definition of done:

- A user can sign up, log in, log out, and reset a password.
- A profile row is created automatically.
- Unauthenticated users cannot access the app shell.

### Service 2: Room Service

Definition of done:

- A user can create a group room.
- Room members are listed.
- Unauthorized users cannot query the room.
- Empty and error states are implemented.

### Service 3: Messaging Service

Definition of done:

- Members can send, receive, edit, and delete text messages.
- Messages are paginated.
- Realtime subscriptions clean up when leaving a room.
- Failed sends can be retried.

### Service 4: Reaction Service

Definition of done:

- Replies and reactions work.
- Typing and presence indicators work.
- Messages can be pinned.

### Service 5: Media Service

Definition of done:

- Members can upload permitted files.
- Attachments appear in messages.
- Storage rules prevent cross-room access.
- Oversized and unsupported files are rejected clearly.

### Service 6: Task Service

Definition of done:

- A member can convert a message into a task.
- Tasks can be assigned and marked complete.
- The room panel lists pins, tasks, and recent files.

### Service 7: Search Service

Definition of done:

- Members can search messages they are authorized to see.
- Results link back to the original room and message.
- Search handles empty, loading, and failure states.

### Service 8: AI Service

Definition of done:

- A member can request a room summary.
- The request runs through an Edge Function.
- The summary is stored and visible to room members.
- The UI communicates that AI output may be incomplete.

### Service 9: Notification Service and polish

Definition of done:

- Mobile layout is usable.
- Keyboard navigation and focus states work.
- Notifications and unread states are understandable.
- Core flows have automated tests.
- Production environment variables and deployment steps are documented.

---

## 13. Testing Strategy

### Unit tests

- Message validation
- Room permission helpers
- Search query construction
- Attachment validation
- Task status transitions
- Date grouping and unread-count calculations

### Integration tests

- Authentication flow
- Room creation
- RLS access boundaries
- Message creation and editing
- Attachment access
- Invitation acceptance
- Edge Function authorization

### Browser tests

- Sign up and log in
- Create a room
- Send a message from two browser sessions
- Reply and react to a message
- Upload an attachment
- Create and complete a task
- Search for a message
- Verify a non-member cannot access a private room

### Manual checks

- Slow network and offline recovery
- Mobile viewport behavior
- Long messages and large image previews
- Empty rooms and rooms with thousands of messages
- Keyboard-only navigation
- Screen-reader labels for icon buttons

---

## 14. Environment Variables

The frontend needs only public Supabase values:

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

Edge Functions may use private values such as:

```text
AI_PROVIDER_API_KEY=
INVITATION_EMAIL_PROVIDER_KEY=
```

Do not commit `.env` files or private keys. Keep your local `.env.local` values out of version control.

---

## 15. Success Signals

For the first usable release, measure:

- Percentage of signed-up users who create or join a room
- Messages sent per active room
- Percentage of rooms with at least one pinned item or task
- Search usage and successful result clicks
- Weekly returning users
- AI summary requests that are completed successfully
- Attachment upload success rate
- Realtime delivery failures

The most important qualitative question is:

> Can a user return to a busy room and understand what matters without reading every message?

---

## 16. First Implementation Task

Create the Supabase project and complete Slice 1:

1. Create a Supabase project.
2. Enable email authentication.
3. Create the local folder structure.
4. Add the public environment variables.
5. Build the app shell with room sidebar, conversation area, and information panel.
6. Add the first database migration for `profiles`, `rooms`, and `room_members`.
7. Write and test the initial RLS policies before adding messages.

The first milestone is not a full messaging product. It is a user who can securely log in, create a private room, and see the correct empty-room interface on desktop and mobile.