# Prompt 13 — Discussion Session Lifecycle

**Stage:** Implementation Phase — Milestone 12

**Date:** 2026-07-22

---

# Goal

Introduce a session-level lifecycle boundary around the existing multi-round execution hierarchy.

The milestone creates a `DiscussionSessionController` that wraps `DiscussionEngine` with `SessionLifecycle` hooks, and a deterministic `TemplateSessionLifecycle` that provides real session-boundary messages without AI calls.

Existing responsibilities remain unchanged:

- `RoundController` executes one panelist turn.
- `DiscussionController` executes one complete round across active panelists.
- `DiscussionEngine` executes multiple rounds for one discussion session.
- `AIService` remains provider-agnostic.

The intended lifecycle is:

```
session start
    ↓
engine rounds (1 … maxRounds)
    ↓
session end
```

The purpose is to create a stable extension point for future capabilities (template moderation, AI moderation, summaries, metrics, cancellation, budget policies) without modifying the engine or introducing speculative abstractions.

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
- backend/src/domain/*
- backend/src/controllers/RoundController.ts
- backend/src/controllers/DiscussionController.ts
- backend/src/services/DiscussionEngine.ts
- backend/src/repositories/*
- backend/src/ai/*
- backend/src/app.ts
- backend/src/index.ts
- all relevant backend tests

The backend already supported:

- `Discussion` domain model with `DiscussionStatus` (`"active" | "finished"`)
- `Panelist` domain model with `PanelistStatus` (`"waiting" | "preparing" | "speaking" | "finished"`)
- `Message` domain model with `MessageRole` (`"user" | "assistant"`)
- `DiscussionRepository`, `PanelistRepository`, `MessageRepository` abstractions with in-memory implementations
- `AIService` interface with `MockAIService` and `DeepSeekAIService`
- `PromptBuilder` for constructing provider-independent AI messages
- `RoundController` — executes a single panelist turn (validation, prompt construction, AI generation, message persistence)
- `DiscussionController` — orchestrates one complete discussion round across all active panelists
- `DiscussionEngine` — orchestrates multiple discussion rounds with lifecycle checks, `maxRounds` safety boundary, and sequential execution
- `createAIService` factory and `loadAppConfig` for provider selection
- Express application with dependency injection via `createApp(dependencies?)` and `AppDependencies`
- Vitest test infrastructure
- 223 tests across 12 test files, all passing

The existing execution hierarchy was:

```
DiscussionEngine          (multi-round orchestration)
        ↓
DiscussionController      (single-round orchestration)
        ↓
RoundController           (single-turn execution)
        ↓
AIService                 (provider-independent AI generation)
```

`DiscussionEngine` already owned bounded multi-round orchestration with stop conditions, state reloading, and `maxRounds` validation. It was explicitly designed to be the outer orchestration loop — not a general workflow framework. The engine introduced a required `maxRounds` safety boundary with no unbounded execution.

At the end of Milestone 11, the dependency graph supported both testing and production through the `AIService` interface, but no session-level lifecycle boundary existed. Milestone 12 introduces that boundary outside the engine.

---

# Prompt

The implementation was preceded by a design proposal that answered 20 critical design questions covering component responsibilities, lifecycle semantics, Message compatibility, error propagation, and test coverage. The proposal is archived in the conversation transcript.

The proposed design introduced:

- `DiscussionSessionController` — session-level coordinator
- `SessionLifecycle` — interface with `onSessionStart` and `onSessionEnd` hooks
- `TemplateSessionLifecycle` — deterministic non-AI implementation

The design was approved with two required revisions:

1. **maxRounds validation before lifecycle side effects** — `DiscussionSessionController` must validate `maxRounds` (number, finite, integer, > 0) before calling `onSessionStart`, to prevent an invalid session request from persisting an opening message. `DiscussionEngine` retains its own validation for safe direct use.

2. **Do not reopen an already-finished Discussion** — if the pre-flight `DiscussionRepository.findById()` check finds `discussion.status === "finished"`, `runSession` must return an empty `Message[]` immediately without invoking any lifecycle hook or `DiscussionEngine`.

All other aspects of the proposal were approved as written:

- `DiscussionSessionController` wraps `DiscussionEngine` (engine receives no lifecycle dependency)
- `SessionLifecycle` has only `onSessionStart` and `onSessionEnd` (no per-round hooks)
- `TemplateSessionLifecycle` is deterministic and non-AI
- No domain or repository-interface changes
- No REST or application wiring
- Natural error propagation without `try/finally`
- `onSessionEnd` runs only after normal engine completion

---

# Design Decision

Two alternatives were considered for integrating lifecycle behaviour with the existing execution hierarchy.

### Option 1: DiscussionSessionController wraps DiscussionEngine (selected)

**How it works**: A new controller sits outside `DiscussionEngine`. It validates the request, invokes lifecycle hooks, delegates to the engine for bounded round execution, and collects all messages.

```
DiscussionSessionController  ← NEW
        ↓
DiscussionEngine              ← unchanged
        ↓
DiscussionController          ← unchanged
        ↓
RoundController               ← unchanged
        ↓
AIService                     ← unchanged
```

**Selected because**:

- `DiscussionEngine` remains completely unchanged — zero risk to existing behaviour.
- Lifecycle behaviour stays outside bounded round orchestration.
- Existing engine responsibilities and 30 tests remain stable.
- Future lifecycle implementations can be introduced without turning the engine into a workflow framework.
- Follows the existing layering pattern: each layer delegates to the one below without modifying it.
- Satisfies the explicit constraint "Do not turn DiscussionEngine into a general workflow framework."

### Option 2: DiscussionEngine receives lifecycle hooks (rejected)

**How it works**: `SessionLifecycle` is injected into `DiscussionEngine`'s constructor. The engine calls hooks internally.

**Rejected because**:

- `DiscussionEngine`'s constructor and execution flow would change — all 30 engine tests would need review.
- The engine would gain lifecycle-timing responsibility (when to call hooks relative to validation, reloads, and stop conditions).
- The engine would need to decide error semantics for hook failures.
- The engine's single responsibility ("multi-round orchestration") would be diluted.
- Future lifecycle extensions (per-round hooks, error hooks) would require engine changes each time.

The wrapping approach preserved the engine as a stable, focused, bounded-round orchestrator.

---

# Files Created

```
backend/src/lifecycle/SessionLifecycle.ts
backend/src/lifecycle/TemplateSessionLifecycle.ts
backend/src/controllers/DiscussionSessionController.ts
backend/src/tests/template-session-lifecycle.test.ts
backend/src/tests/discussion-session-controller.test.ts
```

The `lifecycle/` directory is new. The `controllers/` directory already existed from Milestones 7–8. The `services/` directory already existed from Milestone 11.

---

# Files Modified

No pre-existing implementation files were modified.

Specifically, no changes were made to:

- `DiscussionEngine`
- `DiscussionController`
- `RoundController`
- `AIService`
- `MockAIService`
- `DeepSeekAIService`
- `PromptBuilder`
- `DiscussionRepository` interface
- `MessageRepository` interface
- `PanelistRepository` interface
- `Discussion` domain entity
- `Message` domain entity
- `Panelist` domain entity
- `createAIService`
- `loadAppConfig`
- `AppDependencies`
- `createApp`
- `app.ts`
- `index.ts`
- REST routes
- Any existing test file

---

# SessionLifecycle

### Public Contract

```ts
export interface SessionLifecycle {
  /** Invoked once before the first round executes. */
  onSessionStart(context: { discussionId: string }): Promise<Message[]>;

  /** Invoked once after the final round completes normally. */
  onSessionEnd(context: { discussionId: string }): Promise<Message[]>;
}
```

### Design Properties

- Both hooks are asynchronous.
- Both receive a minimal `{ discussionId: string }` context — only data that is guaranteed to exist at the call site.
- Both return `Promise<Message[]>` — each hook returns the Messages it chose to create.
- Implementations are responsible for persisting any Messages they create.
- No per-round hooks (`beforeRound` / `afterRound`) were added — there is no demonstrated need for per-round lifecycle behaviour at this stage.

---

# TemplateSessionLifecycle

### Public API

```ts
export class TemplateSessionLifecycle implements SessionLifecycle {
  constructor(deps: { messageRepository: MessageRepository });

