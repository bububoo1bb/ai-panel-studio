# Prompt 08 — Round Controller

**Stage:** Implementation Phase — Milestone 7

**Date:** 2026-07-22

---

# Goal

Create an application-layer RoundController that executes exactly one panelist turn in a discussion.

A single turn loads the discussion and panelist, validates cross-entity rules, builds provider-independent AI messages, calls AIService, and persists the AI's public response as a domain Message.

This milestone introduces orchestration for one panelist only. No multi-panelist rounds, speaker selection, round numbering, host-controlled sequencing, REST endpoints, or real AI provider integration is introduced.

---

# Context

Before implementation, Claude Code was instructed to read:

- CLAUDE.md
- docs/PRD.md
- docs/SDD.md
- docs/DDD.md
- docs/TDD.md
- docs/ACCEPTANCE_CRITERIA.md
- all existing Prompt Records
- backend/package.json
- backend/tsconfig.json
- backend/src/app.ts
- backend/src/domain/discussion.ts
- backend/src/domain/message.ts
- backend/src/domain/panelist.ts
- backend/src/repositories/DiscussionRepository.ts
- backend/src/repositories/MessageRepository.ts
- backend/src/repositories/PanelistRepository.ts
- backend/src/repositories/InMemoryDiscussionRepository.ts
- backend/src/repositories/InMemoryMessageRepository.ts
- backend/src/repositories/InMemoryPanelistRepository.ts
- backend/src/ai/types.ts
- backend/src/ai/AIService.ts
- backend/src/ai/MockAIService.ts
- backend/src/ai/PromptBuilder.ts
- all existing backend tests

The backend already supported:

- Discussion, Message, and Panelist domain models
- Repository abstractions with in-memory implementations
- AIService interface with MockAIService
- PromptBuilder with `buildPanelistMessages()` and `buildPanelistSystemPrompt()`
- Express application separation from server startup
- Vitest and Supertest test infrastructure
- Dependency-injected application creation (`createApp` with `AppDependencies`)

This milestone introduces the first application-layer controller that coordinates existing domain, repository, and AI abstractions together.

---

# Prompt

```text
Implement a RoundController that executes exactly one panelist turn per
discussion.

A single turn must:

1. load the discussion
2. load the selected panelist
3. confirm the panelist belongs to the discussion
4. load existing discussion messages
5. build provider-independent AI messages
6. call AIService
7. persist the AI's public response as a domain Message
8. return the created Message

The controller must not introduce multi-panelist round execution,
speaker selection, REST endpoints, DeepSeek integration, streaming,
retries, concurrency, database persistence, or frontend changes.

Use constructor dependency injection. Depend only on repository and
AIService interfaces, never on concrete implementations.

Reuse PromptBuilder — do not duplicate its logic.

Persist only the AI response content as a public assistant message.
Do not persist prompts, system messages, model names, token usage,
hidden reasoning, internal analysis, or chain-of-thought.
```

---

# Files Created

```
backend/src/controllers/RoundController.ts     (103 lines)
backend/src/tests/round-controller.test.ts      (658 lines)
```

No controllers directory existed before this milestone. The `controllers/` directory is new and contains the application-layer coordinator.

---

# Files Modified

```
backend/src/repositories/PanelistRepository.ts              (+3 lines)
backend/src/repositories/InMemoryPanelistRepository.ts      (+5 lines)
```

### PanelistRepository.findById()

The existing `PanelistRepository` exposed only `create()` and `findByDiscussionId()`. The RoundController needs to look up a single panelist by ID to validate its existence. `findById()` was added as a minimal, backward-compatible interface extension:

```ts
/** Return the Panelist with the given id, or null when not found. */
findById(id: string): Promise<Panelist | null>;
```

The `InMemoryPanelistRepository` implementation delegates to `Array.prototype.find()` and returns `null` when no panelist matches.

This was the only repository interface change required by this milestone.

---

# RoundController API

```ts
export class RoundController {
  constructor(deps: {
    discussionRepository: DiscussionRepository;
    messageRepository: MessageRepository;
    panelistRepository: PanelistRepository;
    aiService: AIService;
  });

  executeTurn(input: {
    discussionId: string;
    panelistId: string;
  }): Promise<Message>;
}
```

### Constructor Dependency Injection

The controller accepts four dependencies via a constructor options object:

| Dependency | Interface | Purpose |
|---|---|---|
| `discussionRepository` | `DiscussionRepository` | Load and validate discussion |
| `messageRepository` | `MessageRepository` | Load history and persist response |
| `panelistRepository` | `PanelistRepository` | Load and validate panelist |
| `aiService` | `AIService` | Generate the panelist's response |

The controller depends only on abstractions — never on `MockAIService`, `InMemoryDiscussionRepository`, or any future provider implementation.

