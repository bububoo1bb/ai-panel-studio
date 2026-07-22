# Milestone 13 Design Proposal

## Adversarial Discussion Protocol — Backend Impact Analysis

**Revision 3** — adds three final consistency clarifications: initial-speaker bootstrap, turn-local SpeakingRequests, and ModeratorStrategy ownership.

---

## Product Interpretation

The clarified product is an **ordered but adversarial AI round-table** — not a collection of independent AI experts answering the same topic in sequence. The core change in semantics is:

- **From**: "Every active panelist speaks once per round, each responding to the full conversation history as a general topic prompt."
- **To**: "One selected expert responds to one specific statement (or moderator call), other experts inspect that response, form structured reactions, and a scheduler selects the next speaker."

The discussion is driven by **targeted adversarial exchange**: experts attack assumptions, challenge evidence, rebut claims, defend positions, supplement arguments — all directed at identifiable preceding statements, not at the abstract topic.

The moderator is an **announcer and bridge**, not the primary argument producer. The scheduler decides **who speaks next**; the moderator decides **how to hand over**.

Unresolved disagreement is preserved, not papered over. Consensus and disagreement emerge continuously from the discussion rather than being manufactured at the end.

---

## Current Backend Semantics

### A Single Panelist Turn

`RoundController.executeTurn({ discussionId, panelistId })` executes exactly one panelist turn:

1. Loads and validates the discussion (must exist).
2. Loads and validates the panelist (must exist, must belong to the discussion, must not be `finished`).
3. Loads all existing discussion messages in insertion order via `MessageRepository.findByDiscussionId()`.
4. Calls `PromptBuilder.buildPanelistMessages({ discussion, panelist, messages })` which constructs:
   - A system message identifying the panelist by name, occupation, title, stance, and role.
   - A user message presenting the discussion topic.
   - All prior messages mapped by `MessageRole` (`"user"` → `"user"`, `"assistant"` → `"assistant"`) in insertion order.
5. Calls `AIService.generate({ messages: aiMessages })`.
6. Persists `response.content` as a new `Message` with `role: "assistant"`.
7. Returns the created `Message`.

**Key observation**: The panelist is prompted with the full flat conversation history. There is no concept of "you are responding to message X." Every prior message looks the same — no speaker identity, no reply chain, no target.

### A Single Discussion Round

`DiscussionController.executeDiscussion({ discussionId })`:

1. Loads all panelists for the discussion in insertion order via `PanelistRepository.findByDiscussionId()`.
2. Filters to panelists with `status !== "finished"`.
3. For each active panelist (sequentially, `for...of` with `await`), calls `RoundController.executeTurn()`.
4. Returns all created `Message`s in execution order.

**Key observation**: This is **fixed round-robin**. Every active panelist speaks exactly once per round, in insertion order. There is no selection, no scheduling, no skipping.

### Multiple Rounds

`DiscussionEngine.runDiscussion({ discussionId, maxRounds })`:

1. Validates `maxRounds` (must be a positive finite integer).
2. Loops up to `maxRounds` times, sequentially:
   - Reloads discussion before each round → stops if `status === "finished"` or `null`.
   - Reloads panelists before each round → stops if zero active (none with `status !== "finished"`).
   - Calls `DiscussionController.executeDiscussion()` for one complete round.
   - Appends returned messages to accumulator.
3. Returns all accumulated messages.

### Session Start and End

`DiscussionSessionController.runSession({ discussionId, maxRounds })`:

1. Validates `maxRounds`.
2. Loads discussion → returns `[]` if `status === "finished"`, throws if `null`.
3. Calls `lifecycle.onSessionStart({ discussionId })` → persists opening message(s).
4. Delegates to `engine.runDiscussion(request)`.
5. Calls `lifecycle.onSessionEnd({ discussionId })` → persists closing message(s) (only on normal completion).
6. Returns `[...startMessages, ...engineMessages, ...endMessages]`.

### Message Creation and Persistence

Messages are created via `MessageRepository.create({ discussionId, role, content })`:
- `role` is `"user" | "assistant"` — no system/moderator/expert distinction.
- No `speakerId` or `panelistId` field.
- No `replyToMessageId` field.
- No `kind` field to distinguish moderator speech, expert speech, system notifications, or summary messages.
- Generated UUID v4 `id`, ISO 8601 `createdAt`.

### Panelist Ordering

Panelists are returned in insertion order by `PanelistRepository.findByDiscussionId()`. `DiscussionController` follows this order exactly — it does not sort, shuffle, prioritize, or select.

### Stop Conditions

1. `maxRounds` reached (safety boundary).
2. Discussion `status === "finished"` (explicit lifecycle termination).
3. Zero active panelists (all have `status === "finished"`).
4. Any dependency error (propagates, stops execution immediately).

### Where Round-Robin Is Assumed

| File | Line(s) | Round-robin behavior |
|---|---|---|
| `DiscussionController.ts` | 47-62 | `for (const panelist of activePanelists)` — iterates ALL active panelists, exactly one turn each per round |
| `DiscussionEngine.ts` | 86-111 | Each "round" calls `DiscussionController.executeDiscussion()` which iterates all panelists |
| `PromptBuilder.ts` | 42-72 | `buildPanelistMessages()` includes all prior messages as a flat list — no differentiation of who said what, no reply targeting |
| `RoundController.ts` | 52-102 | `executeTurn()` generates a response against the full conversation history — no concept of "responding to a specific message" |

---

## Existing Contracts

Complete inventory of every public contract in the current backend:

### Domain Models

```ts
// Discussion
type DiscussionStatus = "active" | "finished";
interface Discussion { id, title, status, createdAt }
interface CreateDiscussionInput { title }

// Message
type MessageRole = "user" | "assistant";
interface Message { id, discussionId, role, content, createdAt }
interface CreateMessageInput { discussionId, role, content }

// Panelist
type PanelistRole = "host" | "expert";
type PanelistStatus = "waiting" | "preparing" | "speaking" | "finished";
interface Panelist { id, discussionId, role, name, occupation, title, stance, color, status, currentFocus: string|null, publicSummary: string|null, createdAt }
interface CreatePanelistInput { discussionId, role, name, occupation, title, stance, color }
```

### Repository Interfaces

```ts
interface DiscussionRepository {
  create(input: CreateDiscussionInput): Promise<Discussion>;
  findAll(): Promise<Discussion[]>;
  findById(id: string): Promise<Discussion | null>;
}

interface MessageRepository {
  create(input: CreateMessageInput): Promise<Message>;
  findByDiscussionId(discussionId: string): Promise<Message[]>;
}

interface PanelistRepository {
  create(input: CreatePanelistInput): Promise<Panelist>;
  findById(id: string): Promise<Panelist | null>;
  findByDiscussionId(discussionId: string): Promise<Panelist[]>;
}
```

### AI Layer

```ts
// types.ts
type AIMessageRole = "system" | "user" | "assistant";
interface AIMessage { role: AIMessageRole; content: string }
interface GenerateAIRequest { messages: AIMessage[]; temperature?: number; maxTokens?: number }
interface GenerateAIResponse { content: string; model: string; usage?: { promptTokens?, completionTokens?, totalTokens? } }

// AIService
interface AIService { generate(request: GenerateAIRequest): Promise<GenerateAIResponse> }

// PromptBuilder
function buildPanelistSystemPrompt(panelist: Panelist): string
function buildPanelistMessages(input: { discussion: Discussion; panelist: Panelist; messages: Message[] }): AIMessage[]
```

### Controllers and Services

```ts
class RoundController {
  constructor(deps: { discussionRepository, messageRepository, panelistRepository, aiService })
  executeTurn(input: { discussionId, panelistId }): Promise<Message>
}

class DiscussionController {
  constructor(deps: { roundController, panelistRepository })
  executeDiscussion(input: { discussionId }): Promise<Message[]>
}

class DiscussionEngine {
  constructor(deps: { discussionController, discussionRepository, panelistRepository })
  runDiscussion(request: { discussionId, maxRounds }): Promise<Message[]>
}

class DiscussionSessionController {
  constructor(deps: { discussionEngine, discussionRepository, lifecycle })
  runSession(request: { discussionId, maxRounds }): Promise<Message[]>
}

interface SessionLifecycle {
  onSessionStart(context: { discussionId }): Promise<Message[]>
  onSessionEnd(context: { discussionId }): Promise<Message[]>
}

class TemplateSessionLifecycle implements SessionLifecycle {
  constructor(deps: { messageRepository })
  // deterministic fixed-template messages
}
```

### HTTP Layer

```ts
function createApp(dependencies?: Partial<AppDependencies>): Express.Application
interface AppDependencies { discussionRepository, messageRepository, panelistRepository, aiService }
// Routes: /api/discussions, /api/discussions/:id/messages, /api/discussions/:id/panelists
function createDiscussionRouter(repository): Router
function createMessageRouter(messageRepository, discussionRepository): Router
function createPanelistRouter(panelistRepository, discussionRepository): Router
```

### Configuration

```ts
type AIProvider = "mock" | "deepseek";
interface AIConfig { provider: AIProvider; deepseek?: DeepSeekConfig }
interface AppConfig { ai: AIConfig }
function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig
function createAIService(config: AIConfig): AIService
```

### Test Statistics

- **266 tests** across **14 test files**, all passing.
- Coverage spans domain models, repositories, AI layer, controllers, engine, session lifecycle, and HTTP routes.
- All controller/engine tests use lightweight test doubles — no Express `listen()`, no real AI calls.

---

## Stable Components

Based on thorough inspection, the following components require **no changes** for the adversarial protocol migration:

### Completely Stable (No Changes)