  onSessionStart(context: { discussionId: string }): Promise<Message[]>;
  onSessionEnd(context: { discussionId: string }): Promise<Message[]>;
}
```

### Implementation

`TemplateSessionLifecycle` is a deterministic, non-AI implementation of `SessionLifecycle`. It:

- Does **not** call an AI provider.
- Creates exactly one fixed-template message on session start.
- Creates exactly one fixed-template message on session end.
- Persists its own messages through `MessageRepository.create()`.
- Returns the persisted Messages so the session controller can include them in the final transcript.

### Message Templates

**onSessionStart**:

```
"讨论环节已开始。主持人将引导专家围绕话题展开讨论。"
```

**onSessionEnd**:

```
"讨论环节已结束。"
```

Both messages use `role: "assistant"` — the `MessageRole` type (`"user" | "assistant"`) does not have a `"system"` variant, so `"assistant"` is the least-surprising choice for system-generated non-user content.

### Domain Constraints Respected

- `MessageRole` was **not** changed — it remains `"user" | "assistant"`.
- No `"system"` domain role was introduced.
- No moderator `Panelist` was created.
- No `speakerId` or `panelistId` field was added to `Message`.
- No `DiscussionStatus` transition was implemented.

---

# DiscussionSessionController

### Public API

```ts
export class DiscussionSessionController {
  constructor(deps: {
    discussionEngine: DiscussionEngine;
    discussionRepository: DiscussionRepository;
    lifecycle: SessionLifecycle;
  });

