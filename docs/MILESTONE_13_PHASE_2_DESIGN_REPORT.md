# Milestone 13 Phase 2 — Design Report

**Status:** Architecture review — implementation has not started.
**Date:** 2026-07-23

---

## Phase 2 Objective

Phase 2 populates the three Message metadata fields — `panelistId`, `kind`, and
`replyToMessageId` — that Phase 1 introduced into the domain model.

### How Phase 2 differs from Phase 1

| | Phase 1 | Phase 2 |
|---|---|---|
| **What changed** | Domain model (types + repository defaults) | Producer call sites |
| **Behaviour impact** | None — `?? null` backward-compatible defaults | None — discussion execution unchanged |
| **Test impact** | Fixture updates only; +13 new repository tests | Producer-level test assertions |
| **Scope** | 7 files (2 production, 5 test) | ~3 production files, ~3 test files |

Phase 1 extended the domain. Phase 2 begins populating the new metadata **only
where the producer already possesses sufficient information** — no new plumbing,
no orchestration changes.

---

## Current Message Producers

Every site that calls `MessageRepository.create()` today:

| # | File:line | Component | Purpose | Current role | Has panelist? | Knows kind? | Knows reply target? |
|---|---|---|---|---|---|---|---|
| 1 | `RoundController.ts:94` | `RoundController` | Persist AI-generated response after a panelist turn | `"assistant"` | **Yes** — `panelist.id` is loaded and validated at line 65 | **Partial** — `panelist.role === "expert"` → `"expert_statement"`; host role is ambiguous | **No** — AI responds to flat history, no target message concept |
| 2 | `TemplateSessionLifecycle.ts:27` | `TemplateSessionLifecycle.onSessionStart` | Session-start lifecycle boundary marker | `"assistant"` | **No** — this is a system/lifecycle message | **Yes** — `"system_notification"` | **No** — not a reply |
| 3 | `TemplateSessionLifecycle.ts:38` | `TemplateSessionLifecycle.onSessionEnd` | Session-end lifecycle boundary marker | `"assistant"` | **No** — this is a system/lifecycle message | **Yes** — `"system_notification"` | **No** — not a reply |
| 4 | `routes/message.ts:66` | Express POST route handler | Client-submitted message (user prompt) | `"user"` or `"assistant"` from client | **No** — user is not a panelist | **No** — trust boundary; client cannot declare kind | **No** — trust boundary |

**Producer 4 (HTTP POST)** must remain untouched. The three metadata fields are
**service-generated trusted metadata** — the HTTP contract must not accept them
from untrusted clients.

---

## Metadata Ownership

### `panelistId` — WHO produced the message

| Producer | Who owns this information? | Reasoning |
|---|---|---|
| RoundController | **RoundController** already has `panelist.id` | `executeTurn()` receives `panelistId` in its input (line 53) and loads the full `Panelist` object (line 65). The panelist is literally the author of the AI-generated response. |
| TemplateSessionLifecycle | **TemplateSessionLifecycle** knows it is `null` | Neither session-start nor session-end messages are authored by a panelist. The lifecycle itself is the conceptual author. |
| HTTP POST route | **No one** — must remain `null` | The user submitting the HTTP request is not a panelist. Even if they were, the client is untrusted and cannot assert identity. |

### `kind` — WHAT conversational function

| Producer | Who owns this information? | Reasoning |
|---|---|---|
| RoundController (expert) | **RoundController** via `panelist.role` | When `panelist.role === "expert"`, the AI response is unambiguously an expert statement. |
| RoundController (host) | **No one yet** | The current round-robin architecture cannot distinguish moderator opening, moderator call, or moderator closing. The host speaks each round like any other panelist. Determining host `kind` requires `ModeratorStrategy`, which is deferred. |
| TemplateSessionLifecycle | **TemplateSessionLifecycle** | Both messages are `"system_notification"` — lifecycle boundary markers, not panelist-authored content. |
| HTTP POST route | **No one** — must remain `null` | Trust boundary. |

### `replyToMessageId` — WHICH prior message is being answered

| Producer | Who owns this information? | Reasoning |
|---|---|---|
| RoundController | **No one yet** | The current `buildPanelistMessages()` feeds the AI a flat conversation history. There is no mechanism to identify which specific prior message triggered the response. Determining reply targets requires `SpeakingRequest` or target-message semantics, both deferred. |
| TemplateSessionLifecycle | **TemplateSessionLifecycle** knows it is `null` | Lifecycle boundary markers are not replies to any message. |
| HTTP POST route | **No one** — must remain `null` | Trust boundary. |

