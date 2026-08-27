# 06. Task Service

## Purpose

Turn useful conversation context into small, trackable actions.

## Dependencies

- Identity Service
- Room Service
- Messaging Service
- Reaction Service

## Owns

- `tasks` table
- Task status and assignment state
- Room information-panel task list

## Contracts

- `createTaskFromMessage(messageId, taskInput)`
- `updateTask(taskId, taskInput)`
- `deleteTask(taskId)`
- `listRoomTasks(roomId, filters)`

## Implementation

- Add “Create task” to each message action menu.
- Preserve the source message link on every task.
- Support title, description, assignee, due date, and status.
- Support `open`, `in_progress`, and `done` states.
- Add task list filtering and completion controls.
- Allow only room members to view tasks and authorized users to edit them.

## Definition of Done

- A member can convert a message into a task.
- Tasks can be assigned and marked complete.
- Tasks link back to their source message.
- The room panel lists open tasks.
- Unauthorized users cannot create or edit room tasks.
