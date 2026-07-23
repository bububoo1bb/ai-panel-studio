# Prompt 16 — Discussion Execution Flow

**Stage:** Implementation Phase — Milestone 16

**Date:** 2026-07-23

---

# Goal

Transform AI Panel Studio from a static discussion room into an executable discussion system.

After M15, the system can create discussions, generate AI panelists, and display them in a three-column studio layout. But the core product experience — watching AI experts debate a topic — does not exist. The user arrives at the studio page and sees a blank transcript. There is no start button, no execution trigger, no moderator opening, no expert statements, and no dynamic transcript evolution.

M16 bridges this gap:

```
M15: AI Generated Panelists (static participants)
        ↓
M16: Discussion Execution Flow   ← THIS MILESTONE
        ↓
Future: Adversarial Protocol, Consensus, SSE
```

The milestone connects the existing execution hierarchy (`DiscussionSessionController` → `DiscussionEngine` → `DiscussionController` → `RoundController` → `AIService`) to the frontend through a new API endpoint, an AI-powered session lifecycle, and frontend controls.

---

# Context

Before writing this design, the following files were inspected:

**Design documents:**
- `docs/PRD.md` — §4.4 AI 圆桌讨论, §4.5 专家状态展示, §4.6 Transcript, §4.8 讨论结束与总结
- `docs/SDD.md` — §3.3 Round Table Engine, §3.4 Transcript Manager, §5 API, §6 Data Flow, §9 AI Agent states
- `docs/DDD.md` — §3 演播厅页面设计, §4 交互设计
- `docs/TDD.md` — §2.3 Agent State Machine, §2.4 Message Manager, §4 实时通信测试, §5 E2E测试
- `docs/ACCEPTANCE_CRITERIA.md` — AC-04 圆桌讨论, AC-05 专家状态, AC-06 Transcript, AC-08 讨论总结

**Existing prompt records (style reference):**
- `prompts/13_Discussion_Session_Lifecycle.md` — session lifecycle boundary design
- `prompts/14_Message_Attribution.md` — message metadata (Phase 1 + Phase 2)
- `prompts/15_AI_Panelist_Generation.md` — AI panelist generation pipeline

**Backend source (complete execution hierarchy):**
- `backend/src/domain/discussion.ts` — `Discussion`, `DiscussionStatus` (`"active" | "finished"`)
- `backend/src/domain/panelist.ts` — `Panelist`, `PanelistRole` (`"host" | "expert"`), `PanelistStatus` (`"waiting" | "preparing" | "speaking" | "finished"`)
- `backend/src/domain/message.ts` — `Message`, `MessageKind` (`"moderator_opening" | "moderator_call" | "moderator_closing" | "expert_statement" | "system_notification"`)
- `backend/src/ai/AIService.ts` — provider-independent `generate()` interface
- `backend/src/ai/types.ts` — `AIMessage`, `GenerateAIRequest`, `GenerateAIResponse`
- `backend/src/ai/PromptBuilder.ts` — `buildPanelistSystemPrompt()`, `buildPanelistMessages()`, `buildPanelistGenerationSystemPrompt()`, `buildPanelistGenerationMessages()`
- `backend/src/controllers/RoundController.ts` — single-turn execution (validation, prompt construction, AI generation, message persistence)
- `backend/src/controllers/DiscussionController.ts` — single-round orchestration (iterates active panelists, delegates to RoundController)
- `backend/src/controllers/DiscussionSessionController.ts` — session lifecycle wrapper (validates, invokes hooks, delegates to engine)
- `backend/src/services/DiscussionEngine.ts` — multi-round orchestration (sequential loops, stop conditions, maxRounds safety)
- `backend/src/lifecycle/SessionLifecycle.ts` — interface with `onSessionStart` / `onSessionEnd` hooks
- `backend/src/lifecycle/TemplateSessionLifecycle.ts` — deterministic non-AI implementation (fixed Chinese template messages)
- `backend/src/routes/discussion.ts` — `POST /`, `GET /`
- `backend/src/routes/panelist.ts` — `GET /`, `POST /`, `POST /generate`
- `backend/src/routes/message.ts` — `GET /`, `POST /`
- `backend/src/app.ts` — `createApp()`, `AppDependencies`, dependency injection

**Frontend source:**
- `frontend/src/pages/DiscussionRoomPage.tsx` — three-column studio, loads data on mount, SSE stubs commented out
- `frontend/src/api/panelistApi.ts` — `fetchPanelists()`, `generatePanelists()`
- `frontend/src/api/messageApi.ts` — `fetchMessages()`
- `frontend/src/api/discussionApi.ts` — `fetchDiscussion()`

**Test infrastructure:**
- 15 test files, 308 tests, all passing
- `MockAIService`, `InMemory*Repositories`, `createApp()` dependency injection

---

# 1. Background — Why This Milestone Exists

### The Gap

After M15, the system has every component needed for discussion execution — but they are not connected:

| Component | Status | Gap |
|---|---|---|
| `DiscussionSessionController` | Implemented, tested | Not wired to any HTTP route |
| `DiscussionEngine` | Implemented, tested | No caller in production path |
| `DiscussionController` | Implemented, tested | Round-robin — works but hosts and experts treated identically |
| `RoundController` | Implemented, tested | Generates turns but no one invokes it in production |
| `AIService` (DeepSeek) | Implemented, tested | Only called by PanelistGenerator, never for discussion |
| `TemplateSessionLifecycle` | Implemented, tested | Creates fixed Chinese text — no AI moderator behaviour |
| `DiscussionRoomPage` | Implemented | Loads static data on mount — no start button, no polling, no SSE |

Every piece works in isolation. None are connected in the production path.

### The Transition

```
┌─────────────────────────────────────────────────────────┐
│ M15: AI Generated Panelists                             │
│                                                         │
│  User creates discussion → AI generates panelists       │
│  → Confirmation page → Navigate to studio               │
│  → Studio shows: panelist cards ✓, transcript (empty) ✗ │
│                                                         │
│  The stage is set. The actors are cast.                 │
│  But the curtain has not risen.                         │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ M16: Discussion Execution Flow                          │
│                                                         │
│  User clicks "Start Discussion"                         │
│  → Moderator delivers AI opening statement              │
│  → Experts speak in sequence (round-robin v0)           │
│  → Messages are persisted                               │
│  → Frontend displays evolving transcript                │
│  → Moderator delivers AI closing statement              │
│  → Discussion ends                                      │
│                                                         │
│  The curtain rises. The discussion begins.              │
└─────────────────────────────────────────────────────────┘
```

M16 is not about perfecting the discussion protocol. It is about closing the loop — making the end-to-end flow work so that a user can watch AI experts discuss their topic.

---

# 2. Product Goal

### User Flow (Post-M16)

```
User arrives at studio page (/discussion/:id)
        │
        ▼
Sees: panelist cards (left), empty transcript (center), empty insights (right)
        │
        ▼
Clicks "开始讨论" (Start Discussion)
        │
        ▼
POST /api/discussions/:id/start
        │
        ▼
Backend executes:
  1. Moderator (host panelist) delivers AI opening statement
     → appears in transcript with kind: "moderator_opening"
  2. Experts speak in sequence (one round = all active experts)
     → each message appears with kind: "expert_statement"
  3. Repeat for maxRounds rounds
  4. Moderator delivers AI closing statement
     → appears in transcript with kind: "moderator_closing"
        │
        ▼
Frontend polls GET /api/discussions/:id/messages
  → Transcript grows in real time
  → Active speaker is highlighted
        │
        ▼
Discussion completes
  → "ON AIR" indicator turns off
  → Transcript is complete
```