---

## Recommended Phase 2 Scope

The smallest possible implementation that begins populating metadata without
changing behaviour:

### 1. RoundController — populate `panelistId` and expert `kind`

**File:** `backend/src/controllers/RoundController.ts`

Change the `messageRepo.create()` call (line 94) from:

```ts
const createdMessage = await this.messageRepo.create({
  discussionId,
  role: "assistant",
  content: response.content,
});
```

To:

```ts
const createdMessage = await this.messageRepo.create({
  discussionId,
  role: "assistant",
  content: response.content,
  panelistId: panelist.id,
  kind: panelist.role === "expert" ? "expert_statement" : null,
});
```

**Why:**
- `panelist.id` is already loaded and validated (line 65). No new plumbing.
- `panelist.role` is already loaded. Distinguishing expert from host requires zero additional lookups.
- Host `kind` is left `null` because the current round-robin architecture cannot distinguish moderator opening/call/closing. Setting the wrong `kind` would be worse than leaving it `null`.

### 2. TemplateSessionLifecycle — populate `kind` as `"system_notification"`

**File:** `backend/src/lifecycle/TemplateSessionLifecycle.ts`

Change both `messageRepo.create()` calls (lines 27 and 38) to add:

```ts
kind: "system_notification",
```

**Why:**
- These are unambiguously system-generated lifecycle boundary markers.
- No panelist authors them → `panelistId` remains `null`.
- They are not replies → `replyToMessageId` remains `null`.

### 3. No other producer changes

- **HTTP POST route** (`backend/src/routes/message.ts`): Unchanged. Trust boundary.
- **PromptBuilder** (`backend/src/ai/PromptBuilder.ts`): Unchanged. It builds AI messages, not domain Messages.
- **DiscussionEngine**, **DiscussionSessionController**, **DiscussionController**: Unchanged. They do not call `MessageRepository.create()`.

### What is NOT populated in Phase 2

| Field | Status |
|---|---|
| `panelistId` on lifecycle messages | Correctly `null` — no panelist |
| `panelistId` on HTTP POST messages | Correctly `null` — trust boundary |
| `kind` on host messages | Deferred — requires `ModeratorStrategy` |
| `kind` on HTTP POST messages | Correctly `null` — trust boundary |
| `replyToMessageId` everywhere | Deferred — requires reply-target semantics (SpeakingRequest, NextSpeakerSelector) |

---

## Components That Must Remain Untouched

| Component | File | Reason |
|---|---|---|
| `DiscussionEngine` | `services/DiscussionEngine.ts` | Does not create Messages. No metadata to populate. |
| `DiscussionSessionController` | `controllers/DiscussionSessionController.ts` | Does not create Messages. Orchestrates lifecycle + engine only. |
| `DiscussionController` | `controllers/DiscussionController.ts` | Does not create Messages. Delegates to `RoundController`. The `panelistId` it forwards to `RoundController` is already correct — `RoundController` uses it. |
| `PromptBuilder` | `ai/PromptBuilder.ts` | Builds `AIMessage[]` (provider format), not domain `Message` objects. Its signature and behaviour are unchanged. |
| `AIService` / `MockAIService` / `DeepSeekAIService` | `ai/` | Receives AI messages, returns `{ content }`. No domain Message involvement. |
| HTTP routes | `routes/message.ts`, `routes/discussion.ts`, `routes/panelist.ts` | The POST route is the trust boundary. No metadata should pass through it. GET routes return whatever the repository stores — they automatically include new fields. |
| `PanelistRepository` | `repositories/` | Not involved in Message creation. |
| `SessionLifecycle` interface | `lifecycle/SessionLifecycle.ts` | Interface unchanged — `TemplateSessionLifecycle` populates `kind` internally without changing the contract. |
| `InMemoryMessageRepository` | `repositories/InMemoryMessageRepository.ts` | Already handles the new fields via `?? null`. No change needed. |

---

## Dependency Analysis

### Current data flow (Phase 1 — metadata lost)