| Component | Reason |
|---|---|
| `AIService` interface | Provider-independent abstraction. The adversarial protocol uses the same `generate()` method. |
| `MockAIService` | Deterministic test double. Unaffected by protocol changes. |
| `DeepSeekAIService` | Provider implementation. Unaffected — only the prompts it receives change. |
| `createAIService` | Factory function. No new providers needed. |
| `AppConfig` / `loadAppConfig` | Configuration loading. No new config keys needed for MVP. |
| `Discussion` domain model | `id`, `title`, `status`, `createdAt` — all still correct. `DiscussionStatus` ("active" \| "finished") remains adequate. |
| `DiscussionRepository` | `create`, `findAll`, `findById` — all still sufficient. |
| `InMemoryDiscussionRepository` | Stable implementation. No new methods needed. |
| `InMemoryMessageRepository` | Implementation stable (see Message domain changes below for interface considerations). |
| `InMemoryPanelistRepository` | Implementation stable. |
| `PanelistRepository` | `create`, `findById`, `findByDiscussionId` — sufficient for current MVP. **Note**: The interface has no `update` or `updateStatus` method — panelist status set at creation time cannot be mutated through the repository. Runtime state transitions for the adversarial protocol will be ephemeral until a future milestone adds controlled status-update methods. |
| `routes/*` (discussion, message, panelist) | HTTP layer unchanged for MVP. Adversarial behavior is an orchestration concern, not a route concern. |
| `app.ts` | Dependency injection unchanged. New controllers/services wire in similarly. |
| `index.ts` | Composition root unchanged. |
| `vitest.config.ts` | Test configuration unchanged. |
| `package.json` | No new dependencies needed. |

### Mostly Stable (Minor/No Changes)

| Component | Assessment |
|---|---|
| `Panelist` domain model | `PanelistStatus` has `waiting\|preparing\|speaking\|finished`. These map well to the needed states. May need minor additions later (`observing`, `raising_hand`) but no change required for the immediate milestone. |
| `Panelist` domain model — `currentFocus`, `publicSummary` | Already exist and can carry the expert's public "what I'm looking at" and "what I'm thinking." Stable. |
| `SessionLifecycle` interface | `onSessionStart` and `onSessionEnd` remain correct. Will be extended or replaced by `ModeratorStrategy` in a later phase. Stable interface for now. |
| `TemplateSessionLifecycle` | Will eventually be replaced by AI moderator lifecycle. No change needed for the immediate milestone. Stable until Phase 4/5. |

### Requires Changes

| Component | Nature of Change |
|---|---|
| `Message` domain model | Add `panelistId`, `replyToMessageId`, and `kind` (MessageKind) — three new nullable fields |
| `CreateMessageInput` | Add corresponding optional fields |
| `InMemoryMessageRepository` | Update `create()` to handle new fields |
| `RoundController` | Must distinguish moderator turns from expert turns; must accept reply context (Phase 5) |
| `DiscussionController` | Complete replacement of round-robin iteration with turn-driven scheduling (Phase 5) |
| `DiscussionEngine` | Replacement of round-based loop with turn-based loop (Phase 5) |
| `DiscussionSessionController` | Updated orchestration flow (Phase 5) |
| `PromptBuilder` | Split or extended to support moderator prompts and targeted expert prompts (Phase 4–5) |

---

## Blocking Limitations

The following are the **exact confirmed limitations** that prevent the adversarial protocol. Each is verified against the repository source.

### 1. Message Does Not Identify Its Speaker

**Evidence**: `Message` has `role: "user" | "assistant"` only (`message.ts:2,9-10`). `RoundController` persists all AI-generated messages with `role: "assistant"` (`RoundController.ts:94-98`). The transcript cannot distinguish whether a message came from the moderator or from Expert #3.

**Impact**: The adversarial protocol requires knowing who said what — to display speaker identity, to target replies, and to build context-aware prompts.

### 2. Message Has No Reply-To Relationship

**Evidence**: `Message` has no `replyToMessageId` field (`message.ts:6-16`). `PromptBuilder.buildPanelistMessages()` passes all prior messages as a flat chronological list (`PromptBuilder.ts:63-69`). There is no way to tell an expert "respond to message X."

**Impact**: The adversarial protocol requires experts to respond to specific statements. Without reply relationships, the expert prompt cannot prioritize the target statement.

### 3. Message Cannot Distinguish Message Kinds

**Evidence**: `MessageRole` is `"user" | "assistant"` (`message.ts:2`). There is no `kind` or `purpose` field. `TemplateSessionLifecycle` creates session-boundary messages with `role: "assistant"` (`TemplateSessionLifecycle.ts:29,41`), noting in comments that the domain "does not differentiate system / lifecycle messages from assistant messages" (`TemplateSessionLifecycle.ts:9-11`). A moderator opening, a moderator bridge, a moderator closing, an expert rebuttal, a system notification, and a future consensus summary are all indistinguishable without relying on external lookups against `panelistId` → `Panelist.role`.

**Impact**: The product requires the UI to render moderator speech, expert speech, system notifications, and summary messages differently. Deriving this from `panelistId` lookups alone is insufficient because:
- A moderator's opening, bridge, and closing all share the same `panelistId` but have different conversational functions.
- System notifications have no `panelistId` at all — they are not spoken by any panelist.
- Future summary messages (consensus/disagreement) are not spoken by any panelist either.
- Relying on content heuristics or panelist-role inference is fragile and couples UI rendering to data lookups that should be unnecessary.

### 4. Fixed Panelist Iteration (Round-Robin)

**Evidence**: `DiscussionController.executeDiscussion()` iterates ALL active panelists via `for (const panelist of activePanelists)` (`DiscussionController.ts:56-61`). Every active panelist speaks exactly once per round. There is no selection logic, no skipping, no scheduling.

**Impact**: The adversarial protocol requires only one expert to speak at a time, selected by a scheduler based on relevance, urgency, and diversity — not all experts in fixed order.

### 5. No Structured Expert Reactions

**Evidence**: There is no reaction concept anywhere in the codebase. `RoundController.executeTurn()` generates a response directly from the conversation history with no intermediate inspection step.

**Impact**: The adversarial protocol requires experts to inspect statements, identify weaknesses, and form structured reaction intents. Without this, there is no basis for scheduling.

### 6. No Speaking Requests

**Evidence**: No request-to-speak concept exists. Panelists don't "raise hand." `DiscussionController` simply iterates all active panelists. There is no queue, no priority, no selection, no expiration.

**Impact**: The adversarial protocol requires multiple experts to potentially want to respond to the same statement, with explicit decisions about whether to enter the discussion, and with the understanding that a request to speak may become stale if the discussion moves on.

### 7. No Next-Speaker Selection

**Evidence**: No scheduler component exists. Speaker order is fixed by insertion order through `PanelistRepository.findByDiscussionId()`.

**Impact**: The adversarial protocol requires a scheduling decision after each public statement: who speaks next?

### 8. No Moderator-to-Expert Call Context

**Evidence**: `TemplateSessionLifecycle` produces fixed Chinese text for session start/end (`TemplateSessionLifecycle.ts:30,41`). There is no moderator calling on a specific expert or bridging between statements.

**Impact**: The adversarial protocol requires the moderator to say "Expert Zhang, you've been challenged on your carbon pricing assumptions — what's your response?"

### 9. No Explicit Attack/Defense/Supplement/Clarification Intent

**Evidence**: `Message` has no purpose/intent field. `PromptBuilder` instructs the model to "Engage directly with the discussion topic and prior messages" (`PromptBuilder.ts:22`) — this tends toward general commentary, not targeted adversarial exchange.

**Impact**: Without intent metadata, the scheduler can't prioritize rebuttals over supplements, and the UI can't show the nature of each response.

### 10. PromptBuilder Treats Expert Generation as General Topic Response

**Evidence**: `buildPanelistMessages()` constructs a generic prompt: system identity + discussion topic + all prior messages (`PromptBuilder.ts:42-72`). There is no instruction to attack assumptions, identify weaknesses, defend positions, or respond to specific claims.

**Impact**: Experts respond as knowledgeable commentators rather than adversarial debaters.

### 11. Insufficient Panelist States for Turn-Driven Protocol

**Evidence**: `PanelistStatus` is `"waiting" | "preparing" | "speaking" | "finished"` (`panelist.ts:5-9`). There is no `observing` state and no `raising_hand` state.

**Impact**: The UI cannot show "Expert A is observing" or "Expert C wants to speak." The status model is round-oriented, not turn-and-reaction-oriented.

---

## Domain Model Options

### Message Attribution and Reply Relationships

#### Proposed: Add `panelistId` to Message

**Recommendation**: `panelistId: string | null`

- Uses the existing `Panelist.id` domain concept.
- `null` for system/lifecycle messages that have no panelist author (current `TemplateSessionLifecycle` messages, future system notifications).
- A moderator is just a `Panelist` with `role: "host"` — no special moderator ID type needed.
- Optional in `CreateMessageInput` (defaulting to `null`).

#### Proposed: Add `replyToMessageId` to Message

**Recommendation**: `replyToMessageId: string | null`

- References another `Message.id` that this message directly responds to.
- `null` for messages that are not replies (opening statements, moderator bridges, lifecycle messages, system notifications).
- Optional in `CreateMessageInput` (defaulting to `null`).

### Message Kind — Re-evaluated

**Revised recommendation**: Add a `kind` field to `Message`.

**Rationale** (revised after architectural review):

The original proposal recommended against `MessageKind`, arguing that `panelistId` + `Panelist.role` was sufficient. This is insufficient for the following concrete reasons:

1. **Moderator message subtypes are indistinguishable by identity alone**: A moderator opening ("Welcome, today we discuss..."), a moderator bridge ("Expert Zhang, you've been challenged on..."), and a moderator closing ("Thank you all for this discussion...") all have the same `panelistId`. Without a `kind` field, the UI must either:
   - Parse message content to guess the kind (fragile).
   - Track conversational state externally (adds coupling between UI and orchestration logic).
   - Treat all moderator messages identically (poor UX).

2. **System notifications have no panelistId at all**: A system notification ("Expert Zhang has left the discussion") has `panelistId: null`. But so does a legacy message from before `panelistId` was added. Without `kind`, these are indistinguishable. The `kind` field provides positive identification: `kind: "system_notification"` is explicit, not inferred from the absence of a speaker.

3. **Summary messages are not spoken by any panelist**: Future consensus/disagreement summaries are system-generated content that should appear in the transcript but are not attributed to any panelist. `kind: "summary"` distinguishes them from other `panelistId: null` messages.

4. **One migration, not two**: The `Message` domain type is already being extended in Phase 1 (`panelistId`, `replyToMessageId`). Adding `kind` at the same time avoids a second schema migration in a later milestone. Each field addition to `Message` cascades through test fixtures — doing all three together minimizes fixture churn.