### What M16 Delivers

- **Start button** in the studio — the user initiates the discussion
- **Moderator opening** — AI-generated, from the host panelist's perspective, welcoming experts and framing the topic
- **Expert statements** — each expert speaks once per round, generating substantive content from their assigned stance
- **Moderator closing** — AI-generated summary and wrap-up from the host
- **Transcript evolution** — frontend polls and displays new messages as they are generated
- **Running state** — frontend shows discussion is in progress, disables start button

### What M16 Does NOT Deliver

- ❌ Self-selection / non-round-robin scheduling (deferred — requires `SpeakingRequest`, `TurnScheduler`)
- ❌ Expert-to-expert replies or adversarial exchange (deferred — requires `replyToMessageId` population)
- ❌ Real-time SSE/WebSocket push (polling is sufficient for v0)
- ❌ Expert state machine animation (IDLE → THINKING → READY → SPEAKING → COOLDOWN)
- ❌ Consensus/disagreement analysis (deferred — requires `ConsensusAnalyzer`)
- ❌ Pause, resume, or cancel
- ❌ Per-round moderator bridging/calling (moderator only opens and closes)
- ❌ `replyToMessageId` population
- ❌ TurnScheduler, ReactionEvaluator, NextSpeakerSelector (all M13 proposal concepts)

---

# 3. Architecture Analysis

### 3.1 Current Execution Hierarchy

```
DiscussionSessionController  ← session lifecycle boundary (NOT wired to any route)
        │
        ▼
DiscussionEngine              ← multi-round orchestration (validates, loops, stops)
        │
        ▼
DiscussionController          ← single-round orchestration (iterates active panelists)
        │
        ▼
RoundController               ← single-turn execution (validates, builds prompt, calls AI, persists)
        │
        ▼
AIService                     ← provider-independent AI generation
```

### 3.2 What Can Be Reused (No Modification)

| Component | File | Reuse |
|---|---|---|
| `DiscussionEngine` | `services/DiscussionEngine.ts` | Unchanged. Multi-round orchestration with maxRounds, stop conditions, sequential execution. |
| `DiscussionController` | `controllers/DiscussionController.ts` | Unchanged. Iterates active panelists, delegates to RoundController. Round-robin behaviour is acceptable for v0. |
| `RoundController` | `controllers/RoundController.ts` | Unchanged. Already populates `panelistId` and `kind` (`"expert_statement"` for experts, `null` for hosts). |
| `DiscussionSessionController` | `controllers/DiscussionSessionController.ts` | Unchanged. Already handles validation, lifecycle hooks, engine delegation, message ordering. |
| `AIService` interface | `ai/AIService.ts` | Unchanged. Provider-independent abstraction. |
| `PromptBuilder` | `ai/PromptBuilder.ts` | **Extended** (new functions, not modifications). Existing `buildPanelistSystemPrompt()` and `buildPanelistMessages()` are reused for expert turns and moderator turns. |
| `SessionLifecycle` interface | `lifecycle/SessionLifecycle.ts` | Unchanged. Two hooks: `onSessionStart`, `onSessionEnd`. |
| All domain models | `domain/*.ts` | Unchanged. `Discussion`, `Panelist`, `Message`, `MessageKind` all in place. |
| All repository interfaces | `repositories/*.ts` | Unchanged. |
| `createApp` / `AppDependencies` | `app.ts` | **Extended** (new optional dependency, not signature changes). |
| Frontend API layer | `api/*.ts` | **Extended** (new `startDiscussion()` function). |
| Frontend types | `types/*.ts` | Unchanged. |

### 3.3 What Needs Extension

| Component | What Changes |
|---|---|
| `ModeratorStrategy` (new interface) | New abstraction for moderator intelligence — opening statement, closing summary. Separates *what* the moderator says from *when* lifecycle hooks fire. |
| `AIModeratorStrategy` (new class) | Concrete implementation using `AIService` + `PanelistRepository` + `MessageRepository`. Constructs moderator prompts, calls AI, persists messages with correct `panelistId` and `kind`. |
| `PromptBuilder` | Add `buildModeratorOpeningPrompt()` and `buildModeratorClosingPrompt()` — specialized prompts invoked by `AIModeratorStrategy`. |
| `SessionLifecycle` (new implementation) | Create `AISessionLifecycle` — a thin adapter that delegates to `ModeratorStrategy`. Does NOT directly depend on `AIService`, `PanelistRepository`, or `MessageRepository`. |
| Routes | Add `POST /api/discussions/:id/start` — wires `DiscussionSessionController` to HTTP. |
| `AppDependencies` / `createApp` | Wire `ModeratorStrategy`, `AISessionLifecycle`, and `DiscussionSessionController` into the dependency graph. |
| `DiscussionRoomPage` | Add start button, running state, **temporary polling**, disabled states. |
| Frontend API layer | Add `startDiscussion()` API function. |

### 3.4 Minimally Modified Components

One existing component requires a focused, minimal change:

| Component | Change | Justification |
|---|---|---|
| `DiscussionController` | Add `p.role !== "host"` to the active-panelist filter | Prevents the host from speaking during round-robin rounds. The host speaks only through `ModeratorStrategy` (opening + closing). One additional condition — the smallest possible change. |

### 3.5 What Should NOT Be Modified

Following the established layering pattern (every milestone introduces new components that wrap or extend — never modify — existing components):

- ❌ `DiscussionEngine` — zero changes. The engine is a stable, bounded multi-round orchestrator. Must NOT understand adversarial concepts (`ExpertReaction`, `SpeakingRequest`, `ReactionEvaluator`, `TurnScheduler`).
- ❌ `RoundController` — zero changes. Already handles single turns correctly with full metadata population.
- ❌ `DiscussionSessionController` — zero changes. Already handles validation, lifecycle hooks, engine delegation, message ordering.
- ❌ `SessionLifecycle` interface — zero changes. `onSessionStart` / `onSessionEnd` remain the only hooks.
- ❌ `AIService` interface — zero changes.
- ❌ Domain models — zero changes.
- ❌ Repository interfaces — zero changes. (Except possibly `DiscussionRepository.update()` for status transition.)
- ❌ `TemplateSessionLifecycle` — zero changes. Remains available for testing/fallback.
- ❌ Existing routes — zero changes. New route is additive.
- ❌ `PanelistGenerator` — zero changes.
- ❌ Frontend type definitions — zero changes.

### 3.4 What Should NOT Be Modified

Following the established layering pattern (every milestone introduces new components that wrap or extend — never modify — existing components):