  runSession(request: RunDiscussionRequest): Promise<Message[]>;
}
```

`RunDiscussionRequest` is the same type used by `DiscussionEngine`:

```ts
export interface RunDiscussionRequest {
  discussionId: string;
  maxRounds: number;
}
```

### Constructor Dependency Injection

The controller accepts three dependencies via a constructor options object:

| Dependency | Interface | Purpose |
|---|---|---|
| `discussionEngine` | `DiscussionEngine` | Delegate bounded multi-round execution |
| `discussionRepository` | `DiscussionRepository` | Pre-flight discussion existence and status check |
| `lifecycle` | `SessionLifecycle` | Session-boundary hooks |

The controller depends only on abstractions — never on concrete implementations.

Notably, `DiscussionSessionController` does **not** receive `AIService`, `MessageRepository`, `PanelistRepository`, `RoundController`, or `DiscussionController`. It delegates all round and turn execution to `DiscussionEngine`, which owns those dependencies internally.

### Execution Flow

`runSession()` performs operations in this exact order:

```
1. Validate maxRounds
   → must be a number, finite, integer, greater than zero
   → throws before any side effect (no lifecycle hook, no engine call)

2. Load discussion via DiscussionRepository.findById()
   → null: throw "Discussion not found"
   → status === "finished": return [] immediately
     (no lifecycle hook, no engine call, no messages persisted)

3. Invoke lifecycle.onSessionStart({ discussionId })
   → collect returned Messages

4. Delegate to engine.runDiscussion(request)
   → collect returned Messages

5. Invoke lifecycle.onSessionEnd({ discussionId })
   → only after normal engine completion
   → collect returned Messages

6. Return [...startMessages, ...engineMessages, ...endMessages]
   in chronological execution order