5. **Existing codebase already acknowledges this gap**: `TemplateSessionLifecycle` contains a comment: "the current domain model does not differentiate system / lifecycle messages from assistant messages" (`TemplateSessionLifecycle.ts:9-11`). This is a known deficiency, not a speculative concern.

**Proposed type**:

```ts
/**
 * The conversational function of a message in the transcript.
 *
 * `null` is the default for messages created before this field existed.
 * New code should always set `kind` explicitly.
 */
type MessageKind =
  | "moderator_opening"     // Session-opening remarks by the moderator
  | "moderator_call"        // Moderator bridge / handoff to the next speaker
  | "moderator_closing"     // Session-closing remarks by the moderator
  | "expert_statement"      // An expert's public argument or response
  | "system_notification";  // System event (panelist joined/left, discussion started/ended)
```

**Design notes**:

- `"moderator_opening"`, `"moderator_call"`, and `"moderator_closing"` are separate kinds because they have different UI treatments and different positions in the transcript structure. Collapsing them into a single `"moderator_message"` would push the distinction back to content heuristics.
- `"expert_statement"` covers all expert public speech regardless of adversarial intent (rebuttal, supplement, defense, etc.). The adversarial intent is captured in the private `ExpertReaction` model, not in the public `Message`. The UI can display "Expert Zhang rebuts: ..." by combining the message with the reaction context, without encoding intent in the persistence layer.
- `"system_notification"` covers non-spoken system events. This is intentionally broad for MVP — subtyping ("panelist_joined", "panelist_left", "discussion_started") can be added later if concrete UI behavior requires it.
- `null` is the default. All existing messages (from Milestones 1–12) have `kind: null`. This is semantically correct: we don't know what kind they are because the concept didn't exist when they were created.

**What is NOT included** (deferred to future milestones):

- `"summary"` — for consensus/disagreement summary entries. Add when the consensus analyzer is implemented.
- `"user_message"` — for user chat input. The current `role: "user"` already identifies user messages. If user messages need a `kind`, add it when the user interaction model is clarified.

#### Full Message Contract After Changes

```ts
type MessageRole = "user" | "assistant";

type MessageKind =
  | "moderator_opening"
  | "moderator_call"
  | "moderator_closing"
  | "expert_statement"
  | "system_notification";

interface Message {
  id: string;
  discussionId: string;
  panelistId: string | null;       // NEW — who said this (null for system messages)
  role: MessageRole;
  kind: MessageKind | null;        // NEW — conversational function (null for legacy)
  content: string;
  replyToMessageId: string | null; // NEW — which message this responds to
  createdAt: string;
}

interface CreateMessageInput {
  discussionId: string;
  role: MessageRole;
  content: string;
  panelistId?: string | null;       // NEW — defaults to null; SERVICE-GENERATED
  kind?: MessageKind | null;        // NEW — defaults to null; SERVICE-GENERATED
  replyToMessageId?: string | null; // NEW — defaults to null; SERVICE-GENERATED
}
```

**Three independent dimensions** — each answers a different question:

| Dimension | Field | Question Answered |
|---|---|---|
| Speaker identity | `panelistId` | WHO produced the message? |
| Message kind | `kind` | WHAT function does this record serve in the transcript? |
| Reply relationship | `replyToMessageId` | WHAT prior message does this respond to? |

These dimensions are intentionally independent. A moderator call and an expert statement may both reply to the same message. A system notification has no speaker but has a distinct kind. Keeping them as separate fields avoids conflating orthogonal concerns.

#### HTTP Trust Boundary

**Decision**: `panelistId`, `kind`, and `replyToMessageId` are **service-generated trusted metadata**. The existing `POST /api/discussions/:discussionId/messages` route must NOT accept these fields from client input.

**Rationale**:

1. **Identity forgery risk**: If the POST route accepted `panelistId`, an untrusted client could post:
   ```json
   { "role": "assistant", "panelistId": "<host-id>", "kind": "moderator_call", "content": "..." }
   ```
   This would allow a client to impersonate the moderator or any expert, bypassing the entire AI generation and scheduling system.

2. **Existing route purpose**: The current `POST /messages` route is designed for user-generated content (the `role: "user"` case) and for test setup (seeding messages via the API). It was never designed to accept server-authoritative metadata. Expanding it to accept identity claims would create a trust-boundary vulnerability without any current product requirement.

3. **Principle of least privilege**: The adversarial protocol generates ALL messages server-side — `RoundController` creates expert messages, `ModeratorStrategy` creates moderator messages. No client ever needs to specify who is speaking or what kind of message is being created.

**Phase 1 implementation**:

| Component | Change |
|---|---|
| `Message` domain type | Add three new fields to the interface |
| `CreateMessageInput` | Add three new optional fields (for server-side callers) |
| `InMemoryMessageRepository.create()` | Accept and store new fields from input |
| `GET /api/.../messages` | Response includes new fields (read-only exposure) |
| `POST /api/.../messages` | **UNCHANGED** — does not accept new fields |
| Message route validation | **UNCHANGED** — validates `role` and `content` only |

Server-side code (`RoundController`, `ModeratorStrategy`, `TemplateSessionLifecycle`) calls `MessageRepository.create()` directly with the new fields — never through the POST route. Tests that need messages with new fields use the repository directly, not the HTTP API.

#### Migration Impact