- ❌ `DiscussionEngine` — zero changes. The engine is a stable, bounded multi-round orchestrator.
- ❌ `DiscussionController` — zero changes. Round-robin is acceptable for v0.
- ❌ `RoundController` — zero changes. Already handles single turns correctly.
- ❌ `DiscussionSessionController` — zero changes. Already handles session lifecycle correctly.
- ❌ `SessionLifecycle` interface — zero changes. `onSessionStart` / `onSessionEnd` are sufficient.
- ❌ `AIService` interface — zero changes.
- ❌ Domain models — zero changes.
- ❌ Repository interfaces — zero changes.
- ❌ `TemplateSessionLifecycle` — zero changes. Remains available for testing/fallback.
- ❌ Existing routes — zero changes. New route is additive.

---

# 4. Execution Design

### 4.1 Discussion Execution Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│ POST /api/discussions/:id/start                              │
│   { maxRounds: 5 }                                           │
│                                                              │
│   ↓                                                          │
│                                                              │
│ 1. Validate request                                          │
│    - discussionId exists                                     │
│    - discussion.status !== "finished"                        │
│    - maxRounds is a positive finite integer                  │
│    - discussion has panelists (at least 1 host + 1 expert)   │
│                                                              │
│   ↓                                                          │
│                                                              │
│ 2. DiscussionSessionController.runSession()                  │
│                                                              │
│    ┌──────────────────────────────────────────┐              │
│    │ 2a. onSessionStart (lifecycle hook)      │              │
│    │     AISessionLifecycle →                 │              │
│    │       ModeratorStrategy.openDiscussion() │              │
│    │         ├─ Find host panelist            │              │
│    │         ├─ Build opening prompt          │              │
│    │         ├─ AIService.generate()          │              │
│    │         └─ Persist with:                 │              │
│    │              panelistId: host.id         │              │
│    │              kind: "moderator_opening"   │              │
│    │     Returns [openingMessage]             │              │
│    └──────────────────────────────────────────┘              │
│                    ↓                                         │
│    ┌──────────────────────────────────────────┐              │
│    │ 2b. DiscussionEngine.runDiscussion()     │              │
│    │                                          │              │
│    │   Round 1:                               │              │
│    │     Host (role check → skipped)          │              │
│    │     Expert A → AI → persist statement    │              │
│    │     Expert B → AI → persist statement    │              │
│    │     Expert C → AI → persist statement    │              │
│    │                                          │              │
│    │   Round 2 … N (same pattern)             │              │
│    │                                          │              │
│    │   Stop conditions:                       │              │
│    │   - discussion.status === "finished"     │              │
│    │   - no active panelists                  │              │
│    │   - maxRounds reached                    │              │
│    └──────────────────────────────────────────┘              │
│                    ↓                                         │
│    ┌──────────────────────────────────────────┐              │
│    │ 2c. onSessionEnd (lifecycle hook)        │              │
│    │     AISessionLifecycle →                 │              │
│    │       ModeratorStrategy.closeDiscussion()│              │
│    │         ├─ Find host panelist            │              │
│    │         ├─ Build closing prompt          │              │
│    │         ├─ AIService.generate()          │              │
│    │         └─ Persist with:                 │              │
│    │              panelistId: host.id         │              │
│    │              kind: "moderator_closing"   │              │
│    │     Returns [closingMessage]             │              │
│    └──────────────────────────────────────────┘              │
│                    ↓                                         │
│                                                              │
│ 3. Return all messages in order:                             │
│    [opening, ...roundMessages, closing]                      │
│                                                              │
│ 4. Update discussion.status → "finished"                     │
│                                                              │
│ 5. Response:                                                 │
│    HTTP 200 { messages: Message[], discussion: Discussion }  │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Responsibility Boundaries

| Layer | Owns | Does NOT Own |
|---|---|---|
| **HTTP Route** (`/start`) | Request validation, response formatting, error-to-status-code mapping, discussion status transition | Discussion logic, AI calls, message persistence |
| **DiscussionSessionController** | Session lifecycle orchestration, maxRounds validation, hook invocation order | Round execution, AI calls, moderator logic |
| **SessionLifecycle** (`AISessionLifecycle`) | Boundary timing — mapping lifecycle hooks to moderator actions | AI calls, prompt construction, message persistence |
| **ModeratorStrategy** (`AIModeratorStrategy`) | Moderator intelligence — opening/closing content, prompt construction, AI calls, message persistence | Lifecycle timing, round execution, expert turns |
| **DiscussionEngine** | Multi-round looping, stop condition evaluation, round delegation | Single-turn execution, prompt construction, AI calls, adversarial concepts |
| **DiscussionController** | Round orchestration, expert panelist iteration (host excluded) | Single-turn execution, prompt construction |
| **RoundController** | Single-turn execution, validation, prompt construction, AI call, message persistence | Multi-turn orchestration, scheduling |

### 4.3 Host Turn Handling in Round-Robin

The current `DiscussionController` iterates all active panelists including the host. In M16, the host speaks only through `ModeratorStrategy` (opening + closing), not during rounds.

**Decision:** Add `p.role !== "host"` to the active-panelist filter in `DiscussionController.executeDiscussion()`. This is a one-condition change — the smallest possible modification. Experts speak in rounds; the host speaks only at session boundaries.

**DiscussionEngine is untouched.** It continues to delegate round execution to `DiscussionController` without any awareness of panelist roles. The engine does not understand adversarial concepts (`ExpertReaction`, `SpeakingRequest`, `ReactionEvaluator`, `TurnScheduler`) — consistent with the M13 architectural boundary.

---

# 5. Moderator Design

### 5.1 Separation of Concerns — The Key Architecture Decision

The original M16 draft placed moderator intelligence directly inside `AISessionLifecycle`. Architecture review identified a conflation risk: over time, `SessionLifecycle` would accumulate moderator logic (opening, bridging, transitions, calling experts, closing summaries), turning a clean boundary-hook interface into a general AI orchestration service.

**Revised design:** Moderator responsibility is separated into its own abstraction.

```
SessionLifecycle                  ModeratorStrategy
(boundary timing)                 (moderator intelligence)
        │                                  │
        │  WHEN to fire                    │  WHAT to say
        │  hooks                           │
        │                                  │
        ▼                                  ▼
AISessionLifecycle ────delegates───→ AIModeratorStrategy
(thin adapter,                      (AI prompt + persist,
 1 dependency only)                  owns AIService)
```

| Concern | Owned By | Why |
|---|---|---|
| **When** to invoke moderator actions | `SessionLifecycle` | Session boundary timing is a lifecycle concern |
| **What** the moderator says | `ModeratorStrategy` | Content, prompts, and AI calls are moderator intelligence |
| **How** the content is generated | `AIModeratorStrategy` | Provider-specific AI integration |

### 5.2 ModeratorStrategy Interface

```ts
export interface ModeratorStrategy {
  /** Generate and persist the moderator's opening statement. */
  openDiscussion(discussionId: string): Promise<Message>;

  /** Generate and persist the moderator's closing statement. */
  closeDiscussion(discussionId: string): Promise<Message>;
}
```

Two methods for M16. The interface is intentionally narrow. Future milestones can extend it without changing `SessionLifecycle` or `DiscussionSessionController`:

| Future Method | Purpose | Milestone |
|---|---|---|
| `introduceExpert(expertId)` | Moderator introduces an expert before they speak | Later |
| `bridgeTransition()` | Transition between expert statements | Later |
| `callOnExpert(expertId, topic)` | Moderator directs a question to a specific expert | Later |

