# Prompt 06 — Panelist Domain

**Stage:** Implementation Phase — Milestone 5

**Date:** 2026-07-22

---

# Goal

Implement the first minimal Panelist business capability.

A Panelist represents either the host of a panel discussion or an expert participating in the discussion. Every Panelist must belong to an existing Discussion.

The milestone introduces the Panelist domain model, repository abstraction, in-memory repository, REST API routes with discussion existence validation, and automated API tests.

No AI generation, DeepSeek integration, discussion orchestration, streaming, database persistence, frontend functionality, or authentication is introduced.

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
- backend/src/app.ts
- backend/src/domain/discussion.ts
- backend/src/domain/message.ts
- backend/src/repositories/DiscussionRepository.ts
- backend/src/repositories/InMemoryDiscussionRepository.ts
- backend/src/repositories/MessageRepository.ts
- backend/src/repositories/InMemoryMessageRepository.ts
- backend/src/routes/discussion.ts
- backend/src/routes/message.ts
- backend/src/tests/discussion.test.ts
- backend/src/tests/message.test.ts

The backend already supported:

- Express application separation from server startup
- Vitest and Supertest test infrastructure
- Discussion domain model with `DiscussionRepository.findById()`
- Message domain model with discussion-scoped routes
- Dependency-injected application creation (`createApp` with `AppDependencies`)
- Automated health, Discussion, and Message API tests

This milestone extends the backend with panelists belonging to discussions.

---

# Prompt

```text
Implement Milestone 5: Panelist Domain.

Create the Panelist domain model, repository abstraction, in-memory
repository, REST API routes, and automated tests.

A Panelist represents a host or expert in a discussion. Every Panelist
must belong to an existing Discussion.

Domain model fields: id, discussionId, role (host | expert), name,
occupation, title, stance, color, status (waiting | preparing | speaking
| finished), currentFocus, publicSummary, createdAt.

Repository interface: create() and findByDiscussionId().

REST API at /api/discussions/:discussionId/panelists:
- GET: list panelists (404 if discussion missing)
- POST: create panelist with validation (discussion existence, role,
  name, occupation, title, stance, color)

Extend AppDependencies with panelistRepository.

Do not add AI generation, DeepSeek integration, discussion
orchestration, streaming, database persistence, frontend functionality,
or authentication.
```

---

# Files Created

```
backend/src/domain/panelist.ts
backend/src/repositories/PanelistRepository.ts
backend/src/repositories/InMemoryPanelistRepository.ts
backend/src/routes/panelist.ts
backend/src/tests/panelist.test.ts
```

---

# Files Modified

```
backend/src/app.ts
```

Only three import statements and the dependency resolution block were added — the existing Health, Discussion, and Message behavior was preserved unchanged.

---

# Output Summary

Claude Code completed the following work:

- Introduced the Panelist domain model with `PanelistRole`, `PanelistStatus`, `Panelist`, and `CreatePanelistInput`.
- Added a `PanelistRepository` abstraction with `create()` and `findByDiscussionId()`.
- Implemented `InMemoryPanelistRepository` with default status/currentFocus/publicSummary values.
- Added Panelist REST API routes with discussion existence validation and field-level validation.
- Extended `AppDependencies` with `panelistRepository` and registered the panelist router.
- Added 22 automated Panelist API tests covering GET, POST, validation, and isolation.
- All 53 tests (22 new + 31 existing) passed on the first run with no corrections needed.

---

# Domain Model

## Panelist

```ts
export type PanelistRole = "host" | "expert";

export type PanelistStatus =
  | "waiting"
  | "preparing"
  | "speaking"
  | "finished";

export interface Panelist {
  id: string;
  discussionId: string;
  role: PanelistRole;
  name: string;
  occupation: string;
  title: string;
  stance: string;
  color: string;
  status: PanelistStatus;
  currentFocus: string | null;
  publicSummary: string | null;
  createdAt: string;
}

export interface CreatePanelistInput {
  discussionId: string;
  role: PanelistRole;
  name: string;
  occupation: string;
  title: string;
  stance: string;
  color: string;
}
```

The Panelist domain is independent of Express, repository implementation, and database. Status values map to the SDD state machine concepts (waiting ≈ IDLE, preparing ≈ THINKING, speaking ≈ SPEAKING, finished ≈ COOLDOWN/COMPLETED) while keeping the domain model self-contained.

No field containing private chain-of-thought or hidden reasoning is exposed — only `currentFocus` and `publicSummary` for public-facing state.

---

# Repository Abstraction

## PanelistRepository

```ts
export interface PanelistRepository {
  create(input: CreatePanelistInput): Promise<Panelist>;
  findByDiscussionId(discussionId: string): Promise<Panelist[]>;
}
```

Unlike `DiscussionRepository`, there is no `findAll()` or `findById()` — panelists are always scoped to a discussion, so only `create` and `findByDiscussionId` are needed.

Both methods are asynchronous, allowing future database implementations without changing the application layer.

## InMemoryPanelistRepository

The in-memory implementation:

- generates UUIDs using `crypto.randomUUID()`
- generates ISO 8601 timestamps using `new Date().toISOString()`
- defaults `status` to `"waiting"`, `currentFocus` to `null`, `publicSummary` to `null`
- preserves insertion order
- filters panelists by `discussionId` in `findByDiscussionId()`
- never exposes the internal storage array directly