---

# Execution Flow

`executeTurn()` performs operations in this exact order:

```
1. Find discussion via DiscussionRepository.findById()
      ↳ throw "Discussion not found" if null

2. Find panelist via PanelistRepository.findById()
      ↳ throw "Panelist not found" if null

3. Confirm panelist.discussionId === input.discussionId
      ↳ throw "Panelist does not belong to discussion" on mismatch

4. Require panelist.status !== "finished"
      ↳ throw "Panelist is not active" if finished

5. Load existing messages via MessageRepository.findByDiscussionId()

6. Build AI messages via buildPanelistMessages({ discussion, panelist, messages })

7. Call AIService.generate({ messages: aiMessages })

8. Persist via MessageRepository.create({
     discussionId,
     role: "assistant",
     content: response.content
   })

9. Return the created Message
```

Each step depends on the success of every earlier step. No step is skipped or conditionally bypassed.

---

# Validation Rules

The RoundController is an application-layer coordinator. It validates cross-entity application rules but does not duplicate route-level string validation.

| # | Rule | Error |
|---|---|---|
| 1 | Discussion must exist | `"Discussion not found"` |
| 2 | Panelist must exist | `"Panelist not found"` |
| 3 | Panelist must belong to the discussion | `"Panelist does not belong to discussion"` |
| 4 | Panelist must be active (not finished) | `"Panelist is not active"` |

Validation order is deterministic: discussion → panelist existence → ownership → active status. Each rule gates the subsequent operation.

### Inactive Panelist Handling

The `PanelistStatus` type defines four values:

```ts
type PanelistStatus = "waiting" | "preparing" | "speaking" | "finished";
```

`"finished"` is treated as the inactive terminal state. It is the only status that blocks `executeTurn()`. The other three statuses (`"waiting"`, `"preparing"`, `"speaking"`) are considered active and allow the turn to proceed.

This interpretation maps to the SDD state machine: `waiting` ≈ IDLE, `preparing` ≈ THINKING, `speaking` ≈ SPEAKING, `finished` ≈ terminal/complete.

---

# Prompt and AI Integration

### Reuse of PromptBuilder

The controller imports and calls the existing `buildPanelistMessages()` function:

```ts
const aiMessages = buildPanelistMessages({
  discussion,
  panelist,
  messages,
});
```

No AI message construction logic is duplicated inside the controller. The controller delegates prompt construction entirely to `PromptBuilder`, which:

- builds the panelist system prompt from the panelist's name, role, occupation, title, and stance
- includes the discussion topic as a user message
- converts domain messages into provider-independent AI messages in insertion order
- excludes internal domain fields (id, discussionId, createdAt) from AI messages

### AIService.generate() Invocation

The controller calls `AIService.generate()` with only the `messages` field:

```ts
const response = await this.aiService.generate({ messages: aiMessages });
```

No `temperature` or `maxTokens` is specified — the SDD does not mandate fixed values at this layer, and the `GenerateAIRequest` type marks both fields as optional.

The controller depends only on the `AIService` interface, never directly on `MockAIService` or a future provider implementation.

---

# Message Persistence

### Persistence Mapping

| Created Message Field | Source |
|---|---|
| `discussionId` | `input.discussionId` |
| `role` | `"assistant"` |
| `content` | `response.content` (unmodified) |

Only the AI's public response content is persisted. The following are **not** persisted:

- AI model name
- token usage statistics
- prompts or system messages
- hidden reasoning or internal analysis
- chain-of-thought

### Panelist Attribution

The current Message domain type does not include a `panelistId` or `speakerId` field:

```ts
export interface Message {
  id: string;
  discussionId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}
```

Since the domain does not support panelist attribution on messages, the controller does not associate the created message with the selected panelist. No Message domain field was invented for this milestone.

---

# Error Handling

### Error Propagation

The RoundController does not catch or transform errors from its dependencies:

- **AIService errors** — propagate unchanged. The controller does not wrap, retry, or replace AI failures.
- **Repository errors** — propagate unchanged. Both `DiscussionRepository`, `PanelistRepository`, and `MessageRepository` errors surface directly.
- **Validation errors** — thrown as plain `Error` objects with descriptive messages.

No try/catch blocks exist in `executeTurn()`. Every error thrown by a dependency reaches the caller in its original form.

### Failure Atomicity

When an error occurs before `MessageRepository.create()` succeeds, no message is persisted. The controller does not perform compensating actions or rollback — it relies on the fact that persistence is the final step.

---

# Testing

### Test Infrastructure

All tests use in-memory repositories and `MockAIService`. No Express app is created and no `listen()` is called.

Test doubles defined in the test file:

| Double | Purpose |
|---|---|
| `FailingAIService` | Throws on `generate()` — tests AI error propagation |
| `FailingCreateMessageRepository` | Delegates reads to a real repo, throws on `create()` — tests repo error propagation |
| `FinishedPanelistStubRepository` | Returns a panelist with `status: "finished"` from `findById()` — tests inactive panelist validation |

These doubles exist only in the test file and do not add production failure-simulation behavior to `MockAIService`.

### Test Coverage

**22 new tests** added:

| Category | Count | Tests |
|---|---|---|
| Happy path | 11 | returns assistant Message; persists AI content; correct discussion association; loads existing messages; preserves message order; includes discussion topic; includes panelist system prompt; calls AIService exactly once; creates exactly one Message; does not mutate stored messages; returns the exact Message from create() |
| Discussion not found | 3 | throws `"Discussion not found"`; does not call AIService; does not create a Message |
| Panelist not found | 2 | throws `"Panelist not found"`; does not call AIService |
| Ownership mismatch | 2 | throws `"Panelist does not belong to discussion"`; does not call AIService |
| Inactive panelist | 1 | throws `"Panelist is not active"` for finished panelist; does not call AIService; does not create a Message |
| AIService error | 2 | propagates error unchanged; does not persist a Message |
| MessageRepo error | 1 | propagates error unchanged |

Tests verify orchestration order indirectly through observable behavior rather than overfitting to private implementation details.

### Total Test Count

**103 tests** across 7 test files, all passing.

---

# Verification

All verification commands completed successfully.

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ Passed (0 errors) |
| `npm test` | ✅ 7 test files passed / 103 tests passed |
| `npm run build` | ✅ Backend compiled successfully |
| `git diff --check` | ✅ No whitespace issues |
| `git status --short` | ✅ 2 modified, 2 new files |

---

# Architecture Notes

### Dependency Direction

```
RoundController
   ├── DiscussionRepository
   ├── PanelistRepository
   ├── MessageRepository
   ├── PromptBuilder
   └── AIService
```

The controller coordinates these dependencies but does not implement their responsibilities. It sits in the application layer, between the route layer (HTTP concerns) and the domain/ai layers (business logic and AI integration).

### Layer Relationships

```
REST API (future)
      │
      ▼
RoundController (application layer)
      │
      ├────▶ Repository Interfaces ──▶ InMemory Repositories ──▶ Domain Models
      │
      └────▶ AIService Interface ──▶ MockAIService (tests) / Future Provider
                  │
                  ▼
            PromptBuilder
```

### Responsibility Separation

| Component | Responsibility |
|---|---|
| `RoundController` | Cross-entity validation, orchestration, persistence coordination |
| `PromptBuilder` | Prompt construction, system prompt formatting, message conversion |
| `AIService` | AI text generation (provider-independent) |
| `Repositories` | Data persistence and retrieval |

The controller does not duplicate PromptBuilder logic, construct AIMessage arrays manually, or depend on concrete AI provider implementations.

---

# Review

The implementation was reviewed by inspecting:

- RoundController class
- PanelistRepository interface change
- InMemoryPanelistRepository implementation
- All 22 unit tests

The review confirmed:

- proper cross-entity validation order
- correct reuse of `buildPanelistMessages()`
- no duplication of PromptBuilder logic
- correct persistence mapping (only public AI content, role `"assistant"`)
- proper error propagation without catching or transforming dependency errors
- no Express, HTTP, or provider-specific imports
- controller depends only on interfaces, not concrete implementations
- inactive panelist handling uses `status === "finished"` as the terminal state
- `PanelistRepository.findById()` is the minimal interface change needed

No code changes were required after review.

---

# Scope Boundaries Respected

The following were **not** introduced:

- ✅ No multi-panelist round execution
- ✅ No automatic speaker selection
- ✅ No round numbering
- ✅ No host-controlled sequencing
- ✅ No discussion status transitions
- ✅ No REST endpoints
- ✅ No DeepSeek or real provider integration
- ✅ No streaming
- ✅ No retries
- ✅ No concurrency
- ✅ No background jobs
- ✅ No database persistence
- ✅ No frontend changes
- ✅ No chain-of-thought storage or exposure
- ✅ No `panelistId` field invented on Message
- ✅ No temperature or maxTokens parameters
- ✅ No Express imports
- ✅ No HTTP status codes
- ✅ No environment variable changes
- ✅ No package additions
- ✅ No production failure-simulation in MockAIService

---

# Result

**Milestone 7 completed successfully.**

The project now has its first application-layer controller that coordinates domain models, repositories, and AI services to execute a single panelist discussion turn.

Subsequent milestones can build on this foundation to introduce multi-panelist round execution, speaker selection, REST endpoints, and real AI provider integration without modifying the established RoundController architecture.