### 5.3 AIModeratorStrategy (Concrete Implementation)

```ts
export class AIModeratorStrategy implements ModeratorStrategy {
  constructor(deps: {
    aiService: AIService;
    panelistRepository: PanelistRepository;
    discussionRepository: DiscussionRepository;
    messageRepository: MessageRepository;
  }) { ... }

  async openDiscussion(discussionId: string): Promise<Message>;
  async closeDiscussion(discussionId: string): Promise<Message>;
}
```

**`openDiscussion()`:**
1. Load discussion via `DiscussionRepository.findById()`
2. Load all panelists via `PanelistRepository.findByDiscussionId()`
3. Find the host panelist (`role === "host"`) — throw if absent
4. Collect expert panelists for name/title reference
5. Build moderator opening prompt (via `PromptBuilder`)
6. Call `AIService.generate()`
7. Persist via `MessageRepository.create()` with metadata:
   - `panelistId`: host panelist ID
   - `kind`: `"moderator_opening"`
   - `role`: `"assistant"`
   - `replyToMessageId`: `null`
8. Return the persisted `Message`

**`closeDiscussion()`:**
Same flow but with the closing prompt and `kind: "moderator_closing"`.

### 5.4 AISessionLifecycle (Thin Adapter)

```ts
export class AISessionLifecycle implements SessionLifecycle {
  constructor(deps: { moderator: ModeratorStrategy }) { ... }

  async onSessionStart(ctx: { discussionId: string }): Promise<Message[]> {
    const msg = await this.moderator.openDiscussion(ctx.discussionId);
    return [msg];
  }

  async onSessionEnd(ctx: { discussionId: string }): Promise<Message[]> {
    const msg = await this.moderator.closeDiscussion(ctx.discussionId);
    return [msg];
  }
}
```

`AISessionLifecycle` has exactly **one dependency** — `ModeratorStrategy`. It does NOT directly depend on `AIService`, `PanelistRepository`, `DiscussionRepository`, or `MessageRepository`. Its sole responsibility is mapping lifecycle hooks to moderator actions.

### 5.5 Why This Separation Matters

| Scenario | Without Separation | With Separation |
|---|---|---|
| Add per-round moderator bridging | Modify `AISessionLifecycle` → entangled with lifecycle timing | Add `bridgeTransition()` to `ModeratorStrategy` → lifecycle unchanged |
| Test moderator prompts in isolation | Test through lifecycle → entangled with session timing, DiscussionSessionController | Test `AIModeratorStrategy` directly → pure moderator intelligence, mock AIService only |
| Swap moderator behaviour | Replace entire `SessionLifecycle` implementation | Swap `ModeratorStrategy` implementation → `AISessionLifecycle` unchanged |
| Add lifecycle side effects (metrics, logging) | Tangled with moderator prompt logic | Add to `AISessionLifecycle` without touching `ModeratorStrategy` |
| Future: multiple moderator styles (formal, Socratic, debate) | One `SessionLifecycle` per style | One `ModeratorStrategy` per style → same `AISessionLifecycle` adapter |

This separation preserves the M13 architectural boundary: `SessionLifecycle` remains a session-boundary concern, and moderator intelligence evolves independently.

### 5.6 Prompt Design

The moderator prompts are constructed by `AIModeratorStrategy` (delegating to `PromptBuilder` for consistency with existing patterns).

**Opening prompt:**

```
You are {host.name}, the moderator of this roundtable discussion.

Your role: Professionally open the discussion.

Instructions:
- Welcome all experts by name and title
- Briefly restate the discussion topic: "{discussion.title}"
- Explain why this topic matters and what the discussion aims to explore
- Set a constructive, intellectually rigorous tone
- Do NOT express your own position on the topic — you are neutral
- Keep your opening to 3-5 sentences
- Output ONLY your public opening statement — no internal reasoning
```

**Closing prompt:**

```
You are {host.name}, the moderator of this roundtable discussion.

The discussion on "{discussion.title}" is concluding.

Your role: Professionally close the discussion.

Instructions:
- Thank all experts for their contributions
- Briefly summarize the key perspectives that were raised
- Note areas of agreement and productive disagreement
- Do NOT introduce new arguments or take sides
- Keep your closing to 3-5 sentences
- Output ONLY your public closing statement — no internal reasoning
```

### 5.7 No Chain-of-Thought Exposure

Both prompts include the constraint: "Output ONLY your public [opening/closing] statement — no internal reasoning." This is consistent with `buildPanelistSystemPrompt()` which already includes: "Output only your public response — never reveal private chain-of-thought, hidden reasoning, or internal analysis."

The AI response content is persisted directly as `Message.content`. No parsing, filtering, or transformation is applied. The prompt engineering constraint is the sole defence against CoT leakage — consistent with how `RoundController` handles expert statements.

### 5.8 Message Metadata

Messages created by `AIModeratorStrategy` carry:

| Field | Opening | Closing |
|---|---|---|
| `panelistId` | host panelist ID | host panelist ID |
| `kind` | `"moderator_opening"` | `"moderator_closing"` |
| `role` | `"assistant"` | `"assistant"` |
| `replyToMessageId` | `null` | `null` |

This is the first time `"moderator_opening"` and `"moderator_closing"` are populated in production — completing the `MessageKind` type's intended usage.

---

# 6. Expert Speaking Design

### 6.1 Reusing RoundController

Expert turns are handled by the existing `RoundController.executeTurn()`, which already:

1. Validates the panelist (exists, belongs to discussion, active)
2. Loads the discussion and existing messages
3. Builds AI messages via `buildPanelistMessages()` (system prompt + topic + conversation history)
4. Calls `AIService.generate()`
5. Persists with `panelistId` and `kind: "expert_statement"`

**No changes to RoundController are needed.** The existing implementation is correct for M16.

### 6.2 What Experts Receive

Each expert turn, via `buildPanelistMessages()`, receives:

1. **System prompt** — their identity, occupation, title, stance, behavioural constraints
2. **Discussion topic** — the user's topic
3. **Full conversation history** — all prior messages (moderator opening + previous expert statements)

### 6.3 What Experts Produce

Each expert produces:
- A single public statement (content)
- Persisted with correct metadata (`panelistId`, `kind: "expert_statement"`)
- No private reasoning exposed

### 6.4 V0 Round-Robin Limitations

In v0, experts speak in fixed insertion order once per round. They do not:
- Self-select based on relevance to the current topic
- React to specific prior statements (no `replyToMessageId`)
- Compete for the floor (no `SpeakingRequest`)
- Have a cooldown period (no state machine)

These are deliberate v0 simplifications. The infrastructure for all of these exists in the domain model (`MessageKind`, `replyToMessageId`, `PanelistStatus`) and will be activated in future milestones.

### 6.5 Context Accumulation

Each round, experts receive the full transcript accumulated so far. This means:
- Round 1 experts see: moderator opening
- Round 2 experts see: moderator opening + all round 1 expert statements
- Round N experts see: moderator opening + all prior round statements

The AI's context window grows with each round. `maxRounds` serves as the safety boundary. For a typical discussion with 5 experts and 3 rounds, the context includes ~15 prior messages — well within any model's context limit.

---

# 7. API Design

### 7.1 Start Discussion Endpoint