Discussion existence validation is intentionally not performed inside the repository — that responsibility belongs to the route layer.

---

# Routing

Panelist routes are created through dependency injection. The `createPanelistRouter` factory accepts both `PanelistRepository` and `DiscussionRepository`:

```ts
export function createPanelistRouter(
  panelistRepository: PanelistRepository,
  discussionRepository: DiscussionRepository,
): Router
```

The router is mounted at `/api/discussions/:discussionId/panelists` with `{ mergeParams: true }` so that `discussionId` flows from the parent mount point.

---

# API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/discussions/:discussionId/panelists` | List panelists for a discussion in insertion order |
| POST | `/api/discussions/:discussionId/panelists` | Create a panelist for a discussion |

---

# Validation Behavior

**Discussion existence** (checked first, returns 404):

- `GET /:discussionId/panelists` — 404 if discussion not found
- `POST /:discussionId/panelists` — 404 if discussion not found

**Role validation** (returns 400):

- Role must be `"host"` or `"expert"`
- Error: `{ "error": "Role must be host or expert" }`

**Field validation** (returns 400, checked in this order):

| Field | Error message |
|-------|---------------|
| name | `{ "error": "Name is required" }` |
| occupation | `{ "error": "Occupation is required" }` |
| title | `{ "error": "Title is required" }` |
| stance | `{ "error": "Stance is required" }` |
| color | `{ "error": "Color is required" }` |

Each field must be a non-empty string after trimming.

**Validation order**: Discussion existence → role → name → occupation → title → stance → color.

**Safe destructuring**: `req.body ?? {}` prevents exceptions when no request body is supplied.

**Trimming**: All string values are trimmed before storage. The role value is not trimmed (it is validated against exact literals).

---

# Test Coverage

Automated API tests verify:

**GET /api/discussions/:discussionId/panelists** (4 tests):

- 200 and empty array when discussion exists but has no panelists
- 404 when discussion does not exist
- insertion order preservation
- cross-discussion panelist isolation

**POST /api/discussions/:discussionId/panelists** (18 tests):

- creates a host and returns 201
- creates an expert and returns 201
- generates a UUID v4 id
- generates a valid ISO 8601 createdAt value
- defaults status to `"waiting"`
- defaults currentFocus to `null`
- defaults publicSummary to `null`
- trims all string fields
- created panelist appears in GET list
- 404 when discussion does not exist
- 400 when role is missing
- 400 when role is invalid
- 400 when name is missing, empty, or whitespace
- 400 when occupation is missing or blank
- 400 when title is missing or blank
- 400 when stance is missing or blank
- 400 when color is missing or blank
- 400 instead of throwing when no body is supplied

All tests use fresh repositories and a fresh Express app per test group. No `index.ts` or `listen()` is called.

---

# Review Corrections

No corrections were required. The implementation passed typecheck, all 53 tests, and the build on the first run.

---

# Verification

All verification commands completed successfully.

| Command | Result |
|---------|--------|
| `npm run typecheck` | ✅ Passed (0 errors) |
| `npm test` | ✅ 4 test files passed / 53 tests passed |
| `npm run build` | ✅ Backend compiled successfully |
| `git diff --check` | ✅ No whitespace issues |
| `git status --short` | ✅ 5 new files, 1 modified |

The API tests execute entirely in memory and do not require port 3000.

---

# Architecture

This milestone continues the layered architecture established in prior milestones:

```
REST API
      │
      ▼
Repository Interfaces (DiscussionRepository + PanelistRepository)
      │
      ▼
InMemory Repositories
      │
      ▼
Domain Models (Discussion + Panelist)
```

Panelist routes depend on both repositories:

```
createPanelistRouter(panelistRepository, discussionRepository)
```

This enables discussion existence validation without coupling the panelist layer to a specific discussion repository implementation.

---

# Reflection

This milestone reinforces the architectural patterns established in prior milestones:

- domain models are plain TypeScript interfaces with no framework dependencies
- repository abstractions keep the API layer decoupled from persistence
- route factories accept injected dependencies for test isolation
- `createApp` uses a single dependency object for clean extensibility
- `Router({ mergeParams: true })` enables nested resource routes

The Panelist domain intentionally limits its repository surface to `create` + `findByDiscussionId` — unlike `DiscussionRepository` which also exposes `findAll` and `findById`. This demonstrates that repository interfaces are designed for the needs of their consumers rather than following a uniform template.

The `PanelistStatus` values (`waiting`, `preparing`, `speaking`, `finished`) map conceptually to the SDD state machine while remaining agnostic to the eventual scheduling engine implementation.

The project now supports:

- creating and listing discussions
- creating and listing messages scoped to a discussion
- creating and listing panelists (hosts and experts) scoped to a discussion
- cross-discussion data isolation for both messages and panelists
- efficient discussion existence validation via `findById`

No Expert generation, AI, real-time, database, or frontend functionality has been introduced.

---

# Result

**Milestone 5 completed successfully.**

Status:

- ✅ Panelist domain implemented
- ✅ PanelistRepository abstraction established
- ✅ In-memory Panelist persistence implemented
- ✅ Panelist REST API available with discussion validation
- ✅ Six-field validation (role + 5 string fields) with stable error messages
- ✅ AppDependencies extended with panelistRepository
- ✅ 53 automated tests passed (22 new + 31 existing)
- ✅ No review corrections needed
- ✅ Ready for next milestone
