# Prompt 12 — Discussion Engine

**Stage:** Implementation Phase — Milestone 11

**Date:** 2026-07-22

---

# Goal

Implement a `DiscussionEngine` application-layer service that orchestrates multiple discussion rounds.

Existing responsibilities remain unchanged:

- `RoundController` executes one panelist turn.
- `DiscussionController` executes one complete round across active panelists.
- `DiscussionEngine` executes multiple rounds for one discussion session.

The intended execution hierarchy is:

```
DiscussionEngine
        ↓
DiscussionController
        ↓
RoundController
        ↓
AIService
```

`DiscussionEngine` must not call `AIService` or `PromptBuilder` directly. It depends on `DiscussionController` for round execution and on `DiscussionRepository` / `PanelistRepository` for lifecycle checks.

The engine introduces a required `maxRounds` safety boundary — there is no unbounded execution.

---

# Context

Before implementation, Claude Code was instructed to read:

- CLAUDE.md
- docs/PRD.md
- docs/SDD.md
- docs/DDD.md
- docs/TDD.md
- all existing Prompt Records
- backend/package.json
- backend/tsconfig.json
- backend/src/app.ts
- backend/src/index.ts
- backend/src/controllers/RoundController.ts
- backend/src/controllers/DiscussionController.ts
- backend/src/domain/*
- backend/src/repositories/*
- backend/src/ai/*
- backend/src/tests/*

The backend already supported:

- `Discussion` domain model (id, title, createdAt — no status field)
- `Panelist` domain model with `PanelistStatus` (`"waiting" | "preparing" | "speaking" | "finished"`)
- `Message` domain model
- `DiscussionRepository`, `PanelistRepository`, `MessageRepository` abstractions with in-memory implementations
- `AIService` interface with `MockAIService` and `DeepSeekAIService`
- `PromptBuilder` for constructing provider-independent AI messages
- `RoundController` — executes a single panelist turn (validation, prompt construction, AI generation, message persistence)
- `DiscussionController` — orchestrates one complete discussion round across all active panelists
- `createAIService` factory and `loadAppConfig` for provider selection
- Express application with dependency injection via `createApp(dependencies?)` and `AppDependencies`
- Vitest test infrastructure
- 193 tests across 11 test files, all passing

The `Discussion` domain entity had no `status` field. The SDD (Section 4) documents `status` as a Discussion field, but it had not yet been added to the TypeScript interface. This was a documented compile-time incompatibility that needed to be resolved before the engine could check whether a discussion is finished.

At the end of Milestone 10, the dependency graph supported both testing and production through the `AIService` interface, but no multi-round orchestration layer existed. Milestone 11 introduces that layer.

---

# Prompt

```text
Implement a DiscussionEngine that orchestrates multiple discussion rounds.

Existing responsibilities must remain:

- RoundController executes one panelist turn.
- DiscussionController executes one complete round across active panelists.
- DiscussionEngine executes multiple rounds for one discussion session.

The intended execution hierarchy is:

DiscussionEngine
        ↓
DiscussionController
        ↓
RoundController
        ↓
AIService

DiscussionEngine must not call AIService or PromptBuilder directly.

Core Responsibility:

Create a small application-layer service at:

backend/src/services/DiscussionEngine.ts

Expose a method:

runDiscussion({
  discussionId,
  maxRounds,
}): Promise<Message[]>

The engine should:

1. Validate maxRounds.
2. Load the discussion before each round.
3. Stop before executing a round when the discussion is already finished.
4. Load the panelists before each round.
5. Stop when no active panelists remain.
6. Execute exactly one round through DiscussionController.
7. Append the returned messages in execution order.
8. Repeat until maxRounds reached, discussion finished, or no active panelists.
9. Return all generated messages in chronological execution order.

maxRounds is a required safety boundary. No unbounded while-loop.

Validation: maxRounds must be a number, finite, integer, greater than zero.
Invalid values must throw a clear Error before any dependency is called.

Rounds execute sequentially via an awaited loop. No Promise.all or parallel execution.

Messages preserve Round 1 → Round 2 → Round 3 chronological order.

Stop conditions evaluated before every round:
1. Discussion status is "finished" → stop
2. No panelists with status !== "finished" → stop
3. maxRounds reached → stop

Dependencies via constructor injection:
- DiscussionController
- DiscussionRepository
- PanelistRepository

Do not inject AIService, PromptBuilder, or MessageRepository.

Error propagation: let errors propagate naturally. No swallowing, retries, or wrapping.

No domain mutation: do not add round counters, new statuses, or automatic transitions.
Do not mark discussions as finished when maxRounds is reached.

Do not wire into REST routes, app.ts, or index.ts.

Testing: focused unit tests using mocks/stubs/in-memory repos. At minimum cover
validation, sequential execution, stop conditions, error propagation, and message ordering.
```

---

# Files Created

```
backend/src/services/DiscussionEngine.ts           (104 lines)
backend/src/tests/discussion-engine.test.ts         (620 lines)
```

The `services/` directory is new. The `controllers/` directory already existed from Milestones 7–8.

---

# Files Modified

```
backend/src/domain/discussion.ts                                    (+5 lines)
backend/src/repositories/InMemoryDiscussionRepository.ts            (+1 line)
backend/src/tests/prompt-builder.test.ts                            (+1 line)
```

### Discussion.status — Minimal Domain Addition

The `Discussion` domain entity had no `status` field. This was a documented compile-time incompatibility: the SDD (Section 4) lists `status` as a Discussion field, and the engine needs to check whether a discussion is finished before executing a round.

The minimal change added:

```ts
/** The lifecycle status of a discussion. */
export type DiscussionStatus = "active" | "finished";