```
POST /api/discussions/:id/start
```

**Request body:**

```json
{
  "maxRounds": 5
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `maxRounds` | `number` | Yes | Positive finite integer (recommended: 2–10) |

**Success response (HTTP 200):**

```json
{
  "discussion": {
    "id": "uuid",
    "title": "新能源汽车未来发展",
    "status": "active",
    "createdAt": "2026-07-23T..."
  },
  "messages": [
    {
      "id": "uuid",
      "discussionId": "uuid",
      "panelistId": "host-uuid",
      "role": "assistant",
      "kind": "moderator_opening",
      "content": "各位专家，欢迎来到今天的圆桌讨论...",
      "replyToMessageId": null,
      "createdAt": "2026-07-23T..."
    }
    // ... expert statements in order ...
    // ... moderator closing last ...
  ]
}
```

**Error responses:**

| Status | Condition | Body |
|---|---|---|
| 400 | `maxRounds` missing or invalid | `{ "error": "maxRounds must be a positive integer" }` |
| 404 | Discussion not found | `{ "error": "Discussion not found" }` |
| 409 | Discussion already finished | `{ "error": "Discussion is already finished" }` |
| 422 | Discussion has no panelists | `{ "error": "Discussion has no panelists" }` |
| 422 | No host panelist found | `{ "error": "No moderator found for this discussion" }` |
| 500 | AI service failure | `{ "error": "Discussion execution failed" }` |

### 7.2 Route Implementation Pattern

Following the established `createXxxRouter` factory pattern:

```ts
// New file: backend/src/routes/discussion.ts (extended)
// or: backend/src/routes/start.ts (new file)

export function createStartRouter(
  discussionRepository: DiscussionRepository,
  discussionSessionController: DiscussionSessionController,
): Router {
  const router = Router({ mergeParams: true });

  router.post("/start", async (req: Request, res: Response) => {
    // 1. Validate discussion exists and is active
    // 2. Validate maxRounds
    // 3. Validate panelists exist
    // 4. Call discussionSessionController.runSession()
    // 5. Return messages
  });

  return router;
}
```

**Mount point:** `POST /api/discussions/:id/start`

The route is mounted on the discussion router (or as a separate router mounted at `/api/discussions/:discussionId`).

### 7.3 Discussion Status After Execution

After successful execution, the discussion status transitions from `"active"` to `"finished"`. This is a new behaviour — previously, `Discussion.status` was never mutated after creation.

**Where it happens:** `DiscussionSessionController.runSession()` updates the discussion status to `"finished"` after `onSessionEnd` completes successfully.

**Repository requirement:** `DiscussionRepository` needs an `update()` method (or the status change is implemented through the existing `create()` pattern). This is a repository interface extension.

**Alternative:** The status change could happen in the route handler after `runSession()` returns, keeping `DiscussionSessionController` unchanged.

**Design decision:** Update status in the route handler after successful `runSession()` completion. This keeps `DiscussionSessionController` unchanged and the status mutation at the HTTP boundary where it belongs.

---

# 8. Frontend Integration

### 8.1 DiscussionRoomPage Changes

The page transitions from a static display to an interactive execution UI.

**New states:**

```
┌──────────┐    click start    ┌──────────┐   execution    ┌──────────┐
│  READY   │ ────────────────→ │ RUNNING  │ ─────────────→ │ FINISHED │
│          │                   │          │   complete      │          │
│ show     │                   │ disable  │                 │ show     │
│ start    │                   │ start    │                 │ complete │
│ button   │                   │ button   │                 │ state    │
└──────────┘                   └──────────┘                 └──────────┘
```

**State machine:**

| State | Condition | UI |
|---|---|---|
| `ready` | discussion.status === "active", messages.length === 0 (or only system notifications) | Show "开始讨论" button, transcript shows "等待讨论开始…" |
| `running` | Executing | Disable start button, show "● ON AIR" indicator, poll for new messages, highlight latest speaker |
| `finished` | discussion.status === "finished" | Remove start button, show "讨论已结束", transcript is complete |
| `error` | Execution failed | Show error message with retry option |

### 8.2 Start Button

Located in the top bar of the studio, next to the "ON AIR" indicator:

```tsx
{pageState === "ready" && (
  <button className={styles.startButton} onClick={handleStart}>
    开始讨论
  </button>
)}
```

### 8.3 Transport Mechanism — Temporary Polling

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠️  TRANSPORT NOTICE                                         │
│                                                              │
│  M16 (current):  HTTP polling (GET /api/discussions/:id/     │
│                  messages every 2s)                           │
│                                                              │
│  Future:         SSE / WebSocket event streaming             │
│                  (POST /api/discussions/:id/start returns    │
│                   immediately; events pushed via persistent  │
│                   connection)                                │
│                                                              │
│  Polling is a DELIBERATE TEMPORARY SIMPLIFICATION.           │
│  It is not the final realtime architecture.                  │
│                                                              │
│  Compatibility: the polling useEffect is isolated in         │
│  DiscussionRoomPage. Replacing it with SSE requires          │
│  changing ONE location. No other component depends on        │
│  the polling mechanism.                                      │
└──────────────────────────────────────────────────────────────┘
```

**Polling implementation (M16 only):**

```ts
// M16 TEMPORARY: HTTP polling at 2s interval
// Future: replace with EventSource("/api/discussions/:id/events")
useEffect(() => {
  if (pageState !== "running") return;

  const interval = setInterval(async () => {
    const msgs = await fetchMessages(id);
    setMessages(msgs);

    // Also check if discussion has finished
    const disc = await fetchDiscussion(id);
    if (disc.status === "finished") {
      setDiscussion(disc);
      setPageState("finished");
      clearInterval(interval);
    }
  }, 2000);

  return () => clearInterval(interval);
}, [pageState, id]);
```

**Future SSE replacement (NOT implemented in M16):**

```ts
// Future: replace the polling useEffect above with this
const eventSource = new EventSource(`/api/discussions/${id}/events`);
eventSource.addEventListener("message_created", (e) => {
  const msg: Message = JSON.parse(e.data);
  setMessages((prev) => [...prev, msg]);
  setActiveSpeakerId(msg.panelistId);
});
eventSource.addEventListener("discussion_finished", (e) => {
  setPageState("finished");
  eventSource.close();
});
return () => eventSource.close();
```

The `DiscussionRoomPage` already has SSE stubs (commented out) from M14. M16's polling is isolated in one `useEffect` — migrating to SSE changes one location only.

### 8.4 API Layer Addition

