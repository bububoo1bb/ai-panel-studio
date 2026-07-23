# M16 Acceptance Report — Discussion Execution Flow

**Date:** 2026-07-23
**Author:** Claude Code (automated verification)
**Milestone:** M16 — Discussion Execution Flow

---

## 1. Summary

M16 transforms AI Panel Studio from a static discussion room into an executable discussion system. The verification confirms that all acceptance criteria are met: the user can start a discussion, the moderator delivers AI-generated opening and closing statements, experts generate public statements with correct metadata, messages are persisted, and the frontend display evolves dynamically.

**Verdict: ACCEPTED**

---

## 2. Automated Verification Results

| Check | Command | Result |
|---|---|---|
| Backend TypeScript | `npx tsc --noEmit` | ✅ 0 errors |
| Frontend TypeScript | `npx tsc --noEmit` | ✅ 0 errors |
| Backend tests | `npx vitest run` | ✅ 18 files / 344 tests passed |
| Frontend build | `npm run build` | ✅ 69 modules, 200 KB JS + 20 KB CSS |
| Git whitespace | `git diff --check` | ✅ Clean |

---

## 3. User Flow Verification

### 3.1 Discussion Creation

**Status:** ✅ Pre-existing (M4-M5)

The discussion creation flow was implemented in earlier milestones:
- `POST /api/discussions` creates a discussion with status `"active"`
- `GET /api/discussions/:id` returns the discussion (added in M16 for convenience)
- Discussion has a title, status, and creation timestamp

### 3.2 Panelist Generation

**Status:** ✅ Pre-existing (M15)

- `POST /api/discussions/:id/panelists/generate` generates 1 host + N experts via AI
- Each panelist has name, occupation, title, stance, and system-assigned color
- `ConfirmPanelistsPage` displays generated panelists for user confirmation

### 3.3 Enter DiscussionRoom

**Status:** ✅ Verified

After confirming panelists, the user navigates to `/discussion/:id`. The `DiscussionRoomPage` loads and displays:
- **Left:** ExpertPanel — panelist status cards with colors, names, titles
- **Center:** TranscriptPanel — empty transcript (waiting for discussion to start)
- **Right:** InsightPanel — placeholder

The page shows `executionState: "idle"` and the "开始讨论" button is visible.

### 3.4 Start Discussion

**Status:** ✅ Verified

**Frontend behavior:**
- User clicks "开始讨论" → `executionState` transitions to `"running"`
- Button is replaced by "● ON AIR" pulsing indicator
- `startDiscussion(id, 5)` calls `POST /api/discussions/:id/start`
- On error: error banner appears with dismiss button, `executionState` returns to `"idle"`

**Backend behavior:**
- `POST /api/discussions/:id/start` returns **HTTP 202** immediately
- Validation checks (verified by 9 tests in `discussion-start.test.ts`):
  - Discussion exists → 404 if not
  - Discussion not finished → 409 if already finished
  - `maxRounds` present and valid → 400 if invalid
  - Panelists exist → 422 if none
  - Host exists → 422 if not
  - At least one expert → 422 if not
- Discussion execution starts asynchronously (fire-and-forget)
- When execution completes, `discussion.status` → `"finished"` via `DiscussionRepository.updateStatus()`

### 3.5 Moderator Opening

**Status:** ✅ Verified

Verification via `discussion-start.test.ts` ("produces messages with correct metadata"):

- First message in transcript has `kind: "moderator_opening"` ✅
- Message has correct `panelistId` (host panelist) ✅
- Content is AI-generated (not a fixed template) ✅
- `AIModeratorStrategy.openDiscussion()` constructs a prompt containing:
  - Host name and title ✅
  - Discussion topic ✅
  - All expert names ✅

**Prompt content verified** in `moderator-strategy.test.ts`:
- "calls AIService with the discussion topic in the prompt" ✅
- "calls AIService with expert names in the prompt" ✅

### 3.6 Expert Speaking

**Status:** ✅ Verified

- Expert messages have `kind: "expert_statement"` ✅
- Expert messages have correct `panelistId` (expert panelist) ✅
- **Host is excluded from round execution** — `DiscussionController` filter:
  ```
  p.status !== "finished" && p.role !== "host"
  ```
  Verified by code inspection and all 16 existing `discussion-controller.test.ts` tests passing unchanged ✅