```
DiscussionSessionController
  │
  ├─[1]─ TemplateSessionLifecycle.onSessionStart({discussionId})
  │       └─ messageRepo.create({discussionId, role:"assistant", content})
  │          panelistId ✗  kind ✗  replyToMessageId ✗
  │
  ├─[2]─ DiscussionEngine.runDiscussion({discussionId, maxRounds})
  │       └─ DiscussionController.executeDiscussion({discussionId})
  │           └─ RoundController.executeTurn({discussionId, panelistId})
  │               │  panelist = panelistRepo.findById(panelistId)  ← HAS panelist!
  │               │  messages = messageRepo.findByDiscussionId()   ← HAS prior messages!
  │               │  response = aiService.generate(aiMessages)
  │               └─ messageRepo.create({discussionId, role:"assistant", content})
  │                  panelistId ✗  kind ✗  replyToMessageId ✗
  │
  └─[3]─ TemplateSessionLifecycle.onSessionEnd({discussionId})
          └─ messageRepo.create({discussionId, role:"assistant", content})
             panelistId ✗  kind ✗  replyToMessageId ✗
```

Metadata is available but discarded at every production site.

### Proposed data flow (Phase 2 — metadata attached where known)

```
DiscussionSessionController
  │
  ├─[1]─ TemplateSessionLifecycle.onSessionStart({discussionId})
  │       └─ messageRepo.create({
  │            discussionId, role:"assistant", content,
  │            kind: "system_notification"           ← POPULATED
  │          })
  │          panelistId: null  kind: "system_notification"  replyToMessageId: null
  │
  ├─[2]─ DiscussionEngine.runDiscussion({discussionId, maxRounds})
  │       └─ DiscussionController.executeDiscussion({discussionId})
  │           └─ RoundController.executeTurn({discussionId, panelistId})
  │               │  panelist = panelistRepo.findById(panelistId)
  │               │  messages = messageRepo.findByDiscussionId()
  │               │  response = aiService.generate(aiMessages)
  │               └─ messageRepo.create({
  │                    discussionId, role:"assistant", content,
  │                    panelistId: panelist.id,       ← POPULATED
  │                    kind: expert ? "expert_statement" : null  ← POPULATED
  │                  })
  │                  panelistId: panelist.id  kind: "expert_statement"|null  replyToMessageId: null
  │
  └─[3]─ TemplateSessionLifecycle.onSessionEnd({discussionId})
          └─ messageRepo.create({
               discussionId, role:"assistant", content,
               kind: "system_notification"           ← POPULATED
             })
             panelistId: null  kind: "system_notification"  replyToMessageId: null
```

Only two files change. The data already exists at the production sites — Phase 2
simply stops discarding it.

---

## Risk Assessment

### Risk 1: Incorrect `panelistId` on RoundController messages

**Likelihood:** Very low.
**Mitigation:** `panelist.id` is validated to exist, belong to the discussion, and not be finished (lines 60–78) before the `create()` call. The panelist is unambiguously the author of the AI-generated response. No other panelist could produce this message.

### Risk 2: Incorrect `kind` on host messages

**Likelihood:** N/A — host `kind` is explicitly left `null`.
**Mitigation:** The current architecture cannot distinguish moderator opening/call/closing. Setting a wrong `kind` is prevented by leaving it `null`. Future `ModeratorStrategy` work will populate these correctly.

### Risk 3: Incorrect `kind` on expert messages

**Likelihood:** Very low.
**Mitigation:** When `panelist.role === "expert"`, the RoundController always produces one AI-generated statement from that expert's perspective. The `kind: "expert_statement"` is unambiguously correct regardless of the statement's content (argument, rebuttal, question, concession). The `kind` describes the conversational function (an expert speaking), not the semantic content of the speech.

### Risk 4: Over-populating metadata

**Likelihood:** Low — the scope is intentionally minimal.
**Mitigation:** Only two producers change, and only the fields they definitively own. No field is guessed. No new plumbing is introduced. If a field cannot be determined with certainty, it remains `null`.

### Risk 5: Breaking existing tests

**Likelihood:** Medium — test fixtures and assertions will need updates, as they did in Phase 1.
**Mitigation:**
- Tests that verify RoundController output will need updated assertions (expect `panelistId` and `kind` on the returned Message).
- Test helpers (`makeMessage()`, `makeMsg()`, `sampleMessages()`) that construct `Message` objects may need updating if they simulate RoundController-produced messages and need to carry metadata.
- Repository-level backward-compatibility tests (test 14 in `message.test.ts`) will need updating to reflect the new populated defaults.
- **All existing test logic (discussion flow, ordering, isolation, error handling) remains valid.** Only assertions about message field values change.

### Risk 6: Introducing orchestration changes

