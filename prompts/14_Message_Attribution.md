# Prompt 14 — Message Attribution

**Stage:** Implementation Phase — Milestone 13 Phase 1

**Date:** 2026-07-23

---

## Objective

Evolve the `Message` domain model with three independent metadata fields — who produced the message, what conversational function it serves, and which prior message it responds to — without changing any discussion execution behaviour.

The previous `Message` model had only `role` (`"user" | "assistant"`), `content`, and `createdAt`. After the project evolved toward a moderator-led multi-expert discussion architecture (see `docs/MILESTONE_13_DESIGN_PROPOSAL.md`), a single `role` field was no longer sufficient to model adversarial discussion transcripts. A transcript record now needs to express:

- **WHO** produced the message — which panelist authored it, or that no panelist authored it
- **WHAT** conversational function the message serves — opening statement, moderator bridge, expert statement, or system notification
- **WHICH** prior message it responds to — the reply chain that enables targeted adversarial exchange

These are three independent axes. A moderator opening is not a reply. An expert statement may or may not be a reply. A system notification has no panelist and is not a reply. Compressing all three into `role` would produce an ambiguous, unqueryable transcript.

The goal of this milestone was to evolve the transcript domain so that future orchestration work can populate these fields. Phase 1 changes only the domain model and the repository default behaviour. No discussion orchestration behaviour changes.

---

## Background

The `Message` interface before this milestone had six fields:

```ts
interface Message {
  id: string;
  discussionId: string;
  role: MessageRole;        // "user" | "assistant"
  content: string;
  createdAt: string;
}
```

This model was sufficient for Milestones 1–12, where every turn produced one assistant message in response to the full conversation history. The transcript was a flat sequence of user prompts and AI responses.

The Milestone 13 design proposal introduced an **adversarial discussion protocol** in which:

- A moderator opens the discussion and calls on specific experts.
- Experts deliver statements targeted at identifiable preceding messages.
- Other experts inspect those statements and form structured reactions.
- A scheduler selects the next speaker from competing candidates.
- Consensus and disagreement emerge continuously from targeted exchange.

This protocol requires the transcript to carry attribution (`panelistId`), conversational function (`kind`), and reply relationships (`replyToMessageId`). The previous `Message` model could not express any of these.

---

## Architecture Review

The Milestone 13 design proposal underwent architecture review, and several important corrections emerged before implementation began.

### DiscussionEngine should not understand ExpertReaction

The initial proposal placed `ExpertReaction` processing inside `DiscussionEngine`. This was rejected because `DiscussionEngine` is a bounded multi-round orchestrator — it coordinates rounds, checks lifecycle state, and enforces `maxRounds`. It should not understand domain concepts like reactions, evaluations, or expert intent.

**Correction**: `ExpertReaction` and `ReactionEvaluator` are owned by a future `NextSpeakerSelector`, not by the engine.

### ExpertReaction and SpeakingRequest became separate concepts

