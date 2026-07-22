# Prompt 09 — Discussion Controller

**Stage:** Implementation Phase — Milestone 8

**Date:** 2026-07-22

---

# Goal

Implement an application-layer DiscussionController that executes one complete discussion round by orchestrating the existing RoundController across all active panelists.

DiscussionController is responsible only for orchestration. It repeatedly invokes `RoundController.executeTurn()` for each active panelist and collects the returned Messages. It must never duplicate RoundController logic.

---

# Context

Before implementation, Claude Code was instructed to read:

- CLAUDE.md
- docs/PRD.md
- docs/SDD.md
- docs/DDD.md
- docs/TDD.md
- all existing Prompt Records
- backend/src/controllers/RoundController.ts
- backend/src/ai/*
- backend/src/domain/*
- backend/src/repositories/*
- backend/src/tests/*

The backend already supported:

- Discussion, Message, and Panelist domain models
- Repository abstractions with in-memory implementations
- AIService interface with MockAIService
- PromptBuilder with `buildPanelistMessages()`
- RoundController with `executeTurn()` for single-panelist turn execution
- Express application separation from server startup
- Vitest test infrastructure
- Dependency injection throughout the application layer

This milestone introduces the first controller that orchestrates multiple panelist turns within a single discussion round, building on the single-turn foundation established by RoundController.

---

# Prompt

```text
Implement an application-layer DiscussionController that executes one
complete discussion round.

DiscussionController is responsible only for orchestration.

It repeatedly invokes RoundController.executeTurn().

It must never duplicate RoundController logic.

Scope:

- DiscussionController
- unit tests

Must NOT introduce:

- REST endpoints
- websocket
- streaming
- scheduler
- host moderation logic
- automatic stopping conditions
- DeepSeek integration
- prompt construction
- repository changes unless absolutely required
- frontend changes

Constructor:

DiscussionController receives:
  RoundController
  PanelistRepository
through dependency injection.

Do not instantiate dependencies internally.

Public API:

executeDiscussion(input: {
    discussionId: string;
}): Promise<Message[]>

Use the real Message domain type.

Execution Flow:

1. Load all panelists belonging to the discussion.
   Use repository insertion order.

2. Skip panelists whose status is "finished".

3. For every remaining panelist:
   call RoundController.executeTurn({
       discussionId,
       panelistId
   })

4. Collect returned Messages.

5. Return all created Messages in execution order.

Do NOT:
- construct prompts
- call AIService directly
- call PromptBuilder
- call MessageRepository
- call DiscussionRepository
- duplicate validation
- duplicate persistence

RoundController already owns these responsibilities.

Error handling:

If RoundController throws:
  stop immediately
  propagate the error unchanged
  do not continue executing later panelists.

Tests must cover at least:

1. single panelist
2. multiple panelists
3. preserve repository order
4. skip finished panelists
5. returns created Messages in correct order
6. RoundController called exactly once per active panelist
7. no call for finished panelists
8. empty discussion returns []
9. RoundController error propagates
10. execution stops after first failure

Use lightweight test doubles. Do not spin up Express.
```

---

# Files Created

```
backend/src/controllers/DiscussionController.ts     (68 lines)
backend/src/tests/discussion-controller.test.ts      (500 lines)
```

No controllers directory needed creation — it was already established by the Round Controller milestone.

---

# Files Modified

None. This milestone introduced only new files. No existing controller, repository, domain, AI, or test files required modification.

---

# DiscussionController API

```ts
export class DiscussionController {
  constructor(deps: {
    roundController: RoundController;
    panelistRepository: PanelistRepository;
  });

  executeDiscussion(input: {
    discussionId: string;
  }): Promise<Message[]>;
}
```

### Constructor Dependency Injection

The controller accepts two dependencies via a constructor options object:

| Dependency | Interface | Purpose |
|---|---|---|
| `roundController` | `RoundController` | Delegate single-panelist turn execution |
| `panelistRepository` | `PanelistRepository` | Load panelists belonging to a discussion |

The controller depends only on abstractions — never on concrete implementations such as `InMemoryPanelistRepository` or `MockAIService`.

Notably, DiscussionController does **not** receive `DiscussionRepository`, `MessageRepository`, `AIService`, or any prompt-related dependency. These are owned exclusively by RoundController.

---

# Execution Flow

`executeDiscussion()` performs operations in this exact order:

```
1. Load all panelists via PanelistRepository.findByDiscussionId()
        ↳ returns panelists in repository insertion order

2. Filter out panelists whose status === "finished"
        ↳ only active panelists proceed to execution

3. For each remaining panelist (sequential, for...of with await):
      call RoundController.executeTurn({ discussionId, panelistId })
        ↳ collect the returned Message

4. Return all created Messages in execution order
```

Each panelist turn is executed sequentially using `await` inside a `for...of` loop. No two panelists execute concurrently.

Execution order follows the order returned by `PanelistRepository.findByDiscussionId()`, which is repository insertion order. This order is not modified, sorted, or re-prioritized by DiscussionController.

---

# Sequential Orchestration Using RoundController

DiscussionController delegates all per-panelist work to `RoundController.executeTurn()`. For each active panelist, RoundController is responsible for:

1. Validating discussion existence
2. Validating panelist existence and membership
3. Confirming panelist is active (not finished)
4. Loading existing discussion messages
5. Building AI messages via `buildPanelistMessages()`
6. Calling `AIService.generate()`
7. Persisting the AI response as a domain Message
8. Returning the created Message

DiscussionController does not duplicate, re-implement, or short-circuit any of these steps. It trusts RoundController to perform them correctly and consistently for every panelist.

---

# Panelist Filtering

Only panelists whose `status` is not `"finished"` are executed. The `PanelistStatus` type defines four values:

```ts
type PanelistStatus = "waiting" | "preparing" | "speaking" | "finished";
```

The filter uses a simple equality check:

```ts
panelists.filter((p) => p.status !== "finished")
```

Panelists with status `"waiting"`, `"preparing"`, or `"speaking"` are all considered active and proceed to execution. RoundController performs its own active-status check internally (rejecting `"finished"` panelists), providing defense in depth.

---

# Responsibility Boundaries

DiscussionController must **never** directly call:

| Component | Reason |
|---|---|
| `AIService` | Owned by RoundController |
| `PromptBuilder` | Owned by RoundController |
| `MessageRepository` | Owned by RoundController |
| `DiscussionRepository` | Owned by RoundController |

DiscussionController does **not**:

- construct prompts
- call AI providers
- persist messages
- validate discussion existence
- validate panelist membership
- validate panelist active status
- build AI message arrays
- manage panelist state transitions

All of the above remain the exclusive responsibility of RoundController.

---

# Error Handling

### Error Propagation

DiscussionController does not catch or transform errors from RoundController:

- **RoundController errors** — propagate unchanged. The controller does not wrap, retry, or replace RoundController failures.
- **PanelistRepository errors** — propagate unchanged from `findByDiscussionId()`.

No try/catch blocks exist in `executeDiscussion()`. Every error thrown by a dependency reaches the caller in its original form.

### Stop on First Failure

When `RoundController.executeTurn()` throws for any panelist:

1. Execution stops immediately — the `for...of` loop exits via the uncaught exception.
2. Later panelists in the iteration order are never called.
3. Messages from earlier successful panelists are discarded (the function rejects before returning).
4. The error is propagated unchanged to the caller.

No partial results are returned on failure.

---

# Testing

### Test Infrastructure

All tests use in-memory repositories and lightweight test doubles. No Express app is created and no `listen()` is called.

Test doubles defined in the test file:

| Double | Purpose |
|---|---|
| `SpyRoundController` | Wraps a real RoundController, records every `executeTurn()` call along with its arguments — used to verify call count and call arguments |
| `FailingRoundController` | Throws on every `executeTurn()` call — used to verify error propagation |
| `FailingOnNthCallRoundController` | Throws on the N-th call (configurable), returns synthetic Messages for earlier calls — used to verify execution stops after first failure |

Additionally, inline stub `PanelistRepository` implementations are used in tests that require panelists with `status: "finished"`, since `InMemoryPanelistRepository` always creates panelists with `status: "waiting"`.

These doubles exist only in the test file.

### Test Coverage

**16 new tests** added:

| # | Category | Test |
|---|---|---|
| 1 | Single panelist | returns one Message for a discussion with one active panelist |
| 2 | Single panelist | returns a Message with a valid id |
| 3 | Multiple panelists | returns one Message per active panelist |
| 4 | Multiple panelists | persists all generated messages |
| 5 | Order preservation | executes panelists in the order returned by the repository |
| 6 | Skip finished | does not call executeTurn for a finished panelist |
| 7 | Skip finished | returns messages only from active panelists |
| 8 | Message order | returns Messages in the same order panelists were executed |
| 9 | Call count | calls RoundController.executeTurn exactly once per active panelist |
| 10 | No finished call | never calls executeTurn with a finished panelist id |
| 11 | Empty discussion | returns an empty array when the discussion has no panelists |
| 12 | Empty discussion | returns an empty array when all panelists are finished |
| 13 | Error propagation | propagates RoundController errors unchanged |
| 14 | Error propagation | does not catch or wrap the error |
| 15 | Stop on failure | stops executing after the first RoundController error (call count verified) |
| 16 | Stop on failure | does not call later panelists after a failure |

Tests verify orchestration behavior through observable outcomes — call counts, call arguments, return values, and error propagation — rather than overfitting to private implementation details.

### Total Test Count

**119 tests** across 8 test files, all passing. (Previously 103 tests across 7 test files.)

---

# Verification

All verification commands completed successfully.

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ Passed (0 errors) |
| `npm test` (backend) | ✅ 8 test files passed / 119 tests passed |
| `npm run build` | ✅ All workspaces compiled |
| `git diff --check` | ✅ No whitespace issues |
| `git status --short` | ✅ 2 new files only |

---

# Architecture Notes

### Dependency Graph

```
DiscussionController
    ├── RoundController (orchestration delegate)
    └── PanelistRepository (panelist loading)
         │
         ▼
    RoundController
         ├── DiscussionRepository
         ├── PanelistRepository
         ├── MessageRepository
         ├── PromptBuilder
         └── AIService
```

DiscussionController sits above RoundController in the application layer. It depends on RoundController and PanelistRepository only. It has no knowledge of prompts, AI providers, message persistence, or discussion validation — those concerns are encapsulated entirely within RoundController.

### Layer Relationships

```
Future REST API / Event Loop
            │
            ▼
    DiscussionController (application orchestration)
            │
            ├────▶ RoundController (single-turn execution)
            │           │
            │           ├────▶ Repository Interfaces
            │           │
            │           └────▶ AIService Interface
            │                       │
            │                       ▼
            │                  PromptBuilder
            │
            └────▶ PanelistRepository
```

### Responsibility Separation

| Component | Responsibility |
|---|---|
| `DiscussionController` | Panelist loading, finished-filtering, sequential orchestration, Message collection |
| `RoundController` | Cross-entity validation, prompt construction, AI generation, message persistence |
| `PromptBuilder` | Prompt construction, system prompt formatting, message conversion |
| `AIService` | AI text generation (provider-independent) |
| `Repositories` | Data persistence and retrieval |

DiscussionController does not duplicate RoundController logic, construct prompts, call AI services, or persist messages. It coordinates — it does not implement.

---

# Review

The implementation was reviewed by inspecting:

- DiscussionController class
- All 16 unit tests
- Test doubles (SpyRoundController, FailingRoundController, FailingOnNthCallRoundController)

The review confirmed:

- proper dependency injection (RoundController + PanelistRepository only)
- correct execution order following repository insertion order
- finished panelists correctly filtered before execution
- sequential execution via `for...of` with `await`
- no concurrent panelist execution
- error propagation without catching or transforming dependency errors
- immediate stop on first RoundController failure
- no direct calls to AIService, PromptBuilder, MessageRepository, or DiscussionRepository
- no duplication of RoundController validation or persistence logic
- no Express, HTTP, streaming, websocket, or provider-specific imports
- controller depends only on interfaces/abstractions, not concrete implementations
- all 16 tests pass and verify orchestration behavior through observable outcomes

No code changes were required after review.

---

# Scope Boundaries Respected

The following were **not** introduced:

- ✅ No REST endpoints
- ✅ No websocket
- ✅ No streaming
- ✅ No scheduler
- ✅ No host moderation logic
- ✅ No automatic stopping conditions
- ✅ No DeepSeek integration
- ✅ No prompt construction
- ✅ No direct AIService calls
- ✅ No direct PromptBuilder calls
- ✅ No direct MessageRepository calls
- ✅ No direct DiscussionRepository calls
- ✅ No repository changes
- ✅ No frontend changes
- ✅ No duplication of RoundController validation
- ✅ No duplication of RoundController persistence
- ✅ No parallel/concurrent panelist execution
- ✅ No modification of repository insertion order
- ✅ No Express imports in DiscussionController
- ✅ No HTTP status codes
- ✅ No environment variable changes
- ✅ No package additions

---

# Result

**Milestone 8 completed successfully.**

The project now has two application-layer controllers with clear responsibility separation:

- **RoundController** — executes a single panelist turn (validation, prompt construction, AI generation, message persistence)
- **DiscussionController** — orchestrates one complete discussion round by iterating over active panelists and delegating each turn to RoundController

DiscussionController introduces the orchestration layer that connects single-turn execution to multi-panelist discussion rounds. It does so without duplicating any RoundController logic, without introducing new dependencies on AI providers or prompt construction, and without modifying any existing files.

Subsequent milestones can build on this foundation to introduce discussion lifecycle management (start, stop, round iteration), REST endpoints, websocket event streaming, and automatic stopping conditions without modifying the established DiscussionController architecture.