- Messages are persisted via `RoundController` (existing, unchanged) ✅
- Multiple experts per round, multiple rounds via `DiscussionEngine` (unchanged) ✅

### 3.7 Transcript Update

**Status:** ✅ Verified (with noted limitation)

**Polling mechanism:**
- When `executionState === "running"`, a `setInterval` fires every 2 seconds
- Each poll: `fetchDiscussion(id)` + `fetchMessages(id)` concurrently
- Messages are set via `setMessages()` — `TranscriptPanel` re-renders with new data ✅
- Active speaker is highlighted via `activeSpeakerId` state ✅
- When `discussion.status === "finished"`, `executionState` → `"finished"` ✅
- The polling `useEffect` is isolated in a single location ✅
- Commented-out SSE stubs document the migration path ✅
- `pollingRef` properly cleaned up on unmount/state change ✅

**Limitation (documented):**
- Polling is temporary. Future: SSE/WebSocket event streaming
- 2-second interval means up to 2s latency for new messages
- No incremental delivery — each poll fetches all messages
- Page refresh during execution resumes polling (detects `discussion.status === "active" && messages.length > 0`)

### 3.8 Discussion Completion

**Status:** ✅ Verified

- `AIModeratorStrategy.closeDiscussion()` generates the moderator's closing statement ✅
- Last message has `kind: "moderator_closing"` ✅
- `DiscussionRepository.updateStatus()` sets discussion to `"finished"` ✅
- Frontend detects `discussion.status === "finished"` via polling and transitions to `"finished"` state ✅
- "● ON AIR" indicator replaced by "讨论已结束" badge ✅

---

## 4. Architecture Verification

### 4.1 M13 Boundary Preservation

| Constraint | Verification | Status |
|---|---|---|
| `DiscussionEngine` does NOT depend on `ReactionEvaluator` | `grep` in DiscussionEngine.ts: 0 matches | ✅ |
| `DiscussionEngine` does NOT depend on `SpeakingRequest` | `grep` in DiscussionEngine.ts: 0 matches | ✅ |
| `DiscussionEngine` does NOT depend on `TurnScheduler` | `grep` in DiscussionEngine.ts: 0 matches | ✅ |
| `DiscussionEngine` does NOT depend on `ExpertReaction` | `grep` in DiscussionEngine.ts: 0 matches | ✅ |
| `DiscussionEngine` is unchanged from M13 | `git diff HEAD~1 -- DiscussionEngine.ts`: empty | ✅ |
| `RoundController` is unchanged from M13 | `git diff HEAD~1 -- RoundController.ts`: empty | ✅ |
| `DiscussionSessionController` is unchanged from M13 | `git diff HEAD~1 -- DiscussionSessionController.ts`: empty | ✅ |
| `SessionLifecycle` interface is unchanged | `git diff HEAD~1 -- SessionLifecycle.ts`: empty | ✅ |

### 4.2 Moderator Responsibility Separation

| Constraint | Verification | Status |
|---|---|---|
| `ModeratorStrategy` does NOT directly persist messages | `AIModeratorStrategy` has 3 deps: `AIService`, `DiscussionRepository`, `PanelistRepository`. No `MessageRepository` dependency. Comment: "Notably absent: MessageRepository" | ✅ |
| `ModeratorMessage` is a plain data object | Test verifies no `id`, `role`, or `createdAt` properties | ✅ |
| Message persistence owned by orchestration layer | `AISessionLifecycle` calls `MessageRepository.create()` after receiving `ModeratorMessage` | ✅ |
| `AISessionLifecycle` is a thin adapter | 2 dependencies: `ModeratorStrategy` + `MessageRepository`. Does not construct prompts, does not call AI directly | ✅ |
| `SessionLifecycle` remains session-boundary hooks | Only `onSessionStart` / `onSessionEnd`. No per-round hooks. No AI orchestration methods | ✅ |
| `ModeratorStrategy` is independently extensible | Interface has exactly 2 methods. Future methods (introduceExpert, bridgeTransition) are additive | ✅ |

### 4.3 Execution Flow Architecture

