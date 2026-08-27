# 07. Search Service

## Purpose

Help users find relevant conversations without reading the entire room history.

## Dependencies

- Identity Service
- Room Service
- Messaging Service

## Owns

- Search indexes and query logic
- Search result ranking and filters
- Future message embeddings and pgvector indexes

## Contract

- `searchMessages(query, filters)`

Supported filters should include room, sender, date range, attachment presence, and pinned status.

## Implementation

- Start with Postgres full-text search and indexes.
- Filter every result by the user's room membership.
- Highlight matching text and link to the original message.
- Preserve enough context to open the room at the correct message.
- Add semantic search with pgvector only after keyword search is reliable.

## Definition of Done

- Members can search messages they are authorized to see.
- Results link to the source room and message.
- Empty, loading, and failure states work.
- Search never leaks data from private rooms.
- Search remains usable with long conversations.