```ts
// New function in frontend/src/api/discussionApi.ts
export async function startDiscussion(
  discussionId: string,
  maxRounds: number,
): Promise<{ discussion: Discussion; messages: Message[] }> {
  const response = await fetch(`/api/discussions/${discussionId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxRounds }),
  });

  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error ?? "Failed to start discussion");
  }

  return response.json();
}
```

### 8.5 TranscriptPanel During Execution

The `TranscriptPanel` component already handles message display with speaker identity. No changes needed — it automatically shows new messages as they arrive via polling.

The component already receives `discussionStatus` and can show appropriate empty states:
- `"active"` with no messages → "等待讨论开始…"
- `"active"` with messages → show transcript
- `"finished"` → show transcript with "讨论已结束" footer

---

# 9. Testing Strategy

### 9.1 Test Categories

| Category | Count (est.) | What It Verifies |
|---|---|---|
| `ModeratorStrategy` interface contract | ~3 | Interface shape, method signatures, return types |
| `AIModeratorStrategy` unit tests | ~10 | Opening/closing generation, host lookup, prompt construction, metadata correctness, error on missing host |
| `AISessionLifecycle` unit tests | ~4 | Delegation to ModeratorStrategy, correct return wrapping, error propagation |
| `DiscussionController` host filter | ~2 | Host panelist excluded from round execution; experts still included |
| Start route integration tests | ~10 | Validation (maxRounds, discussion not found, already finished, no panelists), success path, error propagation |
| End-to-end session execution | ~6 | Complete flow: opening → rounds → closing, message ordering, metadata correctness |
| Frontend component tests | ~4 | Start button visibility, running state, polling trigger, finished state |

### 9.2 Key Test Scenarios

**ModeratorStrategy / AIModeratorStrategy:**
- `openDiscussion()` generates a message with correct `panelistId` (host) and `kind: "moderator_opening"`
- `closeDiscussion()` generates a message with correct `panelistId` (host) and `kind: "moderator_closing"`
- Throws when no host panelist exists in the discussion
- Opening prompt includes expert names and discussion topic
- Closing prompt references the discussion topic
- Messages are persisted to MessageRepository
- Does not expose chain-of-thought in generated content (prompt constraint verified via mock)
- Multiple calls produce distinct messages (no caching)
- `AIModeratorStrategy` works with `MockAIService` — no real API calls in tests
- Error from `AIService` propagates correctly

**AISessionLifecycle (thin adapter):**
- `onSessionStart` delegates to `moderator.openDiscussion()` and wraps result in array
- `onSessionEnd` delegates to `moderator.closeDiscussion()` and wraps result in array
- Error from `ModeratorStrategy` propagates unchanged
- Has no direct dependency on `AIService`, `PanelistRepository`, or `MessageRepository`

**DiscussionController host filter:**
- Host panelist is excluded from round execution (not passed to RoundController)
- Expert panelists are still included
- Host exclusion does not affect other filter conditions (finished panelists still excluded)

**Start route:**
- Returns 200 with all messages on success
- Returns 400 when `maxRounds` is missing or invalid
- Returns 404 when discussion does not exist
- Returns 409 when discussion is already finished
- Returns 422 when discussion has no panelists or no host
- Returns 500 when AI service fails
- Messages include moderator opening first and moderator closing last
- Discussion status changes to `"finished"` after successful execution

**End-to-end session execution:**
- Complete flow: opening → rounds → closing
- Messages are in chronological order
- Expert messages have `kind: "expert_statement"` and correct `panelistId`
- Opening has `kind: "moderator_opening"`
- Closing has `kind: "moderator_closing"`
- Discussion isolation (different discussions don't leak messages)

### 9.3 Test Infrastructure

All tests use existing infrastructure:
- `MockAIService` with configurable content for AI responses
- `InMemory*Repositories` for data isolation
- `createApp()` with injected dependencies for route tests
- No real AI API calls, no network ports

### 9.4 Existing Tests Must Not Break

All 308 existing tests must continue to pass. New components are additive — no existing test fixtures, assertions, or test doubles are modified.

### 9.5 DiscussionController Test Impact

`DiscussionController` receives one new filter condition (`p.role !== "host"`). Existing `discussion-controller.test.ts` tests that include host panelists in expected round output will need fixture updates. Tests for `RoundController`'s host-turn behaviour (M13 Phase 2: "sets panelistId for host panelists and leaves kind null") remain valid — host turns can still be executed via `RoundController` directly, just not through `DiscussionController`.

---

# 10. Future Compatibility

### 10.1 Adversarial Discussion Protocol

The M13 design proposal defines `ReactionEvaluator`, `SpeakingRequest`, `TurnScheduler`, and `NextSpeakerSelector`. M16 introduces `ModeratorStrategy` as a separate abstraction (compatible with the M13 `ModeratorStrategy` concept) while keeping `DiscussionEngine` unaware of adversarial concepts:

- **`ModeratorStrategy` is M16's foundation** for the M13 `ModeratorStrategy`. M16 implements `openDiscussion()` and `closeDiscussion()`. Future milestones add `introduceExpert()`, `bridgeTransition()`, and `callOnExpert()` — same interface, extended methods.
- **`DiscussionEngine` does NOT understand** `ExpertReaction`, `SpeakingRequest`, `ReactionEvaluator`, or `TurnScheduler`. It delegates to `DiscussionController` without any awareness of how the next speaker is chosen.
- **`DiscussionController`'s round-robin** is replaced by `NextSpeakerSelector` in future milestones. The interface (`executeDiscussion({ discussionId }) → Message[]`) stays stable — only the internal implementation changes.
- **Expert turns via `RoundController`** are unchanged — the same controller serves both round-robin and self-selected execution.
- **`MessageKind` values** (`"moderator_opening"`, `"moderator_closing"`, `"expert_statement"`) are populated in M16. Future milestones add `"moderator_call"` and populate `replyToMessageId`.

### 10.2 Moderator Intelligence Evolution

M16's `ModeratorStrategy` interface is designed for growth:

```
M16:  ModeratorStrategy
      ├── openDiscussion()
      └── closeDiscussion()

Future:
      ModeratorStrategy (extended)
      ├── openDiscussion()
      ├── closeDiscussion()
      ├── introduceExpert(expertId)
      ├── bridgeTransition()
      └── callOnExpert(expertId, topic)