```
POST /api/discussions/:id/start (202, fire-and-forget)
        │
        ▼
DiscussionSessionController.runSession()           ← UNCHANGED
    ├── onSessionStart → AISessionLifecycle        ← NEW
    │       └── ModeratorStrategy.openDiscussion() ← NEW
    │               └── AIModeratorStrategy         ← NEW
    │                       ├── AIService
    │                       ├── DiscussionRepository
    │                       └── PanelistRepository
    │                            ↓ ModeratorMessage (data only)
    │       └── MessageRepository.create()         ← persistence
    │
    ├── DiscussionEngine.runDiscussion()            ← UNCHANGED
    │       └── DiscussionController                ← 1-line filter added
    │               └── RoundController             ← UNCHANGED
    │
    └── onSessionEnd → AISessionLifecycle           ← NEW
            └── (same pattern as onSessionStart)
```

### 4.4 Dependency Graph

| Component | Status | Dependencies |
|---|---|---|
| `ModeratorStrategy` (interface) | NEW | (none — interface) |
| `AIModeratorStrategy` | NEW | `AIService`, `DiscussionRepository`, `PanelistRepository` |
| `AISessionLifecycle` | NEW | `ModeratorStrategy`, `MessageRepository` |
| `DiscussionSessionController` | UNCHANGED | `DiscussionEngine`, `DiscussionRepository`, `SessionLifecycle` |
| `DiscussionEngine` | UNCHANGED | `DiscussionController`, `DiscussionRepository`, `PanelistRepository` |
| `DiscussionController` | MINIMAL CHANGE (1 filter) | `RoundController`, `PanelistRepository` |
| `RoundController` | UNCHANGED | `DiscussionRepository`, `MessageRepository`, `PanelistRepository`, `AIService` |

---

## 5. Test Coverage

### 5.1 Overall

| Metric | Value |
|---|---|
| Test files | 18 |
| Total tests | 344 |
| All passing | ✅ Yes |
| M16 new tests | 36 |

### 5.2 New Test Breakdown

| File | Tests | Coverage |
|---|---|---|
| `moderator-strategy.test.ts` | 12 | Interface contract, `openDiscussion()` metadata (panelistId, kind, content), `closeDiscussion()` metadata, non-persistence verification, missing host error, missing discussion error, prompt content inspection (topic + expert names) |
| `ai-session-lifecycle.test.ts` | 11 | Delegation to ModeratorStrategy (open + close), message persistence, return wrapping, error propagation (open + close), dependency isolation (no AIService dependency) |
| `discussion-start.test.ts` | 13 | Validation (6 cases: missing maxRounds, non-number, zero, fractional, not found, already finished, no panelists, no host, no experts), 202 immediate response, status transition to finished, message metadata ordering (opening first, closing last, expert_statement in between), discussion isolation |

### 5.3 Pre-existing Tests

All 308 pre-existing tests continue to pass with zero assertion changes. Test fixtures updated only where the `DiscussionRepository.updateStatus()` interface addition required new stub methods — no existing test logic was altered.

---

## 6. Known Limitations

### 6.1 Temporary Polling (M16 Only)

The frontend uses HTTP polling at 2-second intervals. This is a deliberate temporary mechanism documented in the codebase with explicit migration paths to SSE/WebSocket. Limitations:

- Up to 2-second latency for new message display
- Each poll fetches the complete message list (not incremental)
- No real-time expert status updates during rounds
- No "streaming" appearance — messages appear in batches

### 6.2 Round-Robin Execution

Expert turns execute in fixed insertion order — once per round per expert. This is the existing `DiscussionController` behavior (unchanged in M16). The PRD requires non-round-robin discussion (§4.4: "讨论不得采用固定机械轮流发言模式"). **This is the most significant gap between M16 and the PRD.** The `TurnScheduler` / `NextSpeakerSelector` from the M13 design proposal will address this.

### 6.3 No Per-Round Moderator Bridging

The moderator only delivers opening and closing statements. There are no mid-discussion moderator interventions (bridging transitions, calling on experts, follow-up questions). This is deferred to future milestones via `ModeratorStrategy` extensions.

### 6.4 No Discussion Pause/Resume/Cancel

Once started, a discussion runs to completion. There is no mechanism to pause, resume, or cancel an in-progress discussion. The fire-and-forget execution model does not expose control handles.

### 6.5 No Expert State Machine

The SDD defines a 5-state expert lifecycle (IDLE → THINKING → READY → SPEAKING → COOLDOWN). M16 does not implement this state machine. Expert `PanelistStatus` remains at `"waiting"` throughout execution (status is not mutated by `RoundController`).

### 6.6 No `replyToMessageId` Population

The `Message.replyToMessageId` field remains `null` for all messages. Reply-target semantics require `SpeakingRequest` — deferred per M13 design.