export interface Discussion {
  // ... existing fields ...
  /** Current lifecycle status. New discussions start as "active". */
  status: DiscussionStatus;
  // ...
}
```

`InMemoryDiscussionRepository.create()` defaults new discussions to `status: "active"`.

The `prompt-builder.test.ts` fixture (`sampleDiscussion`) was updated with `status: "active"` to satisfy the new required field.

No other domain entity, repository interface, controller, route, or application file required modification.

---

# Discussion Engine

## Public API

```ts
export interface RunDiscussionRequest {
  discussionId: string;
  maxRounds: number;
}

export class DiscussionEngine {
  constructor(deps: {
    discussionController: DiscussionController;
    discussionRepository: DiscussionRepository;
    panelistRepository: PanelistRepository;
  });

  runDiscussion(request: RunDiscussionRequest): Promise<Message[]>;
}
```

### Constructor Dependency Injection

The engine accepts three dependencies via a constructor options object:

| Dependency | Interface | Purpose |
|---|---|---|
| `discussionController` | `DiscussionController` | Delegate each round execution |
| `discussionRepository` | `DiscussionRepository` | Reload discussion before each round; check `status` |
| `panelistRepository` | `PanelistRepository` | Reload panelists before each round; count active |

The engine depends only on abstractions — never on concrete implementations such as `InMemoryDiscussionRepository`, `InMemoryPanelistRepository`, `MockAIService`, or `DeepSeekAIService`.

Notably, `DiscussionEngine` does **not** receive `AIService`, `PromptBuilder`, `MessageRepository`, or `RoundController`. These are owned exclusively by `DiscussionController` and `RoundController`. The engine delegates all round execution to `DiscussionController`, which in turn delegates each panelist turn to `RoundController`.

### Responsibility Boundaries

`DiscussionEngine` must **never** directly call:

| Component | Reason |
|---|---|
| `AIService` | Owned by `RoundController` |
| `PromptBuilder` | Owned by `RoundController` |
| `MessageRepository` | Owned by `RoundController` |
| `RoundController` | Owned by `DiscussionController` |

`DiscussionEngine` does **not**:

- construct prompts
- call AI providers
- persist messages
- validate discussion existence (beyond the `findById` null check)
- validate panelist membership
- manage panelist state transitions
- mutate discussion or panelist status

All of the above remain the exclusive responsibility of `DiscussionController` and `RoundController`.

---

# Discussion Lifecycle

## DiscussionStatus

A new minimal type was introduced to close the gap between the TypeScript domain model and the SDD:

```ts
export type DiscussionStatus = "active" | "finished";
```

The `Discussion` interface gained a `status` field of this type. New discussions default to `status: "active"` through `InMemoryDiscussionRepository.create()`.

The engine **reads** `discussion.status` before every round to decide whether to continue. It **never writes** to it. No lifecycle transition logic was introduced — marking a discussion as `"finished"` is the responsibility of a future milestone.

`DiscussionStatus` mirrors the pattern already established by `PanelistStatus` (`"waiting" | "preparing" | "speaking" | "finished"`), where `"finished"` is the terminal/inactive state.

## Panelist Active Semantics

The engine reuses the existing `PanelistStatus` semantics without modification:

- `"finished"` is the only inactive terminal state
- `"waiting"`, `"preparing"`, and `"speaking"` are all considered active

This is the same interpretation used by `DiscussionController` and `RoundController`. The engine filters with `panelist.status !== "finished"` — identical to `DiscussionController.executeDiscussion()`.

---

# Execution Flow

`runDiscussion()` performs operations in this exact order:

```
1. Validate maxRounds
   → throw on invalid input before any dependency call