The initial design treated `ExpertReaction` (an expert's internal response to a statement) and `SpeakingRequest` (a formal request to take the floor) as a single concept. Review identified that these are independent: a panelist may react without requesting to speak, and a moderator call may trigger a speaking request without a reaction to a prior statement.

**Correction**: `ExpertReaction` (internal assessment) and `SpeakingRequest` (floor request) are separate types. A panelist may produce either, both, or neither.

### TurnScheduler became responsible only for scheduling

The initial proposal gave `TurnScheduler` responsibility for evaluating reactions, scoring candidates, and selecting speakers. This conflated three distinct concerns.

**Correction**: `TurnScheduler` selects the next speaker from a pool of `SpeakingRequest` records. Reaction evaluation and scoring are separate concerns owned by `ReactionEvaluator`.

### NextSpeakerSelector became the application-layer facade

With `TurnScheduler` narrowed to scheduling, the application needed a coordinator that orchestrates: send the last message to all panelists → collect `ExpertReaction` records → evaluate → collect `SpeakingRequest` records → schedule.

**Correction**: `NextSpeakerSelector` is the application-layer facade that orchestrates this pipeline. `TurnScheduler` is one step within it.

### MessageKind was introduced

The initial proposal used `MessageRole` plus implicit context to distinguish moderator messages from expert statements. Review identified that `role` alone cannot distinguish a moderator opening from an expert statement (both are `"assistant"`), nor can it identify system notifications.

**Correction**: `MessageKind` — a new discriminated type (`"moderator_opening" | "moderator_call" | "moderator_closing" | "expert_statement" | "system_notification"`) — provides an explicit, queryable conversational function for every transcript record.

### HTTP trust boundaries were clarified

The initial proposal was ambiguous about whether the HTTP POST route should accept the new metadata fields from client input.

**Correction**: `panelistId`, `kind`, and `replyToMessageId` are **service-generated trusted metadata**. The HTTP POST route must not accept them as identity claims from untrusted clients. Only server-side components may set these fields through `MessageRepository.create()`.

### Initial speaker bootstrap became deterministic

The initial proposal described the first speaker selection as part of the general scheduling pipeline. Review identified a bootstrap problem: before any message exists, there is nothing to react to, so the reaction → evaluation → scheduling pipeline has no input.

**Correction**: The initial speaker is selected deterministically by the moderator (first in the panelist list), not by the general scheduling pipeline. The pipeline activates from turn 2 onward.

### SpeakingRequests became turn-local

The initial proposal described `SpeakingRequest` records as persistent entities. Review identified that speaking requests are only meaningful within a single turn — once a speaker is selected and delivers their statement, the previous round's requests are stale.

**Correction**: `SpeakingRequest` records are turn-local. They are collected after a statement is delivered and discarded after the next speaker is selected.

---

## Final Approved Design

The final `Message` interface has three new metadata fields:

```ts
export interface Message {
  id: string;
  discussionId: string;
  panelistId: string | null;       // WHO produced the message
  role: MessageRole;
  kind: MessageKind | null;         // WHAT conversational function
  content: string;
  replyToMessageId: string | null;  // WHICH prior message this responds to
  createdAt: string;
}
```

### Field Responsibilities

| Field | Type | Null meaning |
|---|---|---|
| `panelistId` | `string \| null` | `null` = not produced by a panelist (system notification, lifecycle boundary marker, legacy message) |
| `kind` | `MessageKind \| null` | `null` = message created before this field existed, or conversational function not applicable |
| `replyToMessageId` | `string \| null` | `null` = not a reply (opening statement, moderator bridge, system notification, lifecycle marker) |

### MessageKind Values

```ts
export type MessageKind =
  | "moderator_opening"
  | "moderator_call"
  | "moderator_closing"
  | "expert_statement"
  | "system_notification";
```

### Intentional Independence

The three fields are intentionally independent:

- `panelistId` identifies the author — independent of what kind of message it is.
- `kind` identifies the conversational function — independent of who authored it or whether it is a reply.
- `replyToMessageId` identifies the target — independent of who authored the reply or what kind of message it is.

No field implies the value of another. A moderator opening has no `replyToMessageId`. An expert statement may or may not be a reply. A system notification has no `panelistId` and no `replyToMessageId`.

### Phase 1 Scope

Phase 1 modifies only the domain model:

- `Message` interface gains three new optional/nullable fields.
- `CreateMessageInput` gains three new optional fields (default `null`).
- `InMemoryMessageRepository.create()` populates the new fields with `?? null` semantics.
- Test fixtures are updated to satisfy the new interface.
- New repository-level tests verify default behaviour, preservation, and isolation.

No orchestration behaviour changes. No discussion logic changes. The HTTP POST route is unchanged.

---

## Implementation

### Message Domain (`backend/src/domain/message.ts`)

Three additions to the `Message` interface:

- `panelistId: string | null` — the panelist who authored this message, or `null` when not produced by a panelist.
- `kind: MessageKind | null` — the conversational function this message serves, or `null` for legacy messages.
- `replyToMessageId: string | null` — the id of the prior message this message directly responds to, or `null` when not a reply.

Each field has a JSDoc comment marking it as **service-generated trusted metadata** — not accepted from untrusted client input.

`MessageKind` is a new exported type with five literal values.

`CreateMessageInput` gained three new optional fields, each defaulting to `null` when omitted.

### InMemoryMessageRepository (`backend/src/repositories/InMemoryMessageRepository.ts`)

The `create()` method was updated to populate the three new fields:

```ts
const message: Message = {
  id: randomUUID(),
  discussionId: input.discussionId,
  panelistId: input.panelistId ?? null,
  role: input.role,
  kind: input.kind ?? null,
  content: input.content,
  replyToMessageId: input.replyToMessageId ?? null,
  createdAt: new Date().toISOString(),
};
```

### Repository Default Behaviour

The `?? null` operator ensures:

- When a field is provided, the provided value is preserved.
- When a field is explicitly `null`, `null` is preserved.
- When a field is `undefined` (omitted), it defaults to `null`.

This means existing callers that do not pass the new fields — the `RoundController` path, the HTTP POST route, `TemplateSessionLifecycle` — continue to produce messages with `null` for all three new fields. No existing producer needs to change.

### Test Fixture Updates

Five test files contained `Message` object literals that no longer satisfied the expanded interface:

- `discussion-controller.test.ts` — two fixture sites (FailingOnNthCallController and inline stub)
- `discussion-engine.test.ts` — `makeMessage()` helper
- `discussion-session-controller.test.ts` — `makeMsg()` helper
- `message.test.ts` — existing routes tests (no changes needed to existing tests; new tests added separately)
- `prompt-builder.test.ts` — `sampleMessages()` and two inline fixtures

Each fixture was updated by adding the three new fields explicitly set to `null`. This is the minimally invasive change — existing tests continue to verify the same behaviour, just with interface-compliant objects.

---

## Explicit Non-Goals

Everything from the Milestone 13 design proposal that was **not** implemented in Phase 1:

| Deferred | Reason |
|---|---|
| `ModeratorStrategy` | Requires `MessageKind` to be queryable first |
| `ReactionEvaluator` | Depends on `ExpertReaction`, not yet introduced |
| `ExpertReaction` | Domain concept for future milestones |
| `SpeakingRequest` | Domain concept for future milestones |
| `TurnScheduler` behaviour | Depends on `SpeakingRequest` and `ReactionEvaluator` |
| `NextSpeakerSelector` implementation | Application-layer facade for future milestones |
| `DiscussionEngine` changes | Engine remains a bounded multi-round orchestrator |
| Round orchestration changes | No execution behaviour changed |
| HTTP write contract expansion | POST route unchanged — new fields are server-only |
| Initial speaker bootstrap | Modelled in design, not yet implemented |
| Adversarial discussion execution | Entire protocol is deferred |
| Consensus/disagreement from targeted exchange | Requires adversarial execution first |

These were intentionally deferred because Phase 1 establishes the domain foundation. Implementing orchestration before the domain model supports it would require revisiting the domain later and breaking existing callers.

---

## Testing

### Verification Performed

| Command | Result |
|---|---|
| `npx tsc --noEmit` (backend) | ✅ Passed (0 errors) |
| `npx vitest run` (backend) | ✅ 14 test files passed / 280 tests passed |
| `git diff --check` | ✅ No whitespace errors |

### New Repository Tests (13 tests in `message.test.ts`)

| # | Test |
|---|---|
| 1 | preserves `panelistId` when provided |
| 2 | preserves `kind` when provided |
| 3 | preserves `replyToMessageId` when provided |
| 4 | defaults omitted `panelistId` to null |
| 5 | defaults omitted `kind` to null |
| 6 | defaults omitted `replyToMessageId` to null |
| 7 | preserves explicit null for `panelistId` |
| 8 | preserves explicit null for `kind` |
| 9 | preserves explicit null for `replyToMessageId` |
| 10 | `findByDiscussionId` returns all three new fields |
| 11 | insertion ordering is unchanged with new fields |
| 12 | discussion isolation is unchanged with new fields |
| 13 | UUID and `createdAt` behaviour are unchanged with new fields |

Plus one integration-style test: "existing message-producing flows receive null defaults" — simulating the `RoundController` path where `create()` is called without the new fields, verifying `null` defaults for all three.

### Backward Compatibility

All 267 pre-existing tests continue to pass without modification to their assertions. The only changes to existing tests were fixture updates to satisfy the expanded `Message` interface.

### Test Count

**280 tests** across 14 test files, all passing. (Previously 267 tests across 14 test files; +13 new repository tests.)

---

## Lessons Learned

### Evolve the domain before the execution layer

Adding `panelistId`, `kind`, and `replyToMessageId` to `Message` before modifying `RoundController`, `DiscussionController`, or `DiscussionEngine` means the domain is stable when orchestration work begins. Changing the domain after execution code exists would require updating every message-producing call site.

### Separate semantic concepts before behaviour

`MessageKind` distinguishes moderator openings from expert statements from system notifications — but no code yet branches on `kind`. That is correct: the type system now encodes the distinction, and future code can use it without re-interpreting `role` or `content` heuristics.

### Preserve backward compatibility

All three new fields default to `null`. Every existing caller continues to work without changes. The `?? null` pattern in `InMemoryMessageRepository` is the single point of backward compatibility — one line per field.

### Avoid speculative implementation

Phase 1 does not implement `ModeratorStrategy`, `ReactionEvaluator`, `SpeakingRequest`, `TurnScheduler`, `NextSpeakerSelector`, or any adversarial discussion behaviour. These are designed and documented in the design proposal, but their implementation belongs in future milestones when the domain foundation is in place.

### Keep milestones intentionally small

Phase 1 touched 7 files (+1 new design document), added 3 fields, and wrote 13 focused tests. The entire change can be reviewed in a single sitting. A larger milestone that added all three fields plus moderator strategy plus scheduler changes would be harder to review and riskier to integrate.

---

## Foundation for Future Milestones

This milestone provides the domain foundation that future work builds upon:

- **ModeratorStrategy** will populate `kind: "moderator_opening" | "moderator_call" | "moderator_closing"` and `panelistId` when moderator messages are created.
- **RoundController** (or its future equivalent) will populate `kind: "expert_statement"`, `panelistId`, and `replyToMessageId` when expert turns produce messages.
- **Reply relationships** (`replyToMessageId`) will enable the adversarial pipeline: an expert's statement links to the message it challenges, supports, or rebuts.
- **Expert attribution** (`panelistId`) will enable per-panelist transcript filtering, consensus analysis by speaker, and visual speaker identity in the UI.
- **ReactionEvaluator** will consume `MessageKind` to distinguish messages that trigger reactions (expert statements) from those that do not (system notifications).
- **SpeakingRequest** and **NextSpeakerSelector** will consume the full transcript with attribution and reply chains to make scheduling decisions.
- **Adversarial discussion** execution will depend on all three fields to produce structured, queryable transcripts.

This milestone does not implement any of these systems. It provides the domain types they will use.

---

## Files Modified

### Production Files

| File | Change |
|---|---|
| `backend/src/domain/message.ts` | Added `MessageKind` type, `panelistId`/`kind`/`replyToMessageId` fields to `Message` interface, and corresponding optional fields to `CreateMessageInput` (+63 lines) |
| `backend/src/repositories/InMemoryMessageRepository.ts` | Populated three new fields with `?? null` semantics in `create()` (+3 lines) |

### Test Files

| File | Change |
|---|---|
| `backend/src/tests/message.test.ts` | Added 13 new repository-level tests for the new fields; no changes to existing route tests (+212 lines) |
| `backend/src/tests/discussion-controller.test.ts` | Updated two fixture sites with explicit `null` for new fields (+6 lines) |
| `backend/src/tests/discussion-engine.test.ts` | Updated `makeMessage()` helper with explicit `null` and return-type assertion (+5 lines) |
| `backend/src/tests/discussion-session-controller.test.ts` | Updated `makeMsg()` helper with explicit `null` (+3 lines) |
| `backend/src/tests/prompt-builder.test.ts` | Updated `sampleMessages()` and two inline fixtures with explicit `null` (+15 lines) |

### Documentation

| File | Change |
|---|---|
| `docs/MILESTONE_13_DESIGN_PROPOSAL.md` | New file — full design proposal for the adversarial discussion protocol (+1675 lines) |

---

## Milestone Summary

**Milestone 13 Phase 1 completed successfully.**

The `Message` domain model now supports three independent axes of transcript metadata: who produced the message (`panelistId`), what conversational function it serves (`kind`), and which prior message it responds to (`replyToMessageId`). All three fields default to `null` for backward compatibility.

No discussion execution behaviour changed. `RoundController`, `DiscussionController`, `DiscussionEngine`, and `DiscussionSessionController` continue to produce messages without the new metadata. The HTTP POST route remains unchanged — the new fields are server-generated trusted metadata, not client input.

The domain foundation is in place for future milestones to populate these fields during adversarial discussion execution.

**Next milestone:**
Populate the new Message metadata during discussion execution while preserving backward compatibility.

---

# Phase 2 — Message Metadata Population

**Stage:** Implementation Phase — Milestone 13 Phase 2

**Date:** 2026-07-23

---

## Objective

Phase 1 introduced the Message metadata foundation (`panelistId`, `kind`,
`replyToMessageId`) into the domain model, but no production code populated them.
All three fields defaulted to `null` for every message.

Phase 2 begins populating metadata **only where the existing producer already
possesses sufficient information** — without new plumbing, without architectural
changes, and without modifying discussion execution behaviour.

---

## Design Review

A full design review was conducted before implementation. The review identified
every existing `MessageRepository.create()` call site, determined which metadata
each producer can authoritatively own, and defined a minimal scope that avoids
touching any orchestration component.

The design report is preserved at `docs/MILESTONE_13_PHASE_2_DESIGN_REPORT.md`.

Key design decisions:

- `replyToMessageId` is **not populated** anywhere in Phase 2. The current
  round-robin architecture feeds the AI a flat conversation history; there is no
  mechanism to identify which specific prior message triggered a response.
  Reply-target semantics require `SpeakingRequest` and are deferred.

- Host/moderator `kind` is **not populated** in Phase 2. The current
  architecture cannot distinguish `moderator_opening`, `moderator_call`, or
  `moderator_closing`.  That distinction requires `ModeratorStrategy` and is
  deferred.

- The HTTP POST route is **not modified**.  `panelistId`, `kind`, and
  `replyToMessageId` are service-generated trusted metadata.  The HTTP trust
  boundary must not accept them as identity claims from untrusted clients.

---

## Producer Analysis

Three production producers and one HTTP route were examined.

### RoundController (`backend/src/controllers/RoundController.ts`)

`RoundController.executeTurn()` already loads and validates the `Panelist`
object before calling `AIService.generate()`. It has:

- `panelist.id` — the executing panelist's identity.
- `panelist.role` — `"host"` or `"expert"`.

**Decision:** Populate `panelistId` for all panelists.  Populate `kind` as
`"expert_statement"` when `panelist.role === "expert"`.  Leave `kind` `null` for
hosts — the current architecture cannot determine which moderator conversational
function applies.

### TemplateSessionLifecycle (`backend/src/lifecycle/TemplateSessionLifecycle.ts`)

`onSessionStart` and `onSessionEnd` create fixed-template lifecycle boundary
markers. They have:

- No panelist — the lifecycle itself is the conceptual author.
- Unambiguous conversational function — these are system-generated lifecycle
  notifications.

**Decision:** Populate `kind: "system_notification"` on both messages. Leave
`panelistId` and `replyToMessageId` as `null` — no panelist owns these messages
and they are not replies.

### HTTP POST route (`backend/src/routes/message.ts`)

The `POST /api/discussions/:discussionId/messages` handler creates messages from
untrusted client input. It has:

- `role` and `content` from the request body — validated but not trusted for
  metadata claims.
- No panelist identity — the HTTP client is not a panelist.
- No conversational function knowledge.

**Decision:** Not modified. All three metadata fields remain `null` by default.
This respects the trust boundary established in Phase 1.

---

## Implementation Changes

### RoundController

**File:** `backend/src/controllers/RoundController.ts`

The `messageRepo.create()` call in `executeTurn()` was extended with two new
properties:

```ts
const createdMessage = await this.messageRepo.create({
  discussionId,
  role: "assistant",
  content: response.content,
  panelistId: panelist.id,                                      // ← added
  kind: panelist.role === "expert" ? "expert_statement" : null, // ← added
});
```

- `panelistId` is populated for **all** panelist turns — both host and expert.
- `kind` is `"expert_statement"` for expert panelists only.
- Host `kind` remains `null`.  Without `ModeratorStrategy`, the RoundController
  cannot distinguish moderator opening, moderator call, or moderator closing.
  Setting the wrong `kind` would be worse than leaving it `null`.

The `panelist` object was already loaded and validated (discussion existence,
panelist existence, ownership match, active status) before this call. No new
repository lookups or validation were added.

### TemplateSessionLifecycle

**File:** `backend/src/lifecycle/TemplateSessionLifecycle.ts`

Both `onSessionStart` and `onSessionEnd` `messageRepo.create()` calls gained one
new property:

```ts
kind: "system_notification",
```

These messages are unambiguously system-generated lifecycle boundary markers.
They have no panelist author (`panelistId` remains `null`) and are not replies
(`replyToMessageId` remains `null`).

The fixed Chinese template content is unchanged:
- Start: `"讨论环节已开始。主持人将引导专家围绕话题展开讨论。"`
- End: `"讨论环节已结束。"`

---

## Preserved Boundaries

No discussion execution behaviour was changed. The following components received
**zero modifications**:

| Component | File | Reason |
|---|---|---|
| `DiscussionEngine` | `services/DiscussionEngine.ts` | Does not create Messages. Orchestrates rounds only. |
| `DiscussionSessionController` | `controllers/DiscussionSessionController.ts` | Does not create Messages. Orchestrates lifecycle + engine. |
| `DiscussionController` | `controllers/DiscussionController.ts` | Does not create Messages. Delegates to `RoundController`. |
| `PromptBuilder` | `ai/PromptBuilder.ts` | Builds `AIMessage[]`, not domain `Message` objects. |
| `AIService` / `MockAIService` / `DeepSeekAIService` | `ai/` | No domain Message involvement. |
| HTTP routes | `routes/message.ts`, `routes/discussion.ts`, `routes/panelist.ts` | Trust boundary — no metadata passes through POST; GET routes automatically include new fields. |
| `PanelistRepository` | `repositories/` | Not involved in Message creation. |
| `SessionLifecycle` interface | `lifecycle/SessionLifecycle.ts` | Interface unchanged — `TemplateSessionLifecycle` populates `kind` internally. |
| `InMemoryMessageRepository` | `repositories/InMemoryMessageRepository.ts` | Already handled the new fields via `?? null` from Phase 1. |
| `Message` domain | `domain/message.ts` | Unchanged from Phase 1. |

Round-robin execution, flat conversation history, and fixed panelist ordering
are all preserved. Phase 2 changes **what metadata is recorded**, not **how
discussion turns execute**.

---

## Testing

### Verification Performed

| Command | Result |
|---|---|
| `npx tsc --noEmit` (backend) | ✅ Passed (0 errors) |
| `npx vitest run` (backend) | ✅ 14 test files passed / 281 tests passed |

### Test Count

**281 tests** across 14 test files, all passing. (Previously 280 tests across
14 test files; +1 new test for host-panelist `kind` behaviour.)

### Test Changes

| File | Change |
|---|---|
| `round-controller.test.ts` | Updated "returns a created assistant Message" to assert `panelistId`, `kind: "expert_statement"`, and `replyToMessageId: null`. Added new test: "sets panelistId for host panelists and leaves kind null" (+1 test). |
| `template-session-lifecycle.test.ts` | Updated `onSessionStart` and `onSessionEnd` "creates a message with role assistant" tests to also assert `kind: "system_notification"`, `panelistId: null`, `replyToMessageId: null`. |
| `message.test.ts` | Updated comment on "existing message-producing flows receive null defaults" test to reflect that the RoundController path no longer omits these fields. The repository default-behaviour test remains valid for the HTTP POST route and any future legacy producers. |

No test fixtures in `discussion-controller.test.ts`, `discussion-engine.test.ts`,
`discussion-session-controller.test.ts`, or `prompt-builder.test.ts` required
changes — their stub/helper `Message` objects already carry `null` metadata
which remains valid.

---

## Files Modified (Phase 2)

### Production Files

| File | Change |
|---|---|
| `backend/src/controllers/RoundController.ts` | Populated `panelistId` and `kind` in `messageRepo.create()` call (+2 lines) |
| `backend/src/lifecycle/TemplateSessionLifecycle.ts` | Populated `kind: "system_notification"` in both `create()` calls (+2 lines) |

### Test Files

| File | Change |
|---|---|
| `backend/src/tests/round-controller.test.ts` | Updated assertions + new host-panelist test (+15 lines) |
| `backend/src/tests/template-session-lifecycle.test.ts` | Updated assertions for metadata fields (+6 lines) |
| `backend/src/tests/message.test.ts` | Updated comment on repository default-behaviour test (+4 lines) |

### Documentation

| File | Change |
|---|---|
| `docs/MILESTONE_13_PHASE_2_DESIGN_REPORT.md` | New file — full Phase 2 design report |
| `prompts/14_Message_Attribution.md` | This section appended (Phase 2 history) |

---

## What Remains Deferred

The metadata fields that remain `null` after Phase 2 are **correctly null** —
they represent information the current architecture genuinely does not possess:

| Field | Where | Reason |
|---|---|---|
| `kind` | Host/moderator messages | Requires `ModeratorStrategy` to distinguish opening/call/closing |
| `replyToMessageId` | All messages | Requires `SpeakingRequest` reply-target semantics |
| All three fields | HTTP POST route | Trust boundary — client cannot assert metadata |

---

## Future Work

Future milestones may introduce components that will populate the remaining
metadata fields:

- **ModeratorStrategy** — will produce moderator messages with correct
  `kind` values (`"moderator_opening"`, `"moderator_call"`,
  `"moderator_closing"`) and their moderator `panelistId`.

- **SpeakingRequest** / **NextSpeakerSelector** — will provide reply-target
  semantics, enabling `replyToMessageId` population when an expert responds
  to a specific prior statement.

- **ReactionEvaluator** — will consume `MessageKind` to distinguish messages
  that trigger reactions (expert statements) from those that do not (system
  notifications, moderator bridges).

- **TurnScheduler** — will select the next speaker from competing
  `SpeakingRequest` candidates.

These components are designed and documented in
`docs/MILESTONE_13_DESIGN_PROPOSAL.md`. They are not yet implemented. Phase 2
does not introduce, partially implement, or prepare for any of them beyond
ensuring the domain fields they will populate are already carrying real data
where the current architecture permits.

---

## Phase 2 Summary

**Milestone 13 Phase 2 completed successfully.**

Phase 2 populated two of the three Message metadata fields introduced in
Phase 1 — `panelistId` and `kind` — from the existing producers that already
possess sufficient information. `replyToMessageId` remains correctly `null`
everywhere, pending reply-target semantics in future milestones.

Two production files were modified (4 lines total). Five test files received
targeted updates. Zero architectural changes. Zero orchestration changes.
The fixed round-robin discussion execution is unchanged.

The transcript now carries per-message panelist attribution and conversational
function metadata for every message where the current architecture can determine
them authoritatively.

Phase 1 + Phase 2 together provide the domain foundation and initial metadata
population that future adversarial-discussion components (`ModeratorStrategy`,
`ReactionEvaluator`, `SpeakingRequest`, `TurnScheduler`, `NextSpeakerSelector`)
will build upon.