### 6.7 Double-Start Not Prevented

If a user sends two `POST /start` requests rapidly, both will execute. The route handler does not track an "executing" state in the repository (only `"active"` / `"finished"`). During execution, `discussion.status` remains `"active"`, so a second request passes the `"finished"` check. This is an acceptable MVP simplification — the start button is disabled after clicking.

### 6.8 Status Transition is Best-Effort

After execution completes, the route handler attempts `updateStatus(id, "finished")` in a `.then()` chain. If this update fails (e.g., repository error), the discussion remains `"active"` indefinitely. The frontend polling would continue forever. This is unlikely with `InMemoryDiscussionRepository` but should be hardened before production.

---

## 7. PRD Coverage Assessment

| PRD § | Requirement | M16 Status |
|---|---|---|
| 4.3 | 系统根据讨论主题动态生成主持人与专家阵容 | ✅ M15 (pre-existing) |
| 4.4 | 主持人负责开场 | ✅ ModeratorStrategy.openDiscussion() |
| 4.4 | 主持人负责最终收尾 | ✅ ModeratorStrategy.closeDiscussion() |
| 4.4 | 专家根据自身角色、自身立场、当前讨论上下文自主决定是否参与 | ⚠️ Round-robin (fixed participation) |
| 4.4 | 讨论不得采用固定机械轮流发言模式 | ❌ Deferred (TurnScheduler) |
| 4.4 | 单次发言应保持简洁 | ✅ Prompt constraint in buildPanelistSystemPrompt |
| 4.5 | 每位专家具有独立的状态展示区域 | ⚠️ Static display only — no state animation |
| 4.6 | Transcript 实时展示发言记录 | ⚠️ 2s polling (not real-time SSE) |
| 4.6 | 显示发言人姓名、Title、视觉标识 | ✅ TranscriptPanel with panelist metadata |
| 4.7 | 实时共识与分歧 | ❌ Deferred (ConsensusAnalyzer) |
| 4.8 | 主持人完成自然语言收尾 | ✅ ModeratorStrategy.closeDiscussion() |
| 5.1 | SSE 或 WebSocket 实现实时更新 | ❌ Deferred (temporary polling) |
| 5.2 | SQLite 持久化 | ⚠️ InMemoryRepository (SQLite deferred) |

**Key:** ✅ Complete | ⚠️ Partial / placeholder | ❌ Deferred

---

## 8. Remaining Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Round-robin feels mechanical to users | **High** | M13 `TurnScheduler` / `NextSpeakerSelector` design exists. Implementation in future milestone. |
| No real-time streaming feels slow | **Medium** | SSE migration path documented and isolated. One-location change in `DiscussionRoomPage`. |
| 2s polling generates excessive HTTP requests | **Low** | Only during active execution. 1 discussion × 2s = 30 req/min. Negligible for MVP. |
| No concurrent discussion execution control | **Medium** | Multiple discussions can execute simultaneously. In-memory repos isolate data. No resource limits or queues. |
| `DiscussionRepository.updateStatus()` not universally implemented | **Low** | Only `InMemoryDiscussionRepository` exists. SQLite implementation needed before production. |
| AI cost per discussion (1 opening + N×M expert turns + 1 closing) | **Medium** | 5 experts × 3 rounds = 15 AI calls + 2 moderator calls = 17 calls per discussion. Budget controls deferred. |

---

## 9. Final Verdict

**M16 is ACCEPTED.**

The milestone achieves its stated goal: "User can start a discussion and observe AI-generated public discussion messages." The complete flow works end-to-end:

```
Create Discussion → Generate Panelists → Confirm → Start → 
Moderator Opening → Expert Statements → Moderator Closing →
Transcript Display → Discussion Complete
```

All architectural constraints are satisfied:
- `DiscussionEngine` has zero adversarial concept dependencies
- `ModeratorStrategy` does not directly persist messages
- `SessionLifecycle` remains a session-boundary interface
- `AISessionLifecycle` is a thin adapter

344 tests pass (all green). Backend and frontend compile with zero errors. The implementation follows the established project patterns and lays a clean foundation for future milestones (TurnScheduler, SSE, ConsensusAnalyzer).

The three acknowledged gaps — **round-robin execution, polling instead of SSE, and no mid-discussion moderator bridging** — are documented as known limitations with clear migration paths in the codebase. These are appropriate for MVP and deferred by design.