2. For each round (for loop, round = 0; round < maxRounds; round++):
   a. Reload discussion via DiscussionRepository.findById()
      → null: throw "Discussion not found"
      → status === "finished": break

   b. Reload panelists via PanelistRepository.findByDiscussionId()
      → filter status !== "finished"
      → none active: break

   c. Execute one round via DiscussionController.executeDiscussion()
      → collect returned Messages

   d. Append Messages to accumulator (allMessages.push(...roundMessages))

3. Return all accumulated Messages
```

Each step is awaited. No two rounds execute concurrently. The loop is a plain `for` statement — there is no `while(true)` anywhere in the engine.

---

# Validation

`maxRounds` is validated synchronously before any repository or controller call:

| Invalid Input | Error Message |
|---|---|
| `0` | `"maxRounds must be greater than zero"` |
| Negative (e.g., `-1`) | `"maxRounds must be greater than zero"` |
| Fractional (e.g., `2.5`) | `"maxRounds must be an integer"` |
| `NaN` | `"maxRounds must be finite"` |
| `Infinity` | `"maxRounds must be finite"` |
| Non-number (e.g., `"3"`) | `"maxRounds must be a number"` |

No coercion, no silent defaults. Validation gates all dependency access — if validation fails, no repository method or controller method is invoked.

---

# Stop Conditions

Evaluated in order before every round:

1. **Discussion finished**: `discussion.status === "finished"` → `break`. The engine reloads the discussion via `DiscussionRepository.findById()` before each round, so a discussion that becomes finished between rounds is detected before the next round executes.

2. **No active panelists**: `panelists.filter(p => p.status !== "finished").length === 0` → `break`. The engine reloads panelists via `PanelistRepository.findByDiscussionId()` before each round, so panelists that become finished between rounds are detected.

3. **maxRounds reached**: the `for` loop's natural termination.

Only `PanelistStatus.finished` is treated as inactive. Panelists with status `"waiting"`, `"preparing"`, or `"speaking"` are all considered active — consistent with `DiscussionController` and `RoundController`.

Reaching `maxRounds` stops execution but does **not** mark the discussion as finished. The domain entity's status is never mutated by the engine.

---

# Dependency Injection

### Constructor

```ts
constructor(deps: {
  discussionController: DiscussionController;
  discussionRepository: DiscussionRepository;
  panelistRepository: PanelistRepository;
})
```

The engine receives exactly the three dependencies required for orchestration:

- `DiscussionController` — executes one round
- `DiscussionRepository` — reloads discussion state
- `PanelistRepository` — reloads panelist state

No other dependency is accepted or used.

### Not Injected

The following are intentionally **not** injected into `DiscussionEngine`:

- `AIService` — owned by `RoundController`
- `MockAIService` — concrete implementation, not an abstraction
- `DeepSeekAIService` — concrete implementation, not an abstraction
- `PromptBuilder` — owned by `RoundController`
- `MessageRepository` — owned by `RoundController`
- `RoundController` — wrapped by `DiscussionController`

### Not Wired into Application Startup

`DiscussionEngine` is not instantiated in `app.ts` or `index.ts`. It is not wired into REST routes. Application and HTTP integration is deferred to a later milestone.

---

# Error Handling

### Error Propagation

`DiscussionEngine` does not catch or transform errors from its dependencies:

- **DiscussionRepository errors** — propagate unchanged from `findById()`
- **PanelistRepository errors** — propagate unchanged from `findByDiscussionId()`
- **DiscussionController errors** — propagate unchanged from `executeDiscussion()`
- **RoundController / AIService errors** — propagate through `DiscussionController` without interception

No `try/catch` blocks exist in `runDiscussion()`. Every error thrown by a dependency reaches the caller in its original form.

### Stop on First Failure

When any dependency throws:

1. Execution stops immediately — the `for` loop exits via the uncaught exception.
2. Later rounds are never executed.
3. Messages from earlier successful rounds are discarded (the function rejects before returning).
4. The error is propagated unchanged to the caller.

Messages already persisted by completed earlier rounds are **not rolled back**. This is documented in code comments only — no compensating transaction logic is introduced.

### No Retry or Recovery

The engine does not:

- retry failed rounds
- return partial success objects
- wrap errors with additional context
- continue to later rounds after a failure

---

# Testing

### Test Infrastructure

All tests use lightweight test doubles and stubs. No Express app is created and no `listen()` is called. No real AI API is invoked.

Test doubles defined in the test file:

| Double | Purpose |
|---|---|
| `StubDiscussionController` | Returns configurable Message batches per call; records every `executeDiscussion()` call and arguments |
| `FailingDiscussionController` | Throws on every `executeDiscussion()` call — verifies error propagation |
| `FailingOnNthCallController` | Throws on the N-th call (configurable), returns synthetic Messages for earlier calls — verifies execution stops after first failure |
| `StubDiscussionRepository` | Returns a configurable Discussion from `findById()`; supports changing the discussion between calls to simulate "becoming finished" |
| `FailingDiscussionRepository` | Throws on every method — verifies repository error propagation and validation ordering |
| `StubPanelistRepository` | Returns configurable Panelist lists from `findByDiscussionId()`; supports changing the list between calls to simulate panelists becoming finished |
| `FailingPanelistRepository` | Throws on every method — verifies repository error propagation |

Inline `DiscussionRepository` and `PanelistRepository` stubs are used in tests that require dynamic behavior (e.g., changing status between calls to verify reload-before-every-round behavior).

### Test Coverage

**30 new tests** added:

| # | Category | Test |
|---|---|---|
| 1 | Validation | `maxRounds = 0` throws before any dependency call |
| 2 | Validation | negative `maxRounds` throws |
| 3 | Validation | fractional `maxRounds` throws |
| 4 | Validation | `NaN` `maxRounds` throws |
| 5 | Validation | `Infinity` `maxRounds` throws |
| 6 | Validation | non-number `maxRounds` throws |
| 7 | Validation | no dependency called before validation fails |
| 8 | Single round | `maxRounds = 1` executes one round, returns its messages |
| 9 | Single round | returned Message has valid structure |
| 10 | Multiple rounds | 3 rounds execute sequentially |
| 11 | Multiple rounds | messages from multiple rounds preserve round order |
| 12 | Multiple rounds | `maxRounds` limit is respected |
| 13 | discussionId | correct `discussionId` passed to `DiscussionController` every call |
| 14 | Call count | `DiscussionController` called exactly once per executed round |
| 15 | Finished discussion | already-finished discussion executes zero rounds |
| 16 | Finished discussion | discussion becoming finished between rounds stops before next round |
| 17 | Finished discussion | discussion state is reloaded before every round |
| 18 | No active panelists | zero panelists executes zero rounds |
| 19 | No active panelists | all panelists finished executes zero rounds |
| 20 | No active panelists | panelists becoming finished between rounds stops execution |
| 21 | No active panelists | panelist state is reloaded before every round |
| 22 | Error propagation | `DiscussionRepository` error propagates unchanged |
| 23 | Error propagation | `PanelistRepository` error propagates unchanged |
| 24 | Error propagation | `DiscussionController` error propagates unchanged |
| 25 | Error propagation | no later rounds execute after an error |
| 26 | Sequential execution | rounds execute in order (not parallel) |
| 27 | Empty round | later rounds proceed after an empty message array |
| 28 | Empty round | empty message array does not stop execution |
| 29 | Discussion not found | throws `"Discussion not found"` when discussion does not exist |
| 30 | No mutation | reaching `maxRounds` does not change discussion status |

Tests verify orchestration behavior through observable outcomes — call counts, call arguments, return values, error propagation, and execution ordering — rather than overfitting to private implementation details.

### Total Test Count

**223 tests** across 12 test files, all passing. (Previously 193 tests across 11 test files; +30 new tests.)

---

# Verification

All verification commands completed successfully.

| Command | Result |
|---|---|
| `npx tsc --noEmit` (backend) | ✅ Passed (0 errors) |
| `npx vitest run` (backend) | ✅ 12 test files passed / 223 tests passed |
| `npm run build` (backend) | ✅ Compiled successfully |
| `git diff --check` | ✅ No whitespace issues |
| `git status --short` | ✅ 3 modified, 2 new files |
| `git diff --stat` | ✅ +7 lines in 3 existing files |

Additionally verified:

- `git diff` inspected — no real API keys or credentials appear in the diff
- No generated build artifacts (`tsconfig.tsbuildinfo`, `dist/`) are included
- No route file was modified
- No controller public contract was modified
- No repository interface was modified
- No `AIService`, `MockAIService`, `DeepSeekAIService`, or `PromptBuilder` was modified
- No `app.ts` or `index.ts` change was introduced
- No REST endpoint was added or changed
- No real API call is made by any new code

---

# Architecture Notes

### Dependency Graph

```
DiscussionEngine (multi-round orchestration)
    ├── DiscussionController (single-round orchestration)
    │       ├── RoundController (single-turn execution)
    │       │       ├── DiscussionRepository
    │       │       ├── PanelistRepository
    │       │       ├── MessageRepository
    │       │       ├── PromptBuilder
    │       │       └── AIService
    │       └── PanelistRepository
    ├── DiscussionRepository (lifecycle check)
    └── PanelistRepository (active-panelist count)