```

---

# Validation

### Session-Boundary maxRounds Validation

`DiscussionSessionController` validates `maxRounds` before any lifecycle side effect, using the same rules as `DiscussionEngine`:

| Invalid Input | Error Message |
|---|---|
| Non-number (e.g. `"3"`, `undefined`) | `"maxRounds must be a number"` |
| `NaN` | `"maxRounds must be finite"` |
| `Infinity` | `"maxRounds must be finite"` |
| Fractional (e.g. `2.5`) | `"maxRounds must be an integer"` |
| Zero (`0`) | `"maxRounds must be greater than zero"` |
| Negative (e.g. `-1`) | `"maxRounds must be greater than zero"` |

### Why Validation is Duplicated at the Session Boundary

`DiscussionEngine` retains its own `maxRounds` validation so that it remains safe when called directly — the engine's contract is independently enforced.

The session-level validation is a **defensive boundary check** that prevents an invalid request from:

- persisting a lifecycle opening message
- calling any lifecycle hook
- calling `DiscussionEngine`

If `maxRounds` is invalid, the session controller rejects the request before any dependency is invoked.

---

# Finished Discussion Behaviour

A Discussion whose `status` is `"finished"` at the time of the pre-flight check is treated as already-complete:

- `runSession` returns an empty `Message[]` immediately.
- `onSessionStart` is **not** called.
- `DiscussionEngine.runDiscussion()` is **not** called.
- `onSessionEnd` is **not** called.
- No lifecycle message is persisted.

This is distinct from an active Discussion (`status: "active"`) that happens to have zero active panelists:

- An active Discussion follows the normal session path:
  `onSessionStart` → `engine.runDiscussion()` returns no round messages → `onSessionEnd`
- Start and end lifecycle messages are created and returned.

The distinction is based on `DiscussionStatus`, not on the count of active panelists.

---

# Lifecycle and Error Semantics

### Sequential Execution

Hooks and engine execution are strictly sequential. Each step is awaited before the next step begins. No `Promise.all` or concurrent execution is used.

### Error Propagation

No `try/catch` or `try/finally` blocks exist in `runSession()`. Every error thrown by a dependency reaches the caller in its original form.

| Scenario | Behaviour |
|---|---|
| `maxRounds` invalid | Throws before any side effect. No hook or engine call. |
| Discussion not found | Throws `"Discussion not found"` before any hook. |
| Discussion already finished | Returns `[]` immediately. No hook or engine call. |
| `onSessionStart` throws | Error propagates unchanged. Engine never called. `onSessionEnd` never called. |
| `DiscussionEngine.runDiscussion()` throws | Error propagates unchanged. `onSessionEnd` **not** called. |
| `onSessionEnd` throws | Error propagates unchanged. Earlier messages (start + engine) are discarded from the return value but remain persisted in the repository. |

### onSessionEnd Runs Only After Normal Engine Completion

`onSessionEnd` is invoked only when `DiscussionEngine.runDiscussion()` returns successfully. It is **not** invoked when:

- The engine throws (any cause — AI error, repository error, validation error inside the engine).
- Any earlier step throws.

This follows the pattern established by `DiscussionEngine` (no cleanup hooks on failure) and keeps the simple contract: the session-end hook signals normal completion, not abnormal termination.

### No Rollback or Transaction Semantics

Messages already persisted by completed earlier lifecycle hooks or engine rounds are **not rolled back** when a later step fails. This is documented in code comments only — no compensating transaction logic was introduced.

---

# Message Ordering

`runSession` returns a flat `Message[]` in chronological execution order:

```
[start lifecycle messages, engine round messages, end lifecycle messages]
```

Ordering is based on sequential execution and array concatenation:

```ts
return [...startMessages, ...engineMessages, ...endMessages];
```

Messages are not sorted by `createdAt` timestamps — the execution order matches the collection order.

---

# Dependency Injection

### DiscussionSessionController

Receives three dependencies through constructor injection:

```ts
constructor(deps: {
  discussionEngine: DiscussionEngine;
  discussionRepository: DiscussionRepository;
  lifecycle: SessionLifecycle;
})
```

The controller does **not** directly depend on:

- `AIService` — owned by `RoundController`
- `PromptBuilder` — owned by `RoundController`
- `MessageRepository` — owned by `RoundController` and `TemplateSessionLifecycle`
- `PanelistRepository` — owned by `DiscussionController` and `DiscussionEngine`
- `DiscussionController` or `RoundController` — wrapped by `DiscussionEngine`

### TemplateSessionLifecycle

Receives one dependency through constructor injection:

```ts
constructor(deps: { messageRepository: MessageRepository })
```

The lifecycle implementation owns its `MessageRepository` dependency for persisting its own messages — consistent with how `RoundController` owns its `MessageRepository` for persisting AI responses.

### process.env

Neither `DiscussionSessionController` nor `TemplateSessionLifecycle` reads `process.env`. Configuration is injected through constructors.

---

# Testing

### Test Infrastructure

All tests use in-memory repositories and lightweight test doubles. No Express app is created and no `listen()` is called. No real AI API is invoked.

### Test Doubles

**template-session-lifecycle.test.ts** uses `InMemoryMessageRepository` directly — no custom doubles needed.

**discussion-session-controller.test.ts** defines:

| Double | Purpose |
|---|---|
| `StubDiscussionEngine` | Returns configurable `Message` arrays; records `runDiscussion()` call count and last request |
| `FailingDiscussionEngine` | Throws on every `runDiscussion()` call — verifies error propagation |
| `SpySessionLifecycle` | Records call counts and last context for both hooks; returns configurable messages |
| `FailingStartLifecycle` | Throws on `onSessionStart` — verifies engine is never called |
| `FailingEndLifecycle` | Throws on `onSessionEnd` — verifies error propagation after normal engine completion |
| `stubDiscussionRepo()` | Returns a configurable `Discussion` or `null` from `findById()` |
| `failingDiscussionRepo()` | Throws on every method — verifies repository error propagation |

Additionally, `TemplateSessionLifecycle` backed by `InMemoryMessageRepository` is used in tests that verify no lifecycle messages are persisted for invalid or finished-discussion requests.

### Test Coverage

**43 new tests** across 2 new test files:

#### template-session-lifecycle.test.ts (12 tests)

| # | Category | Tests |
|---|---|---|
| 1 | `onSessionStart` message (6) | returns one message; `role: "assistant"`; non-empty content; correct `discussionId`; UUID v4 `id`; valid ISO 8601 `createdAt` |
| 2 | `onSessionEnd` message (3) | returns one message; `role: "assistant"`; correct `discussionId` |
| 3 | Persistence & ordering (2) | start and end messages appear in insertion order; start appears before end in `findByDiscussionId` |
| 4 | Isolation & idempotency (1+1) | cross-discussion message isolation; multiple `onSessionStart` calls produce distinct messages |

#### discussion-session-controller.test.ts (31 tests)

| # | Category | Tests |
|---|---|---|
| 1 | Happy path (7) | messages in order start→engine→end; start and end only when engine returns none; correct `discussionId` passed to engine; `start`/`end` hook call count = 1 each; `discussionId` passed to hooks; sequential execution order verified; engine message order preserved within result |
| 2 | `maxRounds` validation (10) | zero throws; negative throws; fractional throws; NaN throws; Infinity throws; non-number throws; undefined throws; throws before `onSessionStart`; throws before engine call; no lifecycle message persisted |
| 3 | Discussion not found (2) | throws before any hook; does not call engine |
| 4 | Already-finished Discussion (5) | returns `[]`; does not call `onSessionStart`; does not call engine; does not call `onSessionEnd`; persists no lifecycle message |
| 5 | Active discussion with zero engine messages (2) | still calls `onSessionStart` and `onSessionEnd`; returns `[start, end]` |
| 6 | Error propagation (4) | `DiscussionRepository` error propagates; `onSessionStart` error propagates (engine not called); engine error propagates (`onSessionEnd` not called); `onSessionEnd` error propagates |
| 7 | Dependency isolation (1) | controller has no path to call `AIService` or `MessageRepository` directly |

### Total Test Count

**266 tests** across 14 test files, all passing. (Previously 223 tests across 12 test files; +43 new tests.)

---

# Verification

All verification commands completed successfully.

| Command | Result |
|---|---|
| `npx tsc --noEmit` (backend) | ✅ Passed (0 errors) |
| `npx vitest run` (backend) | ✅ 14 test files passed / 266 tests passed |
| `npm run build` (backend) | ✅ Compiled successfully |
| `git diff --check` | ✅ No whitespace issues |
| `git status --short` | ✅ 5 new files only (2 in `lifecycle/`, 1 controller, 2 tests) |

Additionally verified:

- `git diff` inspected — no existing files were modified
- No generated build artifacts are included
- No route file was modified
- No controller public contract was modified
- No repository interface was modified
- No `AIService`, `MockAIService`, `DeepSeekAIService`, or `PromptBuilder` was modified
- No `app.ts` or `index.ts` change was introduced
- No REST endpoint was added or changed
- No real API call is made by any new code
- No `process.env` access exists in any new component

---

# Architecture Notes

### Dependency Graph

```
DiscussionSessionController (session lifecycle boundary)
    ├── SessionLifecycle (hooks)
    │       └── TemplateSessionLifecycle (deterministic implementation)
    │               └── MessageRepository
    ├── DiscussionEngine (multi-round orchestration — unchanged)
    │       ├── DiscussionController (single-round orchestration)
    │       │       ├── RoundController (single-turn execution)
    │       │       │       ├── DiscussionRepository
    │       │       │       ├── PanelistRepository
    │       │       │       ├── MessageRepository
    │       │       │       ├── PromptBuilder
    │       │       │       └── AIService
    │       │       └── PanelistRepository
    │       ├── DiscussionRepository
    │       └── PanelistRepository
    └── DiscussionRepository (pre-flight check)