```

New methods are additive. `AISessionLifecycle` (the thin adapter) would gain additional hook mappings without changing its dependency (still only `ModeratorStrategy`). `DiscussionSessionController` and the `SessionLifecycle` interface remain unchanged.

### 10.3 Turn Scheduler

The current `DiscussionController` iterates all active expert panelists in insertion order. A future `NextSpeakerSelector` can replace `DiscussionController` entirely while maintaining the same interface (`executeDiscussion({ discussionId }) → Message[]`). `DiscussionEngine` delegates to whatever round executor it receives — no engine change needed.

### 10.4 SSE / WebSocket

M16 uses HTTP polling as a **deliberate temporary mechanism**. The polling is isolated in one `useEffect` in `DiscussionRoomPage`. See §8.3 for the explicit migration path. Replacing polling with SSE requires changing one location only. No other component depends on the polling mechanism.

### 10.5 Consensus Analysis

M16 does not implement consensus analysis. The `InsightPanel` currently receives `discussionStatus` and displays a placeholder. When `ConsensusAnalyzer` is implemented:

- It can consume the complete transcript (all messages from `GET /api/discussions/:id/messages`)
- It can run as a post-execution step or as a parallel analysis during execution
- It does not require changes to the execution flow designed in M16

### 10.6 maxRounds Configuration

The `maxRounds` parameter is currently passed by the frontend. In the future, it could be:
- A server-side configuration default
- Derived from expert count (e.g., `expertCount * 2` rounds)
- Controlled by a budget policy (token limit, cost limit)
- Determined dynamically by a "discussion completeness" heuristic

The `maxRounds` parameter in `RunDiscussionRequest` makes no assumption about where the value comes from — it accepts whatever the caller provides.

---

# Explicit Non-Goals

The following are **not** introduced in M16:

- ❌ No `TurnScheduler`, `ReactionEvaluator`, `NextSpeakerSelector` (M13 adversarial concepts)
- ❌ No expert self-selection protocol
- ❌ No `SpeakingRequest` or `ExpertReaction` domain concepts
- ❌ No expert state machine (IDLE → THINKING → READY → SPEAKING → COOLDOWN)
- ❌ No `replyToMessageId` population
- ❌ No per-round moderator bridging or expert calling (only open + close)
- ❌ No SSE / WebSocket (polling only — see §8.3 for migration path)
- ❌ No consensus / disagreement analysis
- ❌ No discussion pause, resume, or cancel
- ❌ No token or cost budgets
- ❌ No `DiscussionEngine` changes — engine must not understand adversarial concepts
- ❌ No `RoundController` changes
- ❌ No `DiscussionSessionController` changes
- ❌ No `SessionLifecycle` interface changes
- ❌ No domain model changes
- ❌ No repository interface changes (except possibly `DiscussionRepository.update()` for status transition)
- ❌ No `PromptBuilder.buildPanelistSystemPrompt()` or `buildPanelistMessages()` changes (new functions only)
- ❌ No existing route modifications
- ❌ No `TemplateSessionLifecycle` changes (remains as fallback/test implementation)
- ❌ No `PanelistGenerator` changes
- ❌ No frontend type changes

# Files to Create

```
backend/src/moderator/ModeratorStrategy.ts          — interface
backend/src/moderator/AIModeratorStrategy.ts        — concrete implementation
backend/src/lifecycle/AISessionLifecycle.ts         — thin adapter
backend/src/tests/moderator-strategy.test.ts        — ModeratorStrategy + AIModeratorStrategy tests
backend/src/tests/ai-session-lifecycle.test.ts      — AISessionLifecycle tests
backend/src/tests/discussion-start.test.ts          — start route integration tests
prompts/16_Discussion_Execution_Flow.md             — this document
```

The `moderator/` directory is new. The `lifecycle/` directory already exists (M13). The `tests/` directory already exists with 15 test files.

### Files to Be Modified (implementation phase)

```
backend/src/ai/PromptBuilder.ts                     — add buildModeratorOpeningPrompt(), buildModeratorClosingPrompt()
backend/src/controllers/DiscussionController.ts      — add p.role !== "host" filter (one condition)
backend/src/routes/discussion.ts                     — add POST /start endpoint (or new route file)
backend/src/app.ts                                   — wire ModeratorStrategy, AISessionLifecycle, DiscussionSessionController
frontend/src/api/discussionApi.ts                    — add startDiscussion()
frontend/src/pages/DiscussionRoomPage.tsx            — add start button, running state, temporary polling
frontend/src/pages/DiscussionRoomPage.module.css     — start button styles, running state styles
```

---

# Verification Checklist (Post-Implementation)

| Check | Description |
|---|---|
| `npx tsc --noEmit` (backend) | 0 TypeScript errors |
| `npx vitest run` (backend) | All existing 308 tests pass + new tests pass |
| `npx tsc --noEmit` (frontend) | 0 TypeScript errors |
| `npm run build` (frontend) | Build succeeds |
| `git diff --check` | No whitespace errors |
| No `DiscussionEngine` modifications | Engine source unchanged |
| No `RoundController` modifications | RoundController source unchanged |
| No `DiscussionSessionController` modifications | Session controller source unchanged |
| No `SessionLifecycle` interface modifications | Interface unchanged (still 2 hooks) |
| No domain model modifications | `domain/*.ts` unchanged |
| No repository interface modifications | Interface files unchanged (except possibly `DiscussionRepository.update()`) |
| No `AIService` interface modifications | AIService unchanged |
| No existing test modifications | Pre-existing test files unchanged |
| `ModeratorStrategy` depends only on abstractions | No concrete dependencies |
| `AISessionLifecycle` has exactly 1 dependency | Only `ModeratorStrategy` |
| `AIModeratorStrategy` depends only on abstractions | `AIService`, `PanelistRepository`, `DiscussionRepository`, `MessageRepository` |

---

# Architecture Review Notes

### Issues Identified in Original Draft

| Issue | Original Design | Revised Design |
|---|---|---|
| **Moderator responsibility conflated with lifecycle** | `AISessionLifecycle` directly owned AI calls, prompt construction, and persistence | Moderator intelligence separated into `ModeratorStrategy`. `AISessionLifecycle` is a thin adapter with 1 dependency |
| **SessionLifecycle could become AI orchestration service** | Future moderator methods would accumulate in `AISessionLifecycle` | `ModeratorStrategy` is independently extensible. `SessionLifecycle` stays as boundary hooks |
| **Transport mechanism not clearly documented as temporary** | Polling described as "v0 simplification" | Explicit `⚠️ TRANSPORT NOTICE` demarcation: M16 temporary polling ↔ Future SSE/WebSocket with migration code |

### Design Properties (Revised)

1. **Layering preserved**: `ModeratorStrategy` is a new interface. `AISessionLifecycle` is a new `SessionLifecycle` implementation. `AIModeratorStrategy` is a new `ModeratorStrategy` implementation. `DiscussionSessionController`, `DiscussionEngine`, and `RoundController` are unchanged. `DiscussionController` has one additional filter condition.

2. **Moderator/lifecycle separation**: `SessionLifecycle` owns boundary timing (WHEN). `ModeratorStrategy` owns moderator intelligence (WHAT). `AIModeratorStrategy` owns AI integration (HOW).

3. **AI/System boundary preserved**: The AI generates moderator and expert content. The system controls persistence, metadata (`panelistId`, `kind`), validation, and status transitions. Same boundary as M15.

4. **Extension, not modification**: New interface, new implementations, new route, new prompt functions, new frontend state. One existing component receives a minimal focused change (`DiscussionController`).

5. **No speculative abstraction**: `ModeratorStrategy` has exactly two methods for M16 (`openDiscussion`, `closeDiscussion`). The interface is narrow and real — not a placeholder for future features.

6. **V0 simplicity with clear upgrade paths**: Round-robin execution, polling for updates, fixed `maxRounds`. Each has a documented future replacement.

7. **Testability**: Every new component depends only on abstractions. `AIModeratorStrategy` is independently testable with `MockAIService`. `AISessionLifecycle` is testable with a stub `ModeratorStrategy`.

---

# Updated Implementation Plan

### Phase 1: Moderator Intelligence (backend core)

1. Create `ModeratorStrategy` interface — `openDiscussion()`, `closeDiscussion()`
2. Add `buildModeratorOpeningPrompt()` and `buildModeratorClosingPrompt()` to `PromptBuilder`
3. Implement `AIModeratorStrategy` — AI-powered moderator with prompt construction + persistence
4. Write `moderator-strategy.test.ts` — ~10 tests

### Phase 2: Lifecycle Adapter

5. Implement `AISessionLifecycle` — thin adapter delegating to `ModeratorStrategy`
6. Write `ai-session-lifecycle.test.ts` — ~4 tests

### Phase 3: Execution Tuning

7. Add host-exclusion filter to `DiscussionController` (one condition)
8. Update affected `discussion-controller.test.ts` fixtures

### Phase 4: API Endpoint

9. Add `POST /api/discussions/:id/start` route (new route file or extension)
10. Wire `ModeratorStrategy` → `AISessionLifecycle` → `DiscussionSessionController` into `createApp()`
11. Write `discussion-start.test.ts` — ~10 integration tests

### Phase 5: Frontend Integration

12. Add `startDiscussion()` to frontend API layer
13. Add start button, running state, temporary polling to `DiscussionRoomPage`
14. Add styles for new UI states

### Phase 6: Verification

15. Run full test suite — all 308 existing + new tests pass
16. TypeScript compilation (backend + frontend)
17. Frontend build
18. Manual smoke test: create discussion → generate panelists → start → observe transcript

---

# Modified File List

### New Files (7)

| File | Type |
|---|---|
| `backend/src/moderator/ModeratorStrategy.ts` | Interface |
| `backend/src/moderator/AIModeratorStrategy.ts` | Implementation |
| `backend/src/lifecycle/AISessionLifecycle.ts` | Implementation |
| `backend/src/tests/moderator-strategy.test.ts` | Tests |
| `backend/src/tests/ai-session-lifecycle.test.ts` | Tests |
| `backend/src/tests/discussion-start.test.ts` | Tests |
| `prompts/16_Discussion_Execution_Flow.md` | Documentation |

### Modified Files (7)

| File | Change | Impact |
|---|---|---|
| `backend/src/ai/PromptBuilder.ts` | Add 2 new functions | Additive — existing functions unchanged |
| `backend/src/controllers/DiscussionController.ts` | Add 1 filter condition | One line — `p.role !== "host"` |
| `backend/src/routes/discussion.ts` | Add POST /start | Additive — existing routes unchanged |
| `backend/src/app.ts` | Wire new dependencies | Extended `AppDependencies`, new instantiations |
| `frontend/src/api/discussionApi.ts` | Add `startDiscussion()` | Additive |
| `frontend/src/pages/DiscussionRoomPage.tsx` | Add states + polling | ~60 lines added |
| `frontend/src/pages/DiscussionRoomPage.module.css` | Add styles | ~20 lines added |

### Unchanged (all other files)

Zero modifications to: `DiscussionEngine`, `RoundController`, `DiscussionSessionController`, `SessionLifecycle`, `TemplateSessionLifecycle`, all domain models, all repository interfaces, `AIService`, `MockAIService`, `DeepSeekAIService`, `PanelistGenerator`, `createAIService`, panelist routes, message routes, frontend types.

---

# Dependency Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HTTP LAYER                                    │
│                                                                      │
│  POST /api/discussions/:id/start                                     │
│       │                                                              │
│       ├── DiscussionRepository (validate exists, not finished)      │
│       ├── PanelistRepository (validate has host + experts)          │
│       └── DiscussionSessionController.runSession()                   │
│                                                                      │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SESSION LIFECYCLE LAYER                           │
│                                                                      │
│  DiscussionSessionController  ← UNCHANGED                            │
│       │                                                              │
│       ├── SessionLifecycle (interface, UNCHANGED)                    │
│       │       └── AISessionLifecycle  ← NEW (thin adapter)           │
│       │               │                                              │
│       │               └── ModeratorStrategy (interface, NEW)         │
│       │                       └── AIModeratorStrategy  ← NEW         │
│       │                               │                              │
│       │                               ├── DiscussionRepository       │
│       │                               ├── PanelistRepository         │
│       │                               ├── PromptBuilder (extended)   │
│       │                               ├── AIService                  │
│       │                               └── MessageRepository          │
│       │                                                              │
│       └── DiscussionEngine  ← UNCHANGED                              │
│               │                                                      │
│               ├── DiscussionRepository                               │
│               ├── PanelistRepository                                 │
│               └── DiscussionController  ← MINIMAL CHANGE             │
│                       │                   (host-exclusion filter)    │
│                       └── RoundController  ← UNCHANGED               │
│                               │                                      │
│                               ├── DiscussionRepository               │
│                               ├── PanelistRepository                 │
│                               ├── MessageRepository                  │
│                               ├── PromptBuilder                      │
│                               └── AIService                          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       DATA LAYER                                     │
│                                                                      │
│  DiscussionRepository  │  PanelistRepository  │  MessageRepository   │
│  (all UNCHANGED)                                                │
└─────────────────────────────────────────────────────────────────────┘

Key:
  ← UNCHANGED   = zero modifications to existing code
  ← NEW         = new file created
  ← MINIMAL     = minimal focused change (one condition)
  ← extended    = new functions added, existing functions untouched
```

---

# Test Plan

### Test File 1: `moderator-strategy.test.ts` (~10 tests)

**Suite: ModeratorStrategy interface**
- Interface defines `openDiscussion(discussionId: string): Promise<Message>`
- Interface defines `closeDiscussion(discussionId: string): Promise<Message>`

**Suite: AIModeratorStrategy.openDiscussion()**
- Returns a Message with `kind: "moderator_opening"` and correct `panelistId` (host)
- Message content is non-empty
- Persists message to MessageRepository
- Throws when no host panelist exists in the discussion
- Prompt includes discussion topic and expert names (verified via MockAIService request inspection)

**Suite: AIModeratorStrategy.closeDiscussion()**
- Returns a Message with `kind: "moderator_closing"` and correct `panelistId`
- Message content is non-empty
- Persists message to MessageRepository
- Throws when no host panelist exists

**Suite: AIModeratorStrategy dependencies**
- Works with MockAIService — no real API calls
- Error from AIService propagates correctly
- Error from PanelistRepository propagates correctly

### Test File 2: `ai-session-lifecycle.test.ts` (~4 tests)

**Suite: AISessionLifecycle**
- `onSessionStart` delegates to `moderator.openDiscussion()` and wraps in array
- `onSessionEnd` delegates to `moderator.closeDiscussion()` and wraps in array
- Error from ModeratorStrategy propagates unchanged through `onSessionStart`
- Error from ModeratorStrategy propagates unchanged through `onSessionEnd`

### Test File 3: `discussion-start.test.ts` (~10 tests)

**Suite: POST /api/discussions/:id/start — validation**
- Returns 400 when `maxRounds` is missing
- Returns 400 when `maxRounds` is not a positive integer
- Returns 404 when discussion does not exist
- Returns 409 when discussion is already finished
- Returns 422 when discussion has no panelists
- Returns 422 when discussion has no host

**Suite: POST /api/discussions/:id/start — success**
- Returns 200 with all messages on success (opening + rounds + closing)
- Messages are in chronological order (opening first, closing last)
- Expert messages have `kind: "expert_statement"` and correct `panelistId`
- Discussion status transitions to `"finished"` after successful execution

### Test File 4: `discussion-controller.test.ts` (updates to existing)

- Update fixtures: host panelists excluded from expected round output
- New test: host panelist is excluded from round execution
- New test: expert panelists still included in round execution
- All existing non-host tests continue to pass

### Total Test Impact

| Category | Count |
|---|---|
| New tests | ~24 |
| Updated test fixtures | ~3 (DiscussionController tests) |
| Pre-existing tests unchanged | All 308 |