```

### Layer Relationships

```
Future REST API / Event Loop
            │
            ▼
    DiscussionEngine (multi-round orchestration)
            │
            ├────▶ DiscussionController (single-round orchestration)
            │           │
            │           └────▶ RoundController (single-turn execution)
            │                       │
            │                       ├────▶ Repository Interfaces
            │                       │
            │                       └────▶ AIService Interface
            │
            ├────▶ DiscussionRepository (lifecycle check)
            │
            └────▶ PanelistRepository (active-panelist count)
```

`DiscussionEngine` is not yet wired into HTTP routes. It sits above `DiscussionController` in the application layer, ready for future integration.

### Execution Hierarchy

```
DiscussionEngine
        ↓
DiscussionController
        ↓
RoundController
        ↓
AIService
```

Each layer delegates to the layer below without duplicating its responsibilities.

### Responsibility Separation

| Component | Responsibility |
|---|---|
| `DiscussionEngine` | Multi-round orchestration, lifecycle checks, maxRounds boundary, sequential loop |
| `DiscussionController` | Single-round orchestration, panelist loading, finished-filtering, sequential turn delegation |
| `RoundController` | Cross-entity validation, prompt construction, AI generation, message persistence |
| `PromptBuilder` | Prompt construction, system prompt formatting, message conversion |
| `AIService` | AI text generation (provider-independent) |
| `Repositories` | Data persistence and retrieval |

`DiscussionEngine` does not duplicate `DiscussionController` logic, call AI providers, construct prompts, or persist messages. It coordinates — it does not implement.

### Key Design Properties

- **No unbounded execution**: `maxRounds` is a required, validated safety boundary. The loop is a bounded `for` statement.
- **Sequential rounds**: Rounds execute one at a time via `await` in a `for` loop. No `Promise.all` or concurrent round execution.
- **State reloaded every round**: Discussion and panelist state are fetched fresh before each round — the engine never caches state across rounds.
- **Read-only lifecycle checks**: The engine reads `discussion.status` and `panelist.status` but never writes to them.
- **No automatic status transitions**: Reaching `maxRounds` stops execution but does not mark the discussion as finished.
- **Constructor injection**: The engine depends only on abstractions, never on concrete implementations.
- **Error propagation**: No `try/catch` blocks. All dependency errors propagate unchanged.
- **Application-agnostic**: The engine is not wired into REST routes, `app.ts`, or `index.ts`.

---

# Review

The implementation was reviewed by inspecting:

- `Discussion` domain entity change (DiscussionStatus type + status field)
- `InMemoryDiscussionRepository` default status change
- `DiscussionEngine` class
- All 30 unit tests
- Test doubles (StubDiscussionController, FailingDiscussionController, FailingOnNthCallController, StubDiscussionRepository, FailingDiscussionRepository, StubPanelistRepository, FailingPanelistRepository)

The review confirmed:

- proper dependency injection (DiscussionController + DiscussionRepository + PanelistRepository only)
- no direct dependency on AIService, PromptBuilder, MessageRepository, or RoundController
- maxRounds validation before any dependency call
- sequential execution via `for` loop with `await`
- discussion and panelist state reloaded before every round
- correct stop condition ordering (discussion finished → no active panelists → maxRounds)
- `"finished"` as the only inactive terminal state for both Discussion and Panelist
- reaching maxRounds does not mutate discussion status
- error propagation without catching or transforming dependency errors
- immediate stop on first failure
- no Express, HTTP, streaming, websocket, or provider-specific imports
- engine depends only on interfaces/abstractions, not concrete implementations
- message ordering preserved across rounds
- all 30 tests pass and verify orchestration behavior through observable outcomes
- existing 193 tests continue to pass unchanged
- `DiscussionStatus` is a minimal, non-breaking domain addition consistent with the SDD

No code changes were required after review.

---

# Scope Boundaries Respected

The following were **not** introduced:

- ✅ No modification to `AIService` interface
- ✅ No modification to `MockAIService`
- ✅ No modification to `DeepSeekAIService`
- ✅ No modification to `PromptBuilder`
- ✅ No modification to `RoundController`
- ✅ No modification to `DiscussionController` behavior
- ✅ No modification to repository interfaces (`DiscussionRepository`, `PanelistRepository`, `MessageRepository`)
- ✅ No modification to REST routes
- ✅ No modification to `app.ts` or `index.ts`
- ✅ No modification to dependency injection wiring in `createApp`
- ✅ No modification to `AppDependencies`
- ✅ No modification to `createAIService` or `loadAppConfig`
- ✅ No modification to HTTP APIs
- ✅ No modification to provider configuration
- ✅ No new REST endpoints
- ✅ No WebSocket or SSE
- ✅ No streaming
- ✅ No moderator AI behavior
- ✅ No host messages
- ✅ No summaries
- ✅ No retries
- ✅ No timeouts
- ✅ No cancellation
- ✅ No pause or resume
- ✅ No token budgets
- ✅ No cost budgets
- ✅ No dynamic provider selection
- ✅ No provider fallback
- ✅ No concurrency (no Promise.all for rounds)
- ✅ No database transactions
- ✅ No new repositories
- ✅ No frontend changes
- ✅ No real DeepSeek API calls
- ✅ No `process.env` mutation
- ✅ No `DiscussionEngine` instantiation in `app.ts` or `index.ts`
- ✅ No round counters added to `Discussion`
- ✅ No `currentRound` fields
- ✅ No new statuses beyond `DiscussionStatus`
- ✅ No automatic status transitions
- ✅ No persistence of engine execution state
- ✅ No resume checkpoints
- ✅ No cancellation state
- ✅ No `StopCondition` interfaces
- ✅ No `WorkflowStep` classes
- ✅ No event buses
- ✅ No command buses
- ✅ No state machines
- ✅ No plugin systems
- ✅ No lifecycle hook systems

---

# Result

**Milestone 11 completed successfully.**

The project now has three application-layer components with clear responsibility separation:

- **RoundController** — executes a single panelist turn (validation, prompt construction, AI generation, message persistence)
- **DiscussionController** — orchestrates one complete discussion round by iterating over active panelists and delegating each turn to RoundController
- **DiscussionEngine** — orchestrates multiple discussion rounds with lifecycle checks, maxRounds safety boundary, and sequential execution

`DiscussionEngine` introduces the multi-round orchestration layer that connects single-round execution to full discussion sessions. It does so without duplicating any DiscussionController or RoundController logic, without introducing new dependencies on AI providers or prompt construction, and without modifying any existing controller, route, or repository interface.

The minimal `DiscussionStatus` addition brings the `Discussion` domain entity into alignment with the SDD. No other domain entity changed.

### Architectural Significance

This milestone completes the three-tier execution hierarchy:

```
DiscussionEngine      ← NEW — multi-round orchestration
        ↓
DiscussionController  ← existing — single-round orchestration
        ↓
RoundController       ← existing — single-turn execution
        ↓
AIService             ← existing — provider-independent AI generation
```

Each tier delegates to the tier below without duplicating responsibilities. The engine is the outermost orchestration loop — it coordinates rounds. It does not implement turns, construct prompts, or call AI providers.

Subsequent milestones can wire `DiscussionEngine` into REST routes, add real-time event streaming, introduce automatic discussion termination, and implement moderator-led flow control — all without modifying the established three-tier orchestration architecture.
