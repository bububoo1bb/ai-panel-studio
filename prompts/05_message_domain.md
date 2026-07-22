# Prompt 05 - Message Domain

**Stage:** Implementation Phase - Milestone 4

**Date:** 2026-07-22

---

# Goal

Implement the first minimal Message business capability.

A Message must belong to an existing Discussion. The milestone introduces the Message domain model, repository abstraction, in-memory repository, REST API routes with discussion existence validation, and automated API tests.

No database, AI functionality, authentication, frontend, expert, summary, or real-time functionality is introduced.

---

# Context

Before implementation, Claude Code was instructed to read:

- CLAUDE.md
- docs/PRD.md
- docs/SDD.md
- docs/DDD.md
- docs/TDD.md
- docs/project-analysis.md
- backend/package.json
- backend/tsconfig.json
- backend/vitest.config.ts
- backend/src/app.ts
- backend/src/index.ts
- backend/src/domain/discussion.ts
- backend/src/repositories/DiscussionRepository.ts
- backend/src/repositories/InMemoryDiscussionRepository.ts
- backend/src/routes/discussion.ts
- backend/src/tests/health.test.ts
- backend/src/tests/discussion.test.ts

The backend already supported:

- Express application separation from server startup
- Vitest and Supertest test infrastructure
- Discussion domain model
- DiscussionRepository abstraction with `create()` and `findAll()`
- InMemoryDiscussionRepository implementation
- Discussion REST API endpoints
- Dependency-injected application creation (`createApp`)
- Automated health and Discussion API tests

This milestone extends the backend with messages belonging to discussions.

---

# Prompt

```text
Implement the first minimal Message business capability.

A Message must belong to an existing Discussion.

The milestone must include:

- Message domain model
- Message repository abstraction
- In-memory Message repository
- Message REST API routes
- Discussion existence validation
- Automated API tests
- Application dependency injection for both repositories

Create or modify only backend files required for this milestone.

Expected structure:

backend/src/
├── domain/
│   ├── discussion.ts
│   └── message.ts
├── repositories/
│   ├── DiscussionRepository.ts
│   ├── InMemoryDiscussionRepository.ts
│   ├── MessageRepository.ts
│   └── InMemoryMessageRepository.ts
├── routes/
│   ├── discussion.ts
│   └── message.ts
├── tests/
│   ├── health.test.ts
│   ├── discussion.test.ts
│   └── message.test.ts
├── app.ts
└── index.ts

Do not modify frontend, shared, documentation, or prompt-record files.
```

---

# Files Created

```
backend/src/domain/message.ts
backend/src/repositories/MessageRepository.ts
backend/src/repositories/InMemoryMessageRepository.ts
backend/src/routes/message.ts
backend/src/tests/message.test.ts
```

---

# Files Modified

```
backend/src/app.ts
backend/src/repositories/DiscussionRepository.ts
backend/src/repositories/InMemoryDiscussionRepository.ts
backend/src/tests/discussion.test.ts
```

No other project infrastructure required modification.

---

# Output Summary

Claude Code completed the following work:

- Introduced the Message domain model with `MessageRole`, `Message`, and `CreateMessageInput`.
- Added a `MessageRepository` abstraction with `create()` and `findByDiscussionId()`.
- Implemented `InMemoryMessageRepository`.
- Added Message REST API routes with discussion existence validation.
- Added `findById()` to `DiscussionRepository` to enable efficient existence checks without loading all discussions.
- Refactored `createApp` to accept a dependency object (`AppDependencies`) instead of positional parameters.
- Added 18 automated Message API tests including UUID v4 validation.
- Updated the Express application to register Message routes through dependency injection.

---

# Domain Model

## Message

```ts
export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  discussionId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface CreateMessageInput {
  discussionId: string;
  role: MessageRole;
  content: string;
}
```

The Message domain is independent of Express, repository implementation, and database. It contains only the fields required for a message in a discussion.

---

# Repository Abstraction

## MessageRepository

```ts
export interface MessageRepository {
  create(input: CreateMessageInput): Promise<Message>;
  findByDiscussionId(discussionId: string): Promise<Message[]>;
}
```

Both methods are asynchronous, allowing future database implementations without changing the application layer.

## InMemoryMessageRepository

The in-memory implementation:

- generates UUIDs using `crypto.randomUUID()`
- generates ISO 8601 timestamps
- preserves insertion order
- filters messages by `discussionId` in `findByDiscussionId()`

The repository lifetime is limited to the running process.

---

# DiscussionRepository.findById Addition

During review, it was identified that the Message routes were using `findAll()` followed by `Array.find()` to check discussion existence. This was corrected by adding a dedicated `findById()` method:

```ts
findById(id: string): Promise<Discussion | null>;
```

The method:

- finds the Discussion by exact ID
- returns the Discussion when found
- returns `null` when not found

This was implemented in `InMemoryDiscussionRepository` and the Message routes were updated to use `findById()` directly.

Unit tests were added to verify both the found and not-found cases.

---

# Dependency Object Refactor

After initial implementation with positional parameters, `createApp` was refactored to accept a dependency object:

```ts
export interface AppDependencies {
  discussionRepository: DiscussionRepository;
  messageRepository: MessageRepository;
}

export function createApp(dependencies?: Partial<AppDependencies>)
```

Each dependency resolves individually with `??` fallback to its in-memory default. Tests were updated to pass `{ discussionRepository, messageRepository }` instead of positional arguments.

---

# Routing

Message routes are created through dependency injection. The `createMessageRouter` factory accepts both `MessageRepository` and `DiscussionRepository`:

```ts
export function createMessageRouter(
  messageRepository: MessageRepository,
  discussionRepository: DiscussionRepository,
): Router
```

The router is mounted at `/api/discussions/:discussionId/messages` with `{ mergeParams: true }` so that `discussionId` flows from the parent mount point.

---

# API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/discussions/:discussionId/messages` | List messages for a discussion in insertion order |
| POST | `/api/discussions/:discussionId/messages` | Create a message for a discussion |

---

# Validation Behavior

**Discussion existence** (checked first, returns 404):

- `GET /:discussionId/messages` — 404 if discussion not found
- `POST /:discussionId/messages` — 404 if discussion not found

**Role validation** (returns 400):

- Role must be `"user"` or `"assistant"`
- Error: `{ "error": "Role must be user or assistant" }`

**Content validation** (returns 400):

- Content must be a non-empty string after trimming
- Error: `{ "error": "Content is required" }`

**Safe destructuring**:

- `req.body ?? {}` prevents exceptions when no request body is supplied

---

# Test Coverage

Automated API tests verify:

**GET /api/discussions/:discussionId/messages** (4 tests):

- empty array when no messages exist
- 404 when discussion does not exist
- insertion order preservation
- cross-discussion message isolation

**POST /api/discussions/:discussionId/messages** (14 tests):

- successful creation with user role
- successful creation with assistant role
- valid ISO 8601 createdAt timestamp
- UUID v4 format validation on message ID
- content whitespace trimming
- GET integration (created message appears in list)
- 404 when discussion does not exist
- 400 when role is missing
- 400 when role is invalid
- 400 when content is missing
- 400 when content is empty string
- 400 when content is whitespace only
- 400 when content is not a string
- 400 when no request body is supplied

Additional `DiscussionRepository.findById` unit tests (2 tests):

- returns Discussion when found
- returns null when not found

---

# Review Corrections

After the initial implementation, the following corrections were made during code review:

1. **`findById` added to `DiscussionRepository`** — Replaced `findAll().find()` pattern in Message routes with a dedicated `findById(id)` method for efficient discussion existence validation.

2. **Error message format** — Changed invalid-role error from `"Role must be 'user' or 'assistant'"` to `"Role must be user or assistant"` (no quotation marks around role names).

3. **Safe destructuring** — Changed `const { role, content } = req.body` to `const { role, content } = req.body ?? {}` to handle requests with no body, preventing runtime exceptions.

4. **Dependency object refactor** — Changed `createApp(discussionRepository?, messageRepository?)` to `createApp(dependencies?: Partial<AppDependencies>)` for cleaner extensibility.

5. **UUID v4 validation** — Strengthened message ID assertion from non-empty-string check to a UUID v4 regex pattern: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.

---

# Verification

All verification commands completed successfully.

| Command | Result |
|---------|--------|
| `npm run typecheck` | ✅ Passed (0 errors) |
| `npm test` | ✅ 3 test files passed / 31 tests passed |
| `npm run build` | ✅ Backend compiled successfully |
| `git diff --check` | ✅ No whitespace issues |

The API tests execute entirely in memory and do not require port 3000.

---

# Architecture

This milestone continues the layered architecture established in Milestone 3:

```
REST API
      │
      ▼
Repository Interfaces (DiscussionRepository + MessageRepository)
      │
      ▼
InMemory Repositories
      │
      ▼
Domain Models (Discussion + Message)
```

Message routes depend on both repositories:

```
createMessageRouter(messageRepository, discussionRepository)
```

This enables discussion existence validation without coupling the message layer to a specific discussion repository implementation.

---

# Reflection

This milestone reinforces the architectural patterns established in Milestone 3:

- domain models are plain TypeScript interfaces with no framework dependencies
- repository abstractions keep the API layer decoupled from persistence
- route factories accept injected dependencies for test isolation
- `createApp` uses a single dependency object for clean extensibility

The `findById` addition to `DiscussionRepository` demonstrates how repository interfaces evolve to meet the needs of dependent modules without breaking existing implementations.

The project now supports:

- creating and listing discussions
- creating and listing messages scoped to a discussion
- cross-discussion message isolation
- efficient discussion existence validation via `findById`

No Expert, AI, real-time, database, or frontend functionality has been introduced.

---

# Result

**Milestone 4 completed successfully.**

Status:

- ✅ Message domain implemented
- ✅ MessageRepository abstraction established
- ✅ In-memory Message persistence implemented
- ✅ Message REST API available with discussion validation
- ✅ DiscussionRepository.findById added
- ✅ Dependency object refactor completed
- ✅ 31 automated tests passed
- ✅ Manual code review passed
- ✅ Ready for Milestone 5