```

### Layer Relationships

```
DiscussionSessionController (session lifecycle boundary)  ← NEW
        │
        ├────▶ SessionLifecycle (hooks)
        │           │
        │           └────▶ TemplateSessionLifecycle
        │                       │
        │                       └────▶ MessageRepository (persistence)
        │
        └────▶ DiscussionEngine (multi-round — unchanged)
                    │
                    └────▶ DiscussionController → RoundController → AIService
```

### Execution Hierarchy

```
DiscussionSessionController  ← NEW — session lifecycle boundary
        ↓
DiscussionEngine              ← unchanged — bounded multi-round orchestration
        ↓
DiscussionController          ← unchanged — single-round orchestration
        ↓
RoundController               ← unchanged — single-turn execution
        ↓
AIService                     ← unchanged — provider-independent AI generation
```

### Key Design Properties

- **Engine extended from the outside**: The stable `DiscussionEngine` was wrapped, not modified. All 30 engine tests pass unchanged.
- **Real lifecycle implementation**: `TemplateSessionLifecycle` provides deterministic, testable, non-AI behaviour — it is not an empty or speculative abstraction.
- **No speculative hooks**: Only `onSessionStart` and `onSessionEnd` exist. No `beforeRound`, `afterRound`, or other per-round hooks were added.
- **No moderator AI**: The lifecycle does not call AI providers. Future AI moderation can be added by implementing a new `SessionLifecycle`.
- **Clean extension point**: Future lifecycle implementations (`AISessionLifecycle`, `CompositeSessionLifecycle`) can be introduced without modifying the session controller, engine, or any existing component.

---

# Scope Boundaries Respected

The following were **not** introduced:

- ✅ No AI moderator behaviour
- ✅ No AI-generated lifecycle messages
- ✅ No summaries
- ✅ No `beforeRound` or `afterRound` hooks
- ✅ No streaming
- ✅ No WebSocket or SSE
- ✅ No retries
- ✅ No timeout handling
- ✅ No cancellation
- ✅ No pause or resume
- ✅ No token or cost budgets
- ✅ No event buses or command buses
- ✅ No generic workflow engines
- ✅ No plugin systems
- ✅ No lifecycle registries
- ✅ No multiple lifecycle implementations beyond `TemplateSessionLifecycle`
- ✅ No REST endpoints
- ✅ No route changes
- ✅ No `app.ts` or `index.ts` changes
- ✅ No frontend changes
- ✅ No `DiscussionStatus` mutation
- ✅ No `MessageRole` extension
- ✅ No `speakerId` or `panelistId` fields on `Message`
- ✅ No fake moderator `Panelist`
- ✅ No repository-interface changes
- ✅ No `DiscussionRepository.update()` method
- ✅ No real DeepSeek calls
- ✅ No `process.env` access in new components
- ✅ No `try/finally` or cleanup hooks
- ✅ No rollback or transaction semantics
- ✅ No concurrent hook or round execution
- ✅ No existing file modifications

---

# Review

The design proposal was reviewed before implementation. Two revisions were required:

1. **maxRounds validation before lifecycle side effects** — `DiscussionSessionController` must validate `maxRounds` before calling `onSessionStart`, preventing an opening message from being persisted for an invalid request. `DiscussionEngine` retains its own validation.

2. **Do not reopen an already-finished Discussion** — if the pre-flight check finds `discussion.status === "finished"`, `runSession` returns `[]` immediately without invoking any hook or the engine.

The implementation was reviewed by inspecting:

- `SessionLifecycle` interface
- `TemplateSessionLifecycle` implementation
- `DiscussionSessionController` class
- All 43 new unit tests
- Test doubles

The review confirmed:

- `DiscussionEngine` remains completely unchanged — zero modifications
- `maxRounds` is validated before any lifecycle side effect
- Already-finished discussions return `[]` without invoking hooks or the engine
- Lifecycle hooks are only `onSessionStart` and `onSessionEnd` — no per-round hooks
- `TemplateSessionLifecycle` is deterministic and does not call AI providers
- `MessageRole` remains `"user" | "assistant"` — no domain change
- No `speakerId` or `panelistId` field was added to `Message`
- No moderator `Panelist` was created
- `DiscussionSessionController` does not directly depend on `AIService`, `MessageRepository`, `PromptBuilder`, `RoundController`, or `DiscussionController`
- Correct error propagation: `onSessionEnd` runs only after normal engine completion
- No `try/catch` or `try/finally` was introduced
- All 266 tests pass (43 new, 223 existing unchanged)
- No existing file was modified
- `process.env` is not accessed by any new component
- The session controller is intentionally not wired into `app.ts`, `index.ts`, or any REST route

No code changes were required after review.

---

# Result

**Milestone 12 completed successfully.**

The project now has a session-level lifecycle boundary that wraps the existing multi-round execution hierarchy without modifying any existing component:

```
DiscussionSessionController  ← NEW — session lifecycle boundary
        ↓
