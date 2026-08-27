# 05. Media Service

## Purpose

Securely upload, store, and display message attachments.

## Dependencies

- Identity Service
- Room Service
- Messaging Service

## Owns

- `attachments` table
- Message attachment Storage bucket
- Upload validation and signed access URLs

## Contracts

- `uploadAttachment(roomId, messageId, file)`
- `getAttachmentUrl(attachmentId)`
- `deleteAttachment(attachmentId)`

## Edge Function

### `create-upload-url`

- Verify the caller belongs to the room.
- Validate MIME type and file size.
- Return a constrained upload path or signed URL.
- Never expose service-role credentials to the browser.

## Implementation

- Support image previews and generic file downloads.
- Enforce a clear maximum file size.
- Store metadata including original name, MIME type, and byte size.
- Use room membership in Storage policies.
- Show upload progress, cancellation, failure, and retry states.

## Definition of Done

- Members can upload permitted files into messages.
- Attachments render with safe previews or download controls.
- Cross-room attachment access is blocked.
- Unsupported and oversized files are rejected clearly.
- Deleted messages do not leave inaccessible orphan metadata.