- `InMemoryMessageRepository.create()`: Store three new fields from input, defaulting to `null` (three lines).
- `MessageRepository` interface: No signature change needed (`CreateMessageInput` gains optional fields).
- `RoundController`: Will pass `panelistId` and `kind: "expert_statement"` when creating messages (Phase 5).
- `TemplateSessionLifecycle`: Will pass `kind: "system_notification"` when creating lifecycle messages (future phase).
- Message POST route: **Unchanged** — does not accept or validate new fields.
- Test fixtures: All `Message` literals need `panelistId: null, kind: null, replyToMessageId: null`.
- Tests that seed messages via HTTP POST: Unchanged — seeded messages get `null` defaults for new fields, which is correct (they're legacy/untyped).

---

## Expert Reaction Model

### Design

A **private, structured result** representing one expert's inspection of one public statement.

**Recommended**: Ephemeral application-layer value object — NOT a domain entity, NOT a persisted repository record.

```ts
/** An expert's private structured reaction to a public statement. */
interface ExpertReaction {
  /** Which expert produced this reaction. */
  panelistId: string;
  /** Which public message is being reacted to. */
  targetMessageId: string;
  /** The expert's analytical intent toward the target statement. */
  intent: ReactionIntent;
  /** A short label for what claim, assumption, or evidence is being addressed. */
  targetClaim: string;
  /** What weakness, gap, or opportunity the expert identified. */
  identifiedIssue: string;
  /** How strongly the expert assesses this matters (0–1). */
  urgency: number;
  /** How confident the expert is in their analysis (0–1). */
  confidence: number;
  /** The expert's proposed angle for a public response, if they choose to speak. */
  proposedResponseAngle: string;
}

type ReactionIntent =
  | "no_response"    // Nothing to add — pass
  | "support"        // Agree and strengthen
  | "supplement"     // Add complementary information
  | "challenge"      // Attack a claim, assumption, or evidence
  | "rebut"          // Directly counter the statement
  | "clarify"        // Ask for or provide clarification
  | "defend";        // Defend own earlier position being attacked
```

### Why Ephemeral (Not Persisted)

- **MVP scope**: Reactions are intermediate computation consumed immediately by the scheduler.
- **No audit trail needed**: The public transcript is the record. Private reactions are disposable.
- **Privacy guarantee**: Not persisting reactions means they can never leak.
- **Simpler testing**: Reaction evaluation is testable as a pure function.

### Fields Rationale

| Field | Why Needed |
|---|---|
| `panelistId` | Identifies who is reacting. |
| `targetMessageId` | Identifies what is being reacted to — required for reply chains. |
| `intent` | Internal analysis label — may or may not lead to a speaking request. |
| `targetClaim` | What specifically is being addressed. |
| `identifiedIssue` | The weakness, gap, or opportunity found. |
| `urgency` | How much this matters — feeds into speaking-request decisions. |
| `confidence` | How sure the expert is — feeds into speaking-request decisions. |
| `proposedResponseAngle` | What the expert would say if selected. Used by the scheduler for deduplication and by the prompt builder for coherence. |

### What Is NOT Included

- **Full chain-of-thought**: Never stored, never persisted.
- **Token usage**: Not relevant at the orchestration layer.
- **Raw AI response**: Parsed into the structured reaction and discarded.

---

## Speaking Request

### Separate Concept from ExpertReaction (Revised)

**An `ExpertReaction` is not a `SpeakingRequest`.** They are distinct concepts with different lifecycles.

#### ExpertReaction (Private Analysis)

- **What it is**: An expert's internal structured analysis of one public statement.
- **Lifecycle**: Created during reaction evaluation, consumed by the expert's internal decision process, then discarded.
- **Persistence**: Ephemeral — never persisted.
- **Multiplicity**: An expert may produce reactions to many statements. Some may be analyses of statements they never intend to respond to.
- **Contains**: Analytical conclusions — intent, target claim, identified weakness, urgency, confidence, proposed angle.

#### SpeakingRequest (Explicit Decision to Speak)

- **What it is**: An explicit decision by an expert that they wish to enter the discussion NOW, in response to the most recent public statement.
- **Lifecycle (MVP — turn-local)**: Created fresh after each public expert statement → one request is selected → **all requests are discarded**. There is no cross-turn request store, no carry-over, no explicit expiration mechanism. Staleness is avoided by recalculating all requests against the newest public statement each turn — an expert who wanted to respond to statement X but was not selected will naturally produce a different (or no) request against the new statement Y.
- **Persistence**: Ephemeral — never persisted. Requests live only for the duration of one scheduling decision.
- **Multiplicity**: Each eligible expert produces at most one `SpeakingRequest` per turn (from their `ExpertReaction`). An expert with `intent: "no_response"` produces no request.
- **Contains**: Action decision — which statement to respond to, pre-computed priority, a summary of what they plan to say.

#### Relationship Between the Two

```
ExpertReaction (analysis) ──may lead to──→ SpeakingRequest (decision)
                                              │
                                              │  (one selected; then ALL discarded)
                                              ↓
                                         NextTurnSelection
```

- An expert may produce an `ExpertReaction` but decide not to speak (`intent: "no_response"` → no `SpeakingRequest`).
- After the `TurnScheduler` selects one `SpeakingRequest` and the `NextSpeakerSelector` builds the `NextTurnSelection`, all `SpeakingRequest`s and `ExpertReaction`s from that turn are discarded.
- The next turn starts fresh: a new public statement is made, all experts produce new `ExpertReaction`s against it, and new `SpeakingRequest`s may be created.
- There is no cross-turn request store, no carry-over, and no explicit expiration. Each turn is a clean slate.

#### Proposed Types

```ts
/**
 * An expert's explicit decision to enter the discussion.
 *
 * Turn-local: created fresh after each public statement, one is selected,
 * then ALL are discarded.  There is no cross-turn storage.
 *
 * The `priority` is computed during reaction-to-request conversion from
 * the reaction's intent, urgency, and confidence — the TurnScheduler
 * does not need access to the original ExpertReaction.
 */
interface SpeakingRequest {
  /** Which expert wants to speak. */
  panelistId: string;
  /** Which message triggered this desire to speak (always the most recent public statement). */
  targetMessageId: string;
  /** A one-line summary of what the expert plans to say. */
  plannedStatement: string;
  /**
   * Computed priority (0–100).
   *
   * Derived during reaction-to-request conversion:
   *   base = intentWeight(intent)          // defend:40, rebut:35, challenge:30,
   *                                        // clarify:20, supplement:15, support:10
   *        + urgency * 20                  // 0–20
   *        + confidence * 15               // 0–15
   *        + (directMention ? 25 : 0)
   *   priority = clamp(base, 0, 100)
   *
   * The TurnScheduler adds fairness adjustments (consecutive-speaker
   * penalty, domination penalty, stance diversity) on top of this
   * pre-computed priority — it does not need the original reaction.
   */
  priority: number;
}
```

#### Why the Separation Matters

1. **Different creation triggers**: `ExpertReaction`s are produced by ALL experts against EVERY public statement. `SpeakingRequest`s are produced only when an expert actively decides to speak.

2. **Different lifecycles**: `ExpertReaction`s are fire-and-forget — created, consumed, discarded. `SpeakingRequest`s are also turn-local — created, one selected, ALL discarded. Neither persists across turns.

3. **Different multiplicities**: One expert can have many reactions (analyzing multiple claims within one statement) but produces at most one `SpeakingRequest` per turn.

4. **The scheduler operates on SpeakingRequests, not ExpertReactions**: The scheduler's job is to select the next speaker from those who have explicitly requested to speak. It should not need to know about reactions where the expert decided NOT to speak.

5. **Turn-local design avoids staleness**: Because all requests are discarded after each turn and recreated against the newest public statement, there is no stale-request problem. An expert who wanted to rebut statement X but wasn't selected will naturally produce a different request (or none) against the new statement Y.

#### Flow

```
1. Expert A speaks (public statement)
      ↓
2. All OTHER experts produce ExpertReactions (private analysis against statement A)
      ↓
3. Each expert decides: do I want to speak?
      ↓ (if yes)
4. Expert creates a SpeakingRequest
      ↓
5. TurnScheduler ranks all SpeakingRequests for this turn
      ↓
6. One request is selected → NextTurnSelection built
      ↓
7. ALL ExpertReactions and SpeakingRequests from this turn are discarded
      ↓
8. Selected expert speaks (new public statement)
      ↓
9. Go to step 2 — all experts react to the NEW statement
```

---

## Turn Scheduler and Next-Speaker Selection

### Component Boundaries (Revised)

The "who speaks next" decision is decomposed into four focused components. A thin facade exposes a single operation to the engine.

| Component | Responsibility | Input | Output |
|---|---|---|---|
| `ReactionEvaluator` | Determine what an expert privately thinks about a statement | Panelist + target Message | `ExpertReaction` |
| `SpeakingRequestDecision` | Decide whether a reaction warrants a speaking request, and compute initial priority | `ExpertReaction` | `SpeakingRequest \| null` |
| `TurnScheduler` | Rank eligible `SpeakingRequest`s and select the best candidate | `SpeakingRequest[]` + fairness context | `SpeakingRequest \| null` |
| `NextSpeakerSelector` | Coordinate the above three steps; expose one method to the engine | `TurnContext` | `NextTurnSelection \| null` |

**The engine depends only on `NextSpeakerSelector`.** It never imports or references `ReactionEvaluator`, `SpeakingRequestDecision`, `TurnScheduler`, `ExpertReaction`, or `SpeakingRequest`.

### NextSpeakerSelector — Application-Layer Facade

```ts
/**
 * Coordinates the full "who speaks next" decision.
 *
 * This is the ONLY component the DiscussionEngine depends on for
 * speaker selection.  All internal analysis (reactions, speaking
 * requests, scoring) is hidden behind this interface.
 */
interface NextSpeakerSelector {
  /**
   * Determine who should speak next after a public statement.
   *
   * Returns a self-contained selection with everything the engine
   * needs to execute the next turn, or null if no one should speak.
   */
  selectNextSpeaker(context: TurnContext): Promise<NextTurnSelection | null>;
}
```

### NextTurnSelection — Minimal Public Result

```ts
/**
 * The result of a successful next-speaker selection.
 *
 * Contains only the information needed to execute the next public turn.
 * The engine receives this object but never sees ExpertReaction or
 * SpeakingRequest instances.
 *
 * This is a plain data object, not a domain entity.  It is ephemeral —
 * created by NextSpeakerSelector and consumed by the engine within the
 * same turn.
 */
interface NextTurnSelection {
  /** Which panelist should speak next. */
  panelistId: string;
  /** Which prior message the selected expert is responding to. */
  targetMessageId: string;
  /**
   * A short brief for the moderator (1–2 sentences).
   *
   * Derived from the selected SpeakingRequest's plannedStatement and
   * the expert's identity.  Used by ModeratorStrategy.generateCall()
   * to construct the bridge message.
   *
   * Example: "Dr. Li Wei believes the carbon pricing assumptions
   * ignore transitional costs for developing economies."
   */
  moderatorBrief: string;
  /**
   * A short brief for the selected expert (1–2 sentences).
   *
   * Derived from the SpeakingRequest's plannedStatement.  Used by
   * RoundController to focus the expert's prompt on the exact
   * response direction they planned.
   *
   * Example: "Challenge the assumption that carbon pricing is
   * equally affordable across all economies — focus on transitional
   * cost disparities."
   */
  expertBrief: string;
}
```

### Data Flow Through the Facade

```
NextSpeakerSelector.selectNextSpeaker(context)
    │
    ├── 1. For each eligible panelist (not last speaker, not finished):
    │       ReactionEvaluator.evaluate(panelist, context.lastMessage)
    │       → ExpertReaction (private, ephemeral)
    │
    ├── 2. For each ExpertReaction:
    │       SpeakingRequestDecision.evaluate(reaction, panelist)
    │       → SpeakingRequest | null
    │       (null when intent is "no_response" or urgency below threshold)
    │
    ├── 3. TurnScheduler.select(requests, fairnessContext)
    │       → SpeakingRequest | null
    │
    ├── 4. If selected:
    │       Build NextTurnSelection from the selected SpeakingRequest
    │       (derive moderatorBrief and expertBrief from plannedStatement
    │        and panelist identity)
    │
    └── 5. Discard ALL ExpertReactions and SpeakingRequests from this turn
           (next turn starts fresh against the new public statement)
```

### TurnScheduler — Focused on Ranking

```ts
/**
 * Ranks eligible SpeakingRequests and selects the best candidate.
 *
 * This component does NOT call ReactionEvaluator, does NOT create
 * SpeakingRequests, and does NOT access ExpertReaction objects.
 * It receives pre-built SpeakingRequests with pre-computed priorities
 * and applies only fairness adjustments.
 */
interface TurnScheduler {
  /**
   * Select the highest-ranked SpeakingRequest.
   *
   * @param requests  Pre-built SpeakingRequests with computed priorities.
   * @param context   Fairness context (recent speaker history, stances).
   * @returns The selected SpeakingRequest, or null if `requests` is empty.
   */
  select(
    requests: SpeakingRequest[],
    context: SchedulingContext
  ): SpeakingRequest | null;
}

interface SchedulingContext {
  discussionId: string;
  /** Panelist IDs in order of recent speaking history (most recent first). */
  recentSpeakerIds: string[];
  /** Stance diversity reference — the last speaker's stance. */
  lastSpeakerStance: string;
  /** All panelists for stance comparison. */
  panelists: Panelist[];
}
```

### TurnScheduler Scoring Algorithm

Each `SpeakingRequest` already carries a pre-computed `priority` (0–100) from the reaction-to-request conversion step. The scheduler applies only **deterministic fairness adjustments** — it does not need the original `ExpertReaction`:

```
score = request.priority

// Fairness adjustments (applied by scheduler):

// 1. Stance diversity bonus (0–15)
//    Reward panelists whose stance differs from the last speaker's
score += stanceDiversityScore(context.lastSpeakerStance, panelist.stance) * 15

// 2. Consecutive-speaker penalty
//    Never allow the same panelist to speak twice in a row
if (context.recentSpeakerIds[0] === request.panelistId):
    score -= 100

// 3. Domination penalty
//    Penalize panelists who have spoken disproportionately
const recentCount = context.recentSpeakerIds
    .filter(id => id === request.panelistId).length
score -= max(0, recentCount - 1) * 10
```

Ties broken by insertion order (deterministic).

**Why priority is pre-computed**: The reaction-to-request conversion (`SpeakingRequestDecision`) has access to the full `ExpertReaction` (intent, urgency, confidence). It computes `priority` once. The `TurnScheduler` then only applies context-sensitive fairness adjustments that depend on the current scheduling state. This keeps the scheduler focused and avoids duplicating reaction-scoring logic.

### What Each Component Does NOT Do

| Component | Does NOT |
|---|---|
| `NextSpeakerSelector` | Call AIService, access repositories, persist anything, generate content |
| `ReactionEvaluator` | Decide who speaks, create SpeakingRequests, access scheduling state |
| `SpeakingRequestDecision` | Call AIService, rank requests, access scheduling state |
| `TurnScheduler` | Call AIService, create reactions, create speaking requests, access ExpertReaction |

---

## Moderator Responsibility

### Conceptual Separation

| Role | Responsibility | Owned By |
|---|---|---|
| **NextSpeakerSelector** | Coordinates "who speaks next" (from turn 2 onward) | `AdversarialDiscussionEngine` |
| **TurnScheduler** | Ranks and selects among speaking requests | Internal to `NextSpeakerSelector` |
| **Moderator** | Decides HOW to hand over the conversation | `AdversarialDiscussionEngine` (via `ModeratorStrategy`) |
| **Expert** | Decides WHAT argument to make | `AdversarialDiscussionEngine` (via `RoundController`) |
| **Domain** | Identifies who said what, what kind of message, and what is being answered | `Message` (with `panelistId`, `kind`, `replyToMessageId`) |

### ModeratorStrategy — Owned by AdversarialDiscussionEngine

`ModeratorStrategy` is a dependency of `AdversarialDiscussionEngine`, not of `DiscussionSessionController`. The engine invokes it for:

- **Opening** (`kind: "moderator_opening"`): Introduce the topic and experts at the start of the discussion.
- **First call** (`kind: "moderator_call"`): Call on the deterministically-selected first expert. This is a distinct method (`generateFirstCall`) because there is no prior expert statement to bridge from — the moderator introduces the first expert based on the discussion topic and the expert's profile.
- **Bridge call** (`kind: "moderator_call"`): Connect the previous expert statement to the next speaker, using `NextTurnSelection.moderatorBrief` for context. The moderator acknowledges the previous point, names the next expert, and poses a focused question.
- **Closing** (`kind: "moderator_closing"`): Summarize and wrap up the discussion.

### SessionLifecycle vs. ModeratorStrategy

These are separate concerns with separate owners:

| Concept | Interface | Purpose | Message Kind | Owner |
|---|---|---|---|---|
| `SessionLifecycle` | `onSessionStart` / `onSessionEnd` | System-level session-boundary markers | `"system_notification"` | `DiscussionSessionController` |
| `ModeratorStrategy` | `generateOpening` / `generateFirstCall` / `generateCall` / `generateClosing` | Visible moderator speech as a discussion participant | `"moderator_opening"` / `"moderator_call"` / `"moderator_closing"` | `AdversarialDiscussionEngine` |

`SessionLifecycle` produces simple system notifications (e.g., "讨论环节已开始"). `ModeratorStrategy` produces rich moderator content (e.g., "Welcome everyone. Today we discuss... Dr. Zhang, let's start with your perspective on...").

**How Phase 5 avoids duplicate opening/closing**: In Phase 5, `TemplateSessionLifecycle` is replaced (or its content reduced to minimal system markers). The engine's `ModeratorStrategy` becomes the sole producer of moderator opening and closing content. `DiscussionSessionController` does not invoke `ModeratorStrategy` — it only wraps the engine call with `SessionLifecycle` boundary notifications. There is exactly one opening (from `ModeratorStrategy`) and one closing (from `ModeratorStrategy`) per discussion session.

### Moderator vs. Scheduler

The scheduler (via `NextSpeakerSelector`) picks the next expert. The moderator then generates a bridging message. The moderator does NOT choose who speaks next. The scheduler does NOT generate content.

### ModeratorPromptBuilder

**Recommendation**: A separate `ModeratorPromptBuilder` is justified because the moderator's prompt structure is fundamentally different from an expert's.

---

## Expert Prompt Semantics

### How Expert Prompt Construction Must Evolve

The public expert response must be constructed from, in priority order:

1. **The moderator's current call or question** — what is the expert being asked?
2. **The specific opposing statement or claim being answered** — identified by `replyToMessageId`.
3. **The expert's stable identity and stance** — from `Panelist`.
4. **The expert's structured private reaction** — `ExpertReaction.targetClaim`, `identifiedIssue`, `proposedResponseAngle`.
5. **Recent relevant conversation context** — last N messages, not the full history.
6. **The original discussion topic** — as background, not the primary prompt.

### Expert Behavioral Instructions

The system prompt must instruct experts to:
- Make a clear and **contestable claim**.
- Identify the **exact claim** being challenged or defended.
- Attack **assumptions, evidence, causality, omitted variables, boundaries, or counterexamples**.
- Defend their own position when **directly challenged**.
- Acknowledge locally valid facts **without abandoning their core stance**.
- Avoid **generic balanced summaries** and **repetition**.
- Remain **professional and evidence-aware**.
- Avoid **personal attacks** and **fabricated evidence**.

---

## Prompt Builder Boundaries

**Recommendation**: Split into three builders:

| Builder | Purpose | Input |
|---|---|---|
| `ExpertPromptBuilder` | Expert adversarial response | Panelist identity, target message, reaction, moderator call, recent context |
| `ModeratorPromptBuilder` | Moderator opening/bridge/closing | Panelists roster, previous/next speaker, reaction context, transcript |
| `ReactionPromptBuilder` | Expert private reaction evaluation | Panelist identity, target message, panelist's own prior statements |

**Rationale**: The moderator's prompt needs, the expert's adversarial response prompt, and the reaction evaluation prompt are three fundamentally different shapes. A single builder with branching would mix three responsibilities.

---

## Execution Model Options

### Option A: Complete-Round Model + Reactions Between Rounds

Preserves the existing round loop. After each complete round, runs reaction evaluation. Poor conceptual fit — retains the round-robin assumption the adversarial protocol rejects.

### Option B: Turn-Driven Model (One Public Speaker at a Time)

Replaces the round loop with a turn loop. Each iteration: one expert speaks → scheduler selects next → moderator bridges → repeat. Directly implements the adversarial protocol.

### Option C: Parallel Engines

Keeps the existing `DiscussionEngine` and adds a separate `AdversarialDiscussionEngine`. Highest maintenance burden with no product justification for two modes.

### Recommended: Option B — Turn-Driven Model

Directly implements the product requirements. The existing components that are stable (AIService, repositories, domain models except Message) are reused without duplication.

---

## Recommended Execution Model

### Execution Flow (Revised — Engine Owns ModeratorStrategy)

```
SESSION START (DiscussionSessionController)
    │
    ├── lifecycle.onSessionStart() → system notification message
    │   (SessionLifecycle, not ModeratorStrategy — see distinction below)
    │
    └── AdversarialDiscussionEngine.run()
        │
        ├── 1. Moderator opening
        │      engine.moderatorStrategy.generateOpening(...)
        │      → Message with kind: "moderator_opening"
        │
        ├── 2. BOOTSTRAP — select first speaker deterministically
        │      Select the first active expert panelist (role === "expert",
        │      status !== "finished") in panelist insertion order.
        │      No reaction evaluation, no speaking requests, no scheduler.
        │      This is a simple deterministic rule, not a scheduling decision.
        │
        ├── 3. Moderator calls the first expert
        │      engine.moderatorStrategy.generateFirstCall(firstExpert, ...)
        │      → Message with kind: "moderator_call"
        │
        ├── 4. First expert speaks
        │      engine.roundController.executeTurn({
        │        panelistId: firstExpert.id,
        │        replyToMessageId: moderatorCallMessage.id
        │      })
        │      → Message with kind: "expert_statement"
        │
        └── 5. TURN LOOP (while turns < maxTurns):
              │
              ├── a. Ask: "Who speaks next?"
              │      selection = await engine.nextSpeakerSelector
              │                        .selectNextSpeaker(context)
              │      → NextTurnSelection | null
              │
              │      [Internal to NextSpeakerSelector — hidden from engine]:
              │      ├── ReactionEvaluator.evaluate() for each eligible panelist
              │      │   → ExpertReaction[] (private, ephemeral)
              │      ├── SpeakingRequestDecision.evaluate() for each reaction
              │      │   → SpeakingRequest[] (with pre-computed priority)
              │      ├── TurnScheduler.select(requests, fairnessContext)
              │      │   → SpeakingRequest | null
              │      └── Build NextTurnSelection from selected request
              │          (or return null if no request selected)
              │          Then: discard ALL ExpertReactions and SpeakingRequests
              │
              ├── b. If selection !== null:
              │      ├── Moderator bridge
              │      │   engine.moderatorStrategy.generateCall(
              │      │     selection.moderatorBrief, ...
              │      │   )
              │      │   → Message with kind: "moderator_call"
              │      │
              │      └── Expert speaks
              │          engine.roundController.executeTurn({
              │            panelistId: selection.panelistId,
              │            replyToMessageId: selection.targetMessageId,
              │            expertBrief: selection.expertBrief
              │          })
              │          → Message with kind: "expert_statement"
              │
              └── c. If selection === null:
                     break (no one wants to speak)

        ├── 6. Moderator closing
        │      engine.moderatorStrategy.generateClosing(...)
        │      → Message with kind: "moderator_closing"
        │
        └── 7. Return all messages

SESSION END (DiscussionSessionController)
    │
    └── lifecycle.onSessionEnd() → system notification message
```

**ModeratorStrategy ownership**: `AdversarialDiscussionEngine` owns and invokes `ModeratorStrategy` for all moderator content (opening, first-call, bridges, closing). `DiscussionSessionController` does NOT invoke `ModeratorStrategy` — it only invokes `SessionLifecycle` for system-level boundary notifications (see distinction below).

**SessionLifecycle vs. ModeratorStrategy distinction**:

| Concept | Purpose | Examples | Owned By |
|---|---|---|---|
| `SessionLifecycle` | System-level session-boundary notifications | "讨论环节已开始" / "讨论环节已结束" | `DiscussionSessionController` |
| `ModeratorStrategy` | Visible moderator speech as a discussion participant | Opening introduction, expert calls, bridges, closing remarks | `AdversarialDiscussionEngine` |

These produce different `MessageKind` values: `SessionLifecycle` produces `"system_notification"` messages. `ModeratorStrategy` produces `"moderator_opening"`, `"moderator_call"`, and `"moderator_closing"` messages. They are invoked by different owners at different points in the session lifecycle.

**How Phase 5 avoids duplicate opening/closing**: `DiscussionSessionController` retains `SessionLifecycle` for system notifications only. The engine's moderator opening and closing replace the current `TemplateSessionLifecycle`'s placeholder content — they are the actual moderator speech, not lifecycle markers. In Phase 5, `TemplateSessionLifecycle` is replaced by an implementation that produces simple `"system_notification"` boundary markers (or is removed if boundary markers are not needed), while `ModeratorStrategy` produces the rich moderator content.

**Bootstrap rationale**: The normal `NextSpeakerSelector` flow requires a `lastMessage` and `lastSpeaker` — it cannot select the first speaker. The deterministic bootstrap rule (first active expert in insertion order) is simple, testable, and requires no AI calls. After the first expert speaks, the normal reaction→request→schedule cycle takes over.

**Critical invariants**:
- The `AdversarialDiscussionEngine` calls `NextSpeakerSelector.selectNextSpeaker()` for turn-loop scheduling, but uses a hardcoded deterministic rule for the first speaker.
- `ModeratorStrategy` is a dependency of `AdversarialDiscussionEngine`, not `DiscussionSessionController`.
- The `NextTurnSelection` is a plain data object — the engine extracts `panelistId`, `targetMessageId`, `moderatorBrief`, and `expertBrief`.
- `RoundController` receives `replyToMessageId` and `expertBrief` (not a raw `ExpertReaction`).
- All `ExpertReaction`s and `SpeakingRequest`s from a turn are discarded after the scheduling decision — each turn is a clean slate.

### Termination Conditions

The turn loop terminates when:
1. **Max turns reached**: A `maxTurns` safety boundary (replaces `maxRounds`).
2. **Scheduler returns null**: No panelist wants to speak (no active `SpeakingRequest`s).
3. **Discussion already finished**: `discussion.status === "finished"`.
4. **All experts finished**: All panelists have `status === "finished"`.

---

## Responsibility Diagram (Revised — Engine Owns ModeratorStrategy)

```
DiscussionSessionController  (session lifecycle boundary)
    │
    ├── SessionLifecycle
    │   ├── onSessionStart()  → system notification messages (kind: "system_notification")
    │   └── onSessionEnd()    → system notification messages (kind: "system_notification")
    │   SessionLifecycle is NOT ModeratorStrategy — it produces system boundary
    │   markers, not visible moderator speech.
    │
    └── AdversarialDiscussionEngine  (turn-driven orchestration)
        │
        │   Owns: ModeratorStrategy, NextSpeakerSelector, RoundController
        │   Depends ONLY on their public interfaces
        │   Does NOT import: ExpertReaction, SpeakingRequest, ReactionEvaluator,
        │                    SpeakingRequestDecision, TurnScheduler
        │
        ├── ModeratorStrategy  (owned by engine)
        │   ├── generateOpening()      → kind: "moderator_opening"
        │   ├── generateFirstCall()    → kind: "moderator_call" (bootstrap — first expert)
        │   ├── generateCall(brief)    → kind: "moderator_call" (receives NextTurnSelection.moderatorBrief)
        │   └── generateClosing()      → kind: "moderator_closing"
        │
        ├── NextSpeakerSelector  (application-layer facade, owned by engine)
        │   │  selectNextSpeaker(context) → NextTurnSelection | null
        │   │  (not used for the first speaker — bootstrap rule picks first expert)
        │   │
        │   │  Coordinates (internal — hidden from engine):
        │   │
        │   ├── ReactionEvaluator
        │   │   └── evaluate(panelist, targetMessage) → ExpertReaction
        │   │       "What does this expert privately think?"
        │   │
        │   ├── SpeakingRequestDecision
        │   │   └── evaluate(reaction, panelist) → SpeakingRequest | null
        │   │       "Does this reaction warrant a speaking request?"
        │   │       Computes initial priority from reaction intent/urgency/confidence
        │   │
        │   └── TurnScheduler
        │       └── select(requests[], fairnessContext) → SpeakingRequest | null
        │           "Which request should be granted?"
        │           Applies fairness adjustments to pre-computed priorities
        │
        │   After selection: ALL ExpertReactions and SpeakingRequests discarded
        │
        └── RoundController (modified — Phase 5)
            └── executeTurn({
                  discussionId,
                  panelistId,
                  replyToMessageId,    // from NextTurnSelection.targetMessageId
                  expertBrief          // from NextTurnSelection.expertBrief
                })
                → Message (with panelistId, kind: "expert_statement", replyToMessageId)
                    │
                    └── AIService.generate()

Ownership:
- Session boundary:        DiscussionSessionController (owns SessionLifecycle)
- Main loop:               AdversarialDiscussionEngine
- First speaker:           Deterministic bootstrap rule (first active expert in insertion order)
- "Who speaks next?":      NextSpeakerSelector (facade; owned by engine)
- Reaction analysis:       ReactionEvaluator (private; called by NextSpeakerSelector)
- Speaking decisions:      SpeakingRequestDecision (private; converts reactions → requests)
- Request ranking:         TurnScheduler (private; ranks by priority + fairness)
- Selection result:        NextTurnSelection (public data; engine-visible; turn-local)
- Moderator text:          ModeratorStrategy (owned by engine; all moderator content)
- System notifications:    SessionLifecycle (owned by session controller; boundary markers only)
- Expert text:             RoundController (via ExpertPromptBuilder)
- Public messages:         RoundController, ModeratorStrategy (both via MessageRepository)
- Private reactions:       Ephemeral — discarded after each scheduling decision
- Speaking requests:       Ephemeral — discarded after each scheduling decision
- Panelist state:          AdversarialDiscussionEngine (ephemeral runtime state for MVP)
- Termination:             AdversarialDiscussionEngine (checks conditions each turn)
- Final transcript:        DiscussionSessionController (concatenates all messages)
```

---

## Panelist State Semantics

### Existing States

```ts
type PanelistStatus = "waiting" | "preparing" | "speaking" | "finished";
```

### Proposed Mapping for Adversarial Protocol

| State | Meaning | Observable Behavior |
|---|---|---|
| `waiting` | Observing the discussion — not currently active | Expert is idle, watching the current speaker |
| `preparing` | Forming a structured reaction OR a speaking request | AI is being called for reaction evaluation OR the expert is deciding whether to request to speak |
| `speaking` | Delivering a public statement | AI is generating the expert's public response |
| `finished` | No longer participating | Expert has nothing more to contribute |

No new status values are required for MVP. `waiting` covers "observing." The UI can derive "wants to speak" from the existence of an active `SpeakingRequest` for that panelist, not from a status field.

### Status Transitions (Turn-Driven)

```
waiting → preparing   (ReactionEvaluator starts for this panelist)
preparing → waiting   (ReactionEvaluator completes)
waiting → speaking    (TurnScheduler selects this panelist)
speaking → waiting    (Expert finishes speaking)
speaking → finished   (Expert opts out permanently)
waiting → finished    (Expert opts out without speaking)
```

### Persistence

The current `PanelistRepository` contract has only `create()`, `findById()`, and `findByDiscussionId()`. There is no `update` or `updateStatus` method. A panelist's status is set at creation time (defaulting to `"waiting"`) and cannot be mutated through the repository.

**For the MVP**: Panelist execution states (`waiting` ↔ `preparing` ↔ `speaking`) are **ephemeral runtime state**. They are held in memory during a discussion session and are not persisted across restarts. Only the initial `"waiting"` status (set at panelist creation) and a potential terminal `"finished"` status would benefit from persistence.

**Future milestone**: A dedicated milestone (separate from the immediate Message milestone) may extend `PanelistRepository` with a controlled `updateStatus(id, status)` method if persistence of runtime state transitions becomes a product requirement (e.g., for session resume after page refresh). This is explicitly **not** part of Phase 1.

---

## Concurrency and Failure Semantics

### Reaction Evaluation Concurrency

**Recommendation**: `Promise.allSettled` (full concurrency with failure isolation).

- All eligible experts evaluate the SAME target message independently.
- No shared mutable state between evaluations.
- `Promise.allSettled` ensures one failed evaluation does not fail the others.
- Failed evaluations produce a synthetic `ExpertReaction` with `intent: "no_response"` — the expert sits out this turn but can participate in the next.

### Failure Semantics

- **One failed reaction → "no_response"**: The expert passes this turn. The discussion continues.
- **All reactions fail → scheduler returns null**: The discussion naturally terminates.
- **AI service failure during expert speech → error propagates**: The engine should handle this gracefully (the current error-propagation model may need revision in Phase 5).

### Deterministic Testing

The `MockAIService` is synchronous, so `Promise.allSettled` over mock services is deterministic. Tests can verify all experts are called and reactions are parsed correctly.

---

## Termination Semantics

### Proposed Termination Conditions for Turn-Driven Adversarial Discussion

1. **Maximum public turns reached** (`maxTurns`): Integer safety boundary. Replaces `maxRounds`.
2. **Scheduler returns null**: No panelist has an active `SpeakingRequest`.
3. **All experts finished**: Every panelist has `status: "finished"`.
4. **Discussion already finished**: `discussion.status === "finished"`.

### MVP Contract

```ts
interface RunAdversarialDiscussionRequest {
  discussionId: string;
  maxTurns: number;  // replaces maxRounds — positive finite integer
}
```

---

## Migration Strategy

### Phase 1: Message Attribution, Reply Relationships, and Message Kind

**Goal**: Extend `Message` to carry speaker identity, reply relationships, and conversational kind — without changing any orchestration logic or expanding the HTTP write contract.

**Files created**: None (domain change only).

**Files modified**:
- `backend/src/domain/message.ts` — add `panelistId`, `kind`, `replyToMessageId`; define `MessageKind` type
- `backend/src/repositories/InMemoryMessageRepository.ts` — handle new fields in `create()` (all default to `null`)
- 7 test files — fixture updates only (add `panelistId: null, kind: null, replyToMessageId: null` to `Message` literals)

**Files NOT modified**:
- `backend/src/routes/message.ts` — **unchanged** (POST does not accept new fields; GET returns them automatically from the repository)

**Contracts changed**: `Message` and `CreateMessageInput` gain three optional/nullable fields. All default to `null`. The HTTP POST contract is **unchanged** — new fields are service-generated only.

**Compatibility**: All existing 266 tests continue to pass after fixture updates. No orchestration changes.

**Tests required**: Tests that create messages with new fields do so via `MessageRepository.create()` directly (not via HTTP POST). Fixture updates across ~7 test files.

**Explicit non-goals**: No orchestration changes, no scheduler, no reactions, no moderator AI, no HTTP POST expansion.

### Phase 2: Structured Expert Reaction Evaluation

Introduce `ExpertReaction` type and `ReactionEvaluator`. Not wired into the engine yet. Tests verify reaction parsing, concurrent evaluation, and failure isolation.

### Phase 3: Speaking Request Model, TurnScheduler, and NextSpeakerSelector

Introduce:
- `SpeakingRequest` type (with pre-computed `priority`)
- `SpeakingRequestDecision` (converts reactions → speaking requests)
- `TurnScheduler` (ranks requests by priority + fairness)
- `NextSpeakerSelector` facade (coordinates the above; exposes `selectNextSpeaker() → NextTurnSelection | null`)
- `NextTurnSelection` result type (`panelistId`, `targetMessageId`, `moderatorBrief`, `expertBrief`)

The engine will eventually depend only on `NextSpeakerSelector`. Tests verify each component independently and the facade integration.

### Phase 4: Moderator Strategy

Implement `ModeratorStrategy` for opening, bridging/call, and closing. The `generateCall()` method receives `NextTurnSelection.moderatorBrief`. Initially template-based, then AI-powered.

### Phase 5: Adversarial Discussion Engine

Implement the turn-driven `AdversarialDiscussionEngine` wiring together `ModeratorStrategy`, `NextSpeakerSelector`, and modified `RoundController`. The engine:
- Owns `ModeratorStrategy` (opening, first-call, bridge calls, closing).
- Owns `NextSpeakerSelector` (turn-loop scheduling from turn 2 onward).
- Uses a deterministic bootstrap rule for the first speaker (first active expert in insertion order).
- Depends only on `NextSpeakerSelector` for speaker selection — never imports reaction or speaking-request types.
- `RoundController` accepts `replyToMessageId` and `expertBrief` from `NextTurnSelection`.
- `DiscussionSessionController` invokes `SessionLifecycle` for system boundary notifications only — it does NOT invoke `ModeratorStrategy`.
- All `ExpertReaction`s and `SpeakingRequest`s are turn-local — discarded after each scheduling decision.

---

## Recommended Immediate Milestone

**Phase 1: Message Attribution, Reply Relationships, and Message Kind**

This is the smallest safe change that:
- Unlocks all subsequent adversarial behavior.
- Involves minimal code — only the `Message` domain type and `InMemoryMessageRepository`.
- Has zero orchestration impact.
- Is backward-compatible — all new fields are optional with `null` defaults.
- Does NOT expand the HTTP write contract — new fields are service-generated only.
- Can be fully tested in isolation.
- Does all three Message schema changes at once, avoiding multiple fixture cascades.

### Files to Create

None.

### Files to Modify

| File | Change |
|---|---|
| `backend/src/domain/message.ts` | Add `panelistId`, `kind`, `replyToMessageId` to `Message` and `CreateMessageInput`. Define `MessageKind` type. |
| `backend/src/repositories/InMemoryMessageRepository.ts` | Update `create()` to store new fields from input, defaulting to `null`. |
| `backend/src/tests/message.test.ts` | Add tests for new fields (via repository, not POST). Update fixtures. |
| `backend/src/tests/round-controller.test.ts` | Fixture updates only. |
| `backend/src/tests/discussion-controller.test.ts` | Fixture updates only. |
| `backend/src/tests/discussion-engine.test.ts` | Fixture updates only. |
| `backend/src/tests/discussion-session-controller.test.ts` | Fixture updates only. |
| `backend/src/tests/template-session-lifecycle.test.ts` | Fixture updates only. |
| `backend/src/tests/prompt-builder.test.ts` | Fixture updates only. |

**Not modified**: `backend/src/routes/message.ts` — the POST route is unchanged. New fields are read-only via GET and write-only via server-side `MessageRepository.create()`.

### Contracts Changed

```ts
// New type
type MessageKind =
  | "moderator_opening"
  | "moderator_call"
  | "moderator_closing"
  | "expert_statement"
  | "system_notification";

// Before
interface Message {
  id: string;
  discussionId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

// After
interface Message {
  id: string;
  discussionId: string;
  panelistId: string | null;       // NEW — service-generated
  role: MessageRole;
  kind: MessageKind | null;        // NEW — service-generated
  content: string;
  replyToMessageId: string | null;  // NEW — service-generated
  createdAt: string;
}
```

### Compatibility Strategy

- All three new fields are nullable and default to `null`.
- `RoundController` is NOT modified to populate them yet — that happens in Phase 5.
- `TemplateSessionLifecycle` is NOT modified — its messages continue to have `panelistId: null, kind: null, replyToMessageId: null`.
- The HTTP POST route is **not changed** — new fields are not accepted from client input.
- The HTTP GET route automatically returns new fields (they're on the `Message` object from the repository).
- All existing 266 tests continue to pass after fixture updates.

### Tests Required

Tests use `MessageRepository.create()` directly (not HTTP POST) for new-field coverage:

1. `MessageRepository.create()` with `panelistId` — stored and returned.
2. `MessageRepository.create()` with `kind` — stored and returned.
3. `MessageRepository.create()` with `replyToMessageId` — stored and returned.
4. `MessageRepository.create()` without new fields — all three default to `null`.
5. `MessageRepository.create()` with explicit `null` values — stored as `null`.
6. `findByDiscussionId()` returns messages with all three new fields present.
7. `panelistId` does not affect insertion ordering.
8. `replyToMessageId` can reference another message in the same discussion.
9. Cross-discussion isolation: new fields don't leak between discussions.
10. Existing 266 tests pass with updated fixtures.

---

## Proposed Files for the Immediate Milestone

### Modified Files

```
backend/src/domain/message.ts                          (+MessageKind type, +3 fields)
backend/src/repositories/InMemoryMessageRepository.ts    (+3 lines in create())
```

### NOT Modified

```
backend/src/routes/message.ts                           (UNCHANGED — no new POST fields)
```

### Test Files Updated

```
backend/src/tests/message.test.ts                       (~8 new tests via repository + fixture updates)
backend/src/tests/round-controller.test.ts              (fixture updates only — add 3 null fields)
backend/src/tests/discussion-controller.test.ts         (fixture updates only)
backend/src/tests/discussion-engine.test.ts             (fixture updates only)
backend/src/tests/discussion-session-controller.test.ts (fixture updates only)
backend/src/tests/template-session-lifecycle.test.ts    (fixture updates only)
backend/src/tests/prompt-builder.test.ts                (fixture updates only)
```

---

## Proposed Public APIs for the Immediate Milestone

No new endpoints. No change to the POST write contract. The only API change is read-only exposure of new fields:

```
GET /api/discussions/:discussionId/messages
  Response: 200 with Message[] — each Message now includes
    panelistId: string | null,
    kind: MessageKind | null,
    replyToMessageId: string | null
  (new fields are present because they exist on the Message type
   returned from the repository — no route change needed)

POST /api/discussions/:discussionId/messages
  UNCHANGED.
  Accepts: { role: "user" | "assistant", content: string }
  Does NOT accept: panelistId, kind, replyToMessageId
  (these fields are service-generated trusted metadata)
```

**Trust-boundary rationale**: `panelistId`, `kind`, and `replyToMessageId` assert speaker identity, message purpose, and reply relationships. Allowing an untrusted client to set these would enable identity forgery (claiming to speak as the moderator or any expert). These fields are set exclusively by server-side components (`RoundController`, `ModeratorStrategy`, lifecycle implementations) through `MessageRepository.create()`, never through the client-facing HTTP API.

---

## Compatibility With Milestones 1–12

| Milestone | Component | Impact of Phase 1 |
|---|---|---|
| M1–3 | Project scaffold, test foundation | No impact. |
| M4–6 | Discussion, Message, Panelist domains | `Message` gains three nullable fields. `Discussion` and `Panelist` unchanged. |
| M7 | RoundController | No code change. Fixtures in tests updated for new Message shape. |
| M8 | DiscussionController | No code change. Fixtures updated. |
| M9 | AI Service Foundation | No impact. |
| M10 | DeepSeek AI Adapter | No impact. |
| M11 | DiscussionEngine | No code change. Fixtures updated. |
| M12 | Session Lifecycle | No code change. Fixtures updated. `TemplateSessionLifecycle` messages get `panelistId: null, kind: null, replyToMessageId: null`. |

All 266 existing tests remain structurally valid. The only changes are fixture updates — adding three `null` fields to `Message` literals throughout the test files.

---

## Test Plan

### Full Migration Test Plan

**Structural tests** (unit, deterministic):

- Speaker attribution: every `Message` created by `RoundController` or `ModeratorStrategy` has a `panelistId` and a `kind`.
- Message kind correctness: moderator opening → `moderator_opening`, moderator bridge → `moderator_call`, expert speech → `expert_statement`, lifecycle messages → `system_notification`.
- Reply relationships: `replyToMessageId` matches the target message's `id`.
- Reaction intent parsing: AI response correctly parsed into `ExpertReaction` fields.
- No-response reactions: `intent: "no_response"` reactions do not produce `SpeakingRequest`s.
- Concurrent reaction evaluation: all eligible panelists are called (mock verifies call count).
- One failed reaction → `"no_response"` → no `SpeakingRequest`.
- Turn-local lifetime: all reactions and requests are discarded after each scheduling decision.
- Deterministic scheduler ranking: known inputs produce consistent outputs.
- Bootstrap: first active expert in insertion order is selected without reaction evaluation.
- Direct-attack defense priority.
- Consecutive-speaker penalty: same panelist never selected twice in a row.
- Domination penalty: no single expert dominates.
- Termination on max turns.
- Termination on scheduler returning null.
- Termination on all experts finished.
- Chronological transcript ordering.
- Panelist state transitions follow the legal FSM.
- Engine never accesses `ExpertReaction` or `SpeakingRequest` objects (verified by compiler — these types are not imported by the engine module).

**Qualitative tests** (manual, prompt evaluation):

- Expert response addresses the exact target claim.
- Expert maintains stable stance across turns.
- Professional but adversarial tone.
- No premature forced consensus.
- No repetition.

### Immediate Milestone Test Plan (Phase 1)

**New tests** (~8 tests in `message.test.ts` — all use `MessageRepository.create()` directly, not HTTP POST):

1. `MessageRepository.create()` with `panelistId` — stored and returned correctly.
2. `MessageRepository.create()` with `kind: "expert_statement"` — stored and returned correctly.
3. `MessageRepository.create()` with `replyToMessageId` — stored and returned correctly.
4. `MessageRepository.create()` without new fields — all three default to `null`.
5. `MessageRepository.create()` with explicit `null` values — stored as `null`.
6. `findByDiscussionId()` returns messages with all three new fields present.
7. `panelistId` does not affect insertion ordering within `findByDiscussionId()`.
8. `replyToMessageId` can reference another message in the same discussion.

**HTTP POST route tests** (existing, unchanged):

- The POST route continues to reject unknown fields or accept only `role` + `content`. Phase 1 does not add new POST validation tests because the route is not modified.

**Updated tests** (existing tests, fixture changes only):

- All test files that construct `Message` objects directly — add `panelistId: null, kind: null, replyToMessageId: null` to each literal.
- Tests that assert `toEqual` on full message objects — include new fields.
- Tests that seed messages via HTTP POST — no change needed (POST response messages will have `null` defaults for new fields, which is correct).

---

## Risks and Trade-offs

### Risk 1: Fixture Update Cascade

Phase 1 adds three fields to `Message`. Many test files construct `Message` objects directly.

**Mitigation**: The change is mechanical — add three null fields to every `Message` literal. A global search-and-replace across test files covers most cases.

### Risk 2: Premature Field Population

If a developer populates `panelistId` or `kind` before the adversarial engine exists, the data will be inconsistent.

**Mitigation**: Document that these fields are informational until Phase 5. No Phase 1 code populates them.

### Risk 3: `replyToMessageId` Referential Integrity

A `replyToMessageId` could reference a non-existent or deleted message.

**Mitigation**: Messages are append-only and never deleted in MVP. No validation of referential integrity at this stage.

### Risk 4: MessageKind Enum Growth

Adding `MessageKind` now may lead to pressure to add more values before the behavior that needs them exists.

**Mitigation**: The five values proposed directly correspond to concrete, distinct conversational functions that the adversarial protocol requires. "Summary" and other future values are explicitly deferred.

### Risk 5: Dual Engine Maintenance During Migration

The old `DiscussionEngine` and new `AdversarialDiscussionEngine` will coexist during Phase 5.

**Mitigation**: The old engine is preserved as-is during Phase 5 implementation. Once the adversarial engine is stable, the old engine is deprecated. This is a temporary coexistence, not a permanent fork.

### Risk 6: HTTP Trust Boundary

Adding `panelistId`, `kind`, and `replyToMessageId` to the `Message` domain type risks exposing those fields to client write input if the POST route is inadvertently expanded later.

**Mitigation**: The POST route is explicitly NOT modified in Phase 1. The fields are documented as service-generated. A code comment in `message.ts` marks them as "service-generated trusted metadata — not accepted from client input." Future route changes must preserve this constraint.

### Trade-off: ExpertReaction + SpeakingRequest Separation

Two concepts instead of one adds complexity. But the separation is justified by:
- Different creation triggers (analysis vs. decision).
- Different lifecycles (fire-and-forget vs. pending/selected/expired).
- Different multiplicities (many reactions, at most one active request).
- Clear ownership boundaries (ReactionEvaluator owns reactions, SpeakingRequestDecision owns request creation, TurnScheduler owns ranking, NextSpeakerSelector coordinates, Engine owns none of them).

---

## Scope Boundaries

The proposal and the immediate milestone must NOT introduce:

- ✅ No generic conversation-flow engine
- ✅ No state-machine framework
- ✅ No workflow DSL
- ✅ No event bus
- ✅ No plugin architecture
- ✅ No distributed queues
- ✅ No background workers
- ✅ No retries
- ✅ No timeout management
- ✅ No cancellation
- ✅ No pause and resume
- ✅ No token or cost budgets
- ✅ No WebSocket implementation
- ✅ No SSE implementation
- ✅ No frontend changes
- ✅ No SQLite migration
- ✅ No consensus-summary implementation
- ✅ No AI-generated final summary
- ✅ No production wiring
- ✅ No real provider calls in tests
- ✅ No `DiscussionEngine` rewrite in Phase 1
- ✅ No `DiscussionController` changes in Phase 1
- ✅ No `RoundController` behavior changes in Phase 1
- ✅ No `PromptBuilder` changes in Phase 1
- ✅ No `PanelistStatus` changes in Phase 1
- ✅ No `ExpertReaction` or `SpeakingRequest` implementation in Phase 1
- ✅ No `TurnScheduler` or `ReactionEvaluator` implementation in Phase 1
- ✅ No `ModeratorStrategy` implementation in Phase 1

---

## Summary of Architectural Revisions

### Revision 1 (from first review): DiscussionEngine Isolated from Reactions

The `DiscussionEngine` depends only on `NextSpeakerSelector.selectNextSpeaker()` and receives `NextTurnSelection | null`. It never imports reaction or speaking-request types.

### Revision 2 (from first review): MessageKind Added to Message

`Message` now includes `kind: MessageKind | null` to distinguish moderator speech, expert speech, system notifications, and their subtypes — independent of `panelistId` and `replyToMessageId`.

### Revision 3 (from first review): ExpertReaction and SpeakingRequest Separated

`ExpertReaction` (private analysis) and `SpeakingRequest` (explicit decision to speak) are separate concepts with different lifecycles, multiplicities, and ownership.

### Correction 4 (this revision): TurnScheduler Focused on Scheduling

The "who speaks next" responsibility is decomposed into four focused components:

- `ReactionEvaluator` — what does this expert privately think?
- `SpeakingRequestDecision` — does this reaction warrant a speaking request? (computes initial priority)
- `TurnScheduler` — which request should be granted? (applies fairness adjustments to pre-computed priorities)
- `NextSpeakerSelector` — application-layer facade coordinating the above; the only component the engine depends on

`TurnScheduler` no longer calls `ReactionEvaluator` or creates `SpeakingRequest`s. It receives pre-built requests with pre-computed priorities and applies only deterministic fairness adjustments.

### Correction 5 (this revision): NextTurnSelection Carries Sufficient Context

`NextSpeakerSelector.selectNextSpeaker()` returns `NextTurnSelection | null` — not a bare `panelistId`. The selection result contains `{ panelistId, targetMessageId, moderatorBrief, expertBrief }`. This gives the engine everything needed to execute the next turn: who speaks, what they're responding to, what the moderator should say, and what direction the expert planned.

### Correction 6 (this revision): SpeakingRequest Scoring Made Consistent

`SpeakingRequest.priority` is pre-computed during reaction-to-request conversion (from `intent` + `urgency` + `confidence` + `directMention`). `TurnScheduler` applies only fairness adjustments (stance diversity, consecutive-speaker penalty, domination penalty) on top of this priority. The scheduler never accesses `ExpertReaction`.

### Correction 7 (this revision): Panelist Status Persistence Corrected

`PanelistRepository` has no `update` or `updateStatus` method. Panelist execution states (`waiting` ↔ `preparing` ↔ `speaking`) are ephemeral runtime state for the MVP. A future dedicated milestone may add controlled status-update methods if persistence of runtime transitions becomes required.

### Correction 8 (Revision 2): HTTP Trust Boundary Enforced

`panelistId`, `kind`, and `replyToMessageId` are **service-generated trusted metadata**. The `POST /api/.../messages` route is NOT modified — it does not accept these fields from client input. The domain model and repository handle them for server-side callers. The GET response exposes them as read-only data. This prevents identity forgery via the public API.

### Decision 9 (Revision 3): Initial-Speaker Selection is Deterministic Bootstrap

The normal `NextSpeakerSelector` flow requires a prior expert message to react to. The first speaker cannot be selected this way. The engine uses a deterministic bootstrap rule: **select the first active expert panelist (`role === "expert"`, `status !== "finished"`) in panelist insertion order**. This is a simple rule, not a scheduling decision — no reaction evaluation, no speaking requests, no `NextSpeakerSelector` involvement. After the first expert speaks and their message becomes available as a reaction target, the normal `NextSpeakerSelector`-based cycle takes over for all subsequent turns.

### Decision 10 (Revision 3): SpeakingRequests Are Turn-Local

`SpeakingRequest`s (and `ExpertReaction`s) are **turn-local**: created fresh after each public expert statement, one is selected by the `TurnScheduler`, then ALL are discarded. There is no cross-turn request store, no carry-over, no explicit expiration mechanism. Staleness is avoided by recalculating all requests against the newest public statement each turn — an expert who wanted to respond to statement X but was not selected will naturally produce a different (or no) request against the new statement Y. This simplifies the MVP implementation to a single scheduling decision per turn with no persistent request state.

### Decision 11 (Revision 3): ModeratorStrategy Owned by AdversarialDiscussionEngine

`ModeratorStrategy` is a dependency of `AdversarialDiscussionEngine`, not `DiscussionSessionController`. The engine invokes it for all moderator content: opening, first-expert call, bridge calls (using `NextTurnSelection.moderatorBrief`), and closing. `DiscussionSessionController` retains `SessionLifecycle` for system-level boundary notifications only (`kind: "system_notification"`). These are distinct concepts: `SessionLifecycle` produces system markers; `ModeratorStrategy` produces visible moderator speech. Duplicate opening/closing is avoided because `ModeratorStrategy` is the sole producer of moderator content — `SessionLifecycle` produces only system boundary markers.

---

## Approval Checkpoint

This proposal has been produced after thorough inspection of all backend source files, test files, design documents, prompt records, and configuration. Every limitation reported has been confirmed against the source. Every recommendation accounts for the existing contracts and test suite.

The eleven architectural revisions and corrections above have been incorporated throughout the proposal.

**Implementation has not started. Awaiting design approval.**