**Likelihood:** Zero — no orchestration file is touched.
**Mitigation:** The scope explicitly excludes `DiscussionEngine`, `DiscussionSessionController`, `DiscussionController`, and `PromptBuilder`. Only the leaf producers change.

---

## Proposed Implementation Order

### Step 1: Update RoundController to populate `panelistId` and expert `kind`

**Files:**
- `backend/src/controllers/RoundController.ts` (+2 lines in `create()` call)

**Test impact:**
- `backend/src/tests/round-controller.test.ts` — update assertions on returned Messages to expect `panelistId` and `kind` where expert panelists are used. Host panelist tests should expect `kind: null`.
- `backend/src/tests/message.test.ts` — update test 14 ("existing message-producing flows receive null defaults") to reflect that the RoundController path now populates fields.

**Risk:** Low. The RoundController already has `panelist` in scope. No new dependencies.

### Step 2: Update TemplateSessionLifecycle to populate `kind: "system_notification"`

**Files:**
- `backend/src/lifecycle/TemplateSessionLifecycle.ts` (+1 line per `create()` call, 2 total)

**Test impact:**
- `backend/src/tests/template-session-lifecycle.test.ts` — update assertions on returned Messages to expect `kind: "system_notification"`, `panelistId: null`, `replyToMessageId: null`.
- `backend/src/tests/discussion-session-controller.test.ts` — `makeMsg()` helper may need updating if lifecycle message fixtures are compared to lifecycle-produced messages.

**Risk:** Very low. These are fixed-template messages with unambiguous `kind`.

### Step 3: Update integration/flow tests that traverse both producers

**Files:**
- `backend/src/tests/discussion-controller.test.ts` — `FailingOnNthCallController` stub creates Messages; may need metadata. Review fixture sites.
- `backend/src/tests/discussion-engine.test.ts` — `makeMessage()` helper used for stub DiscussionController output; may need metadata defaults.
- `backend/src/tests/discussion-session-controller.test.ts` — `makeMsg()` helper used for lifecycle and engine message stubs.

**Risk:** Medium. These are the same fixture-update sites that Phase 1 touched. The pattern is known and proven.

### Step 4: Type-check and full test suite

**Command:** `npx tsc --noEmit && npx vitest run`

**Risk:** Low. This is the same verification workflow Phase 1 used successfully.

---

## Out of Scope

Everything from the Milestone 13 design proposal that remains deferred:

| Deferred | Reason |
|---|---|
| `ModeratorStrategy` | Required for host `kind` population (opening/call/closing distinction) |
| `ReactionEvaluator` | Depends on `ExpertReaction`, not yet introduced |
| `ExpertReaction` | Domain concept for future milestones |
| `SpeakingRequest` | Required for `replyToMessageId` population |
| `TurnScheduler` | Depends on `SpeakingRequest` and `ReactionEvaluator` |
| `NextSpeakerSelector` | Application-layer facade for future milestones |
| `DiscussionEngine` changes | Engine remains a bounded multi-round orchestrator |
| Round orchestration changes | Fixed round-robin remains unchanged |
| HTTP contract expansion | POST route unchanged — metadata is server-generated only |
| Initial speaker bootstrap | Modelled in design, not yet implemented |
| Adversarial discussion execution | Entire protocol is deferred |
| Consensus/disagreement from targeted exchange | Requires adversarial execution first |
| `replyToMessageId` population | Requires reply-target semantics not present in current architecture |
| Host `kind` population | Requires `ModeratorStrategy` to distinguish opening/call/closing |

All of these are designed and documented. Phase 2 does not implement, partially
implement, or prepare for any of them beyond making their domain foundation
(specifically `panelistId` and `kind`) start carrying real data.

---

## Recommended Phase 2 Implementation Boundary

```
Phase 2 = Phase 2.1 + Phase 2.2

Phase 2.1 (RoundController):    panelistId populated for ALL panelist turns
                                kind populated for EXPERT panelist turns
                                (host kind remains null)

Phase 2.2 (TemplateSessionLifecycle):
                                kind populated as "system_notification"
                                (panelistId correctly null, replyToMessageId correctly null)
```

**Two production files modified. Zero architectural changes. Zero new abstractions.**

The metadata fields that remain `null` after Phase 2 (`replyToMessageId`
everywhere, `kind` on host messages, all fields on HTTP POST) are correctly
`null` — they represent information the current architecture genuinely does not
possess. Populating them correctly requires the deferred components listed above.

---

**Implementation has not started. Awaiting architecture review.**
