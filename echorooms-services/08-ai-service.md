# 08. AI Service

## Purpose

Summarize conversations and propose structured actions without making unapproved changes.

## Dependencies

- Identity Service
- Room Service
- Messaging Service
- Task Service

## Owns

- `room_summaries` table
- AI prompt and response validation
- AI Edge Functions

## Edge Functions

### `generate-room-summary`

- Verify room membership.
- Fetch a bounded set of recent messages.
- Remove unnecessary private metadata.
- Call the configured AI provider securely.
- Validate and store the summary.

### `extract-room-actions`

- Verify room membership.
- Analyze selected messages.
- Return proposed tasks and decisions.
- Require explicit user confirmation before creating tasks.

## Implementation

- Add a room summary action in the information panel.
- Show loading, timeout, rate-limit, and provider-error states.
- Label AI output as generated and potentially incomplete.
- Limit message count and request frequency to control cost.
- Never send data from rooms the requesting user cannot access.

## Definition of Done

- A member can request a room summary.
- The request runs only through an authorized Edge Function.
- Summaries are stored and visible to room members.
- Proposed tasks require confirmation.
- Provider keys and service-role keys never reach the browser.