DiscussionEngine              ← unchanged — bounded multi-round orchestration
        ↓
DiscussionController          ← unchanged — single-round orchestration
        ↓
RoundController               ← unchanged — single-turn execution
        ↓
AIService                     ← unchanged — provider-independent AI generation
```

The milestone introduced:

- `SessionLifecycle` — a narrow interface with two hooks (`onSessionStart`, `onSessionEnd`)
- `TemplateSessionLifecycle` — a deterministic non-AI implementation that creates real session-boundary messages
- `DiscussionSessionController` — a session coordinator that validates requests, invokes lifecycle hooks, delegates to `DiscussionEngine`, and returns chronological transcripts
- 43 focused unit tests covering happy paths, validation, stop conditions, error propagation, and ordering

### Architectural Significance

This milestone completes the session lifecycle boundary:

1. **Wrapping, not modifying**: The stable engine was extended from outside. All existing execution-layer responsibilities remain intact.
2. **Real abstraction, not speculative**: `TemplateSessionLifecycle` produces actual persisted Messages rather than being an empty interface with no implementations.
3. **Clean extension point**: Future AI moderation, summaries, or policy hooks can be added by implementing new `SessionLifecycle` classes — without modifying `DiscussionSessionController`, `DiscussionEngine`, or any existing component.
4. **No domain changes**: The milestone worked within existing Message, Discussion, and Panelist contracts. No repository interface, domain type, or validation rule was modified.

Subsequent milestones can wire `DiscussionSessionController` into REST routes, add AI-powered lifecycle implementations, introduce real-time event streaming, and implement automatic discussion termination — all without modifying the established four-tier orchestration architecture.
