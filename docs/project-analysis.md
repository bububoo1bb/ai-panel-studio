# AI Panel Studio — Design Review (Technical Lead Analysis)

> **Reviewed by**: Technical Lead (AI-assisted)
> **Date**: 2026-07-22
> **Documents reviewed**: PRD, SDD, DDD, TDD, Acceptance Criteria, CLAUDE.md

---

## 1. Product Goal

### 1.1 Product Vision

AI Panel Studio is an AI-powered roundtable discussion web application. A user provides a discussion topic and the number of expert panelists; the system uses an LLM to dynamically generate a moderator and a panel of experts — each with distinct backgrounds, professions, and stances — then runs an autonomous, real-time discussion among them.

The core value proposition is **multi-perspective analysis on demand**: users can explore a complex topic from many angles without needing to assemble real people.

### 1.2 Target Users

| Segment | Use Case |
|---------|----------|
| Knowledge workers & researchers | Rapidly analyse a complex issue from multiple viewpoints; surface blind spots, disagreements, and new angles. |
| Product managers & decision-makers | Stress-test proposals, strategies, or decisions through multi-role AI debate before committing. |
| Educators & content creators | Obtain structured, multi-perspective, replayable discussion content around a subject. |

### 1.3 MVP Scope

**Included**:
- Create and join discussions (no auth required)
- AI-generated moderator + expert panel from a topic + count
- Real-time autonomous roundtable discussion (no fixed turn order)
- Live transcript with visual speaker identity
- Live consensus & disagreement tracking (updates continuously, not only at the end)
- Discussion summary after moderator wrap-up
- SQLite persistence (survives page refresh)
- SSE/WebSocket real-time updates
- Chinese-language UI
- Desktop-first layout

**Excluded from MVP**:
- User registration / login
- Social sharing
- Complex permissions
- Mobile apps
- Non-discussion analytics
- Non-essential animations / effects

### 1.4 Core User Workflow

```
Landing page → Create discussion (topic + expert count)
  → AI generates moderator + panel → User reviews & confirms panel
  → Enter Studio (three-column layout)
  → Moderator opens → Experts self-select and speak → Transcript updates in real time
  → Consensus/disagreement panel updates live
  → Moderator wraps up → Final summary displayed
```

**Assessment**: The workflow is well-defined and complete for MVP. The explicit "confirm panel" step is a good UX decision — it gives the user agency before the autonomous phase begins and avoids surprises from hallucinated panelists.

---

## 2. System Architecture Review

### 2.1 Architecture Summary

```
User → React/Vite SPA → Express API Server → AI Agent System → LLM API (DeepSeek V4 Pro)
                              ↓
                         SQLite Database
```

The architecture follows a classic three-tier web pattern with a clear separation between presentation (React), business logic (Express + Agent System), and persistence (SQLite). This is appropriate for an MVP.

### 2.2 Module Responsibilities

| Module | Responsibility | Assessment |
|--------|---------------|------------|
| **Discussion Manager** | CRUD for discussions; data isolation between concurrent discussions | Well-scoped. Needs clarification on state machine for Discussion status. |
| **Expert Generator** | Generate 1 moderator + N experts from topic via LLM | Well-scoped. Prompt engineering strategy is not yet documented — this is the single highest-risk component for output quality. |
| **Round Table Engine** | Orchestrate discussion flow; moderator controls pacing; experts self-select; scheduling algorithm | **Highest complexity module.** The scheduling algorithm (relevance, value-add, stance alignment, novelty) is described in principle but lacks a concrete decision function. This needs deeper design before implementation. |
| **Transcript Manager** | Persist and push messages (speaker, content, timestamp) | Straightforward. Needs clarity on message types (public speech vs. internal event). |
| **Consensus Analyzer** | Continuously analyse transcript to produce live consensus/disagreement | **Second-highest complexity.** "Real-time" is specified but triggers are not: per-message? batched every N messages? on a timer? The analysis prompt design is also not discussed. |

### 2.3 API Boundaries

| Method | Path | Purpose | Assessment |
|--------|------|---------|------------|
| POST | `/api/discussions` | Create discussion | Input includes `topic` + `expert_count`. Good. |
| GET | `/api/discussions/:id` | Get discussion info | Good. |
| POST | `/api/discussions/:id/experts` | Generate panelists | Good separation from creation — allows regeneration. |
| GET | `/api/discussions/:id/messages` | Get transcript | Good. Consider adding pagination or cursor for long discussions. |
| SSE/WS | (real-time endpoint) | Push events | Needs a concrete path, e.g. `GET /api/discussions/:id/events`. |

**Missing API endpoints** (recommended for completeness):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/discussions/:id/start` | Explicitly start the discussion (triggers Round Table Engine) |
| POST | `/api/discussions/:id/stop` | Stop/pause a running discussion |
| GET | `/api/discussions/:id/summary` | Get the current/final summary |

These provide explicit lifecycle control rather than implicitly starting after panel confirmation.

### 2.4 Real-time Communication Design

The documents state "SSE or WebSocket" without committing to one. This is a **decision that must be made before implementation**.

**Recommendation: SSE for MVP.**

| Factor | SSE | WebSocket |
|--------|-----|-----------|
| Direction | Server → Client only | Bidirectional |
| Protocol | HTTP (standard) | Upgrade from HTTP |
| Reconnection | Built-in (EventSource) | Manual implementation |
| Browser support | Universal | Universal |
| Proxy/firewall friendliness | High (plain HTTP) | Lower (Upgrade header) |
| Complexity | Low | Medium |

The app's real-time needs are **unidirectional** (server pushes events to client). Client-to-server actions (create discussion, confirm panel, etc.) go through REST endpoints. SSE is simpler, auto-reconnects, and fits the use case perfectly. If bidirectional communication is needed later (e.g., user interjects a question mid-discussion), WebSocket can be adopted as an upgrade.

### 2.5 Key Architectural Gaps

1. **Discussion termination condition**: When does a discussion end? After N rounds? After moderator decides? After a time limit? None of the documents specify this. The Round Table Engine cannot be designed without it.

2. **LLM call error handling**: No retry strategy, timeout, or fallback behavior is defined. LLM API calls can fail, timeout, or return malformed JSON. The Agent System must handle these gracefully.

3. **Concurrency model for the Round Table Engine**: When multiple discussions run simultaneously, how are they managed? One async process per discussion? A worker pool? This affects resource usage and error isolation.

4. **LLM context window management**: As the transcript grows, it will exceed the model's context window. A summarisation/compression strategy for the discussion history is needed.

5. **Configuration management**: Limits on expert count (min/max), discussion duration, message length, and cooldown duration should be configurable, not hard-coded.

---

## 3. Domain Model Review

### 3.1 Current Model

```
Discussion:  id, title, status, created_at
Expert:      id, discussion_id, name, title, position, color
Message:     id, discussion_id, speaker_id, content, created_at
Summary:     id, discussion_id, consensus, disagreement
```

### 3.2 Review

**Discussion**:
- `title` is used to store the discussion topic. Naming is acceptable but `topic` would be more explicit (the PRD consistently uses "讨论主题").
- **Missing**: `expert_count` — should record how many experts were requested.
- **Missing**: `ended_at` — to track discussion duration.
- **Missing**: `status` values are not enumerated. Suggested: `created`, `generating_panel`, `ready`, `running`, `completed`, `error`.

**Expert**:
- **Missing**: `role` field to distinguish `moderator` from `expert`. Without this, the Round Table Engine cannot differentiate duties.
- **Missing**: `status` field for the state machine (IDLE, THINKING, READY, SPEAKING, COOLDOWN). The state machine is well-documented in the SDD but has no corresponding persistence column.
- **Missing**: `avatar_url` or `avatar_seed` — the DDD mentions "头像/颜色标识" but only `color` is in the model. A generated avatar (e.g., DiceBear initial-based) would improve visual distinction.
- `position` is used to mean "立场" (stance/viewpoint). This is fine but could be confused with "职位" (job title). Clarify naming.

**Message**:
- **Missing**: `message_type` — needed to distinguish `public_speech`, `moderator_instruction` (internal), `system_event`. The PRD says "内部调度事件不作为公开发言展示"; a type field enables this filtering.
- **Missing**: `speaker_role` — denormalised `moderator`/`expert` for efficient filtering without a join.

**Summary**:
- **Missing**: `created_at` / `updated_at` — timestamps for tracking when the summary was last computed.
- **Missing**: `version` or `sequence` — since consensus updates are continuous, the summary should be versioned.
- The current flat string design (`consensus` + `disagreement`) is adequate for MVP but will be hard to structure. Consider whether these should be JSON arrays of individual consensus/disagreement items.

### 3.3 Missing Entities

| Entity | Purpose | MVP Priority |
|--------|---------|--------------|
| **DiscussionConfig** | Per-discussion settings (max rounds, temperature, cooldown duration) | Low (use global defaults for MVP) |
| **ExpertStateLog** | Audit trail of state transitions for debugging the scheduling engine | Medium (invaluable for debugging) |
| **ConsensusSnapshot** | Point-in-time consensus state, enabling "consensus over time" display | Low (current state is enough for MVP) |
| **Round/Topic** | Structured tracking of discussion phases/agenda items | Low (moderator handles this implicitly) |

### 3.4 Recommended MVP Data Model

```sql
-- Discussion
CREATE TABLE discussions (
  id          TEXT PRIMARY KEY,
  topic       TEXT NOT NULL,           -- was "title"; renamed for clarity
  expert_count INTEGER NOT NULL,       -- NEW: records requested count
  status      TEXT NOT NULL DEFAULT 'created',  -- created | generating_panel | ready | running | completed | error
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT                      -- NEW
);

-- Expert
CREATE TABLE experts (
  id            TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id),
  role          TEXT NOT NULL CHECK(role IN ('moderator', 'expert')),  -- NEW
  name          TEXT NOT NULL,
  title         TEXT NOT NULL,
  position      TEXT NOT NULL,         -- stance/viewpoint
  color         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'idle',  -- NEW: idle | thinking | ready | speaking | cooldown
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Message
CREATE TABLE messages (
  id            TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id),
  speaker_id    TEXT NOT NULL REFERENCES experts(id),
  message_type  TEXT NOT NULL DEFAULT 'public_speech',  -- NEW: public_speech | system_event
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Summary
CREATE TABLE summaries (
  id            TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id),
  consensus     TEXT NOT NULL DEFAULT '',
  disagreement  TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,    -- NEW
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),  -- NEW
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.5 Future Extensions (post-MVP)

- **User/Account** entity for auth
- **DiscussionTemplate** for predefined discussion formats
- **ExpertProfile** for reusable expert personas
- **DiscussionRating** for quality feedback
- **Tag/Category** for organising discussions
- **UserInterjection** for mid-discussion user questions

---

## 4. Test Strategy Review

### 4.1 Coverage Assessment

| Test Layer | Covered in TDD? | Depth | Gaps |
|------------|-----------------|-------|------|
| Unit Tests | Yes (Section 2) | Shallow | See 4.2 |
| API Tests | Yes (Section 3) | Minimal | See 4.3 |
| Real-time Tests | Yes (Section 4) | Minimal | See 4.4 |
| Integration Tests | **Not mentioned** | Missing | See 4.5 |
| E2E Tests | Yes (Section 5) | High-level only | See 4.6 |

### 4.2 Unit Tests — Missing Scenarios

The TDD covers Discussion Manager, Expert Generator, Agent State Machine, and Message Manager. It misses:

1. **Consensus Analyzer**: No unit tests for the analysis logic. Need tests for:
   - Extracting consensus from a transcript
   - Extracting disagreement from a transcript
   - Handling empty transcripts
   - Handling single-speaker transcripts (no disagreement possible)
   - Update behaviour (does it replace or append?)

2. **Round Table Engine — Scheduling**: No tests for the speaker selection algorithm. Need tests for:
   - Basic selection: the most relevant expert is chosen
   - Cooldown enforcement: COOLDOWN experts are excluded
   - Moderator intervention: moderator can override when needed
   - Tie-breaking: what happens when two experts have equal relevance?
   - Edge case: all experts in COOLDOWN (moderator must step in)

3. **Expert Generator — Prompt construction**: No tests for how the LLM prompt is built from topic + count. Need tests for:
   - Prompt includes all required fields (name, title, position, color)
   - Prompt specifies distinct positions for experts
   - Prompt handles edge-case topics (very short, very long, non-English, sensitive)

4. **LLM Response Parsing**: No tests for parsing the LLM's JSON response. Need tests for:
   - Valid response parsing
   - Malformed JSON handling
   - Missing required fields
   - Extra/unexpected fields
   - Empty response handling

5. **Context Window Management**: No tests for transcript truncation/summarisation when context is full.

### 4.3 API Tests — Missing Scenarios

The TDD only covers the happy path for two endpoints. Missing:

1. **POST `/api/discussions`**:
   - Missing `topic` field → 400
   - `expert_count` = 0 → 400
   - `expert_count` > maximum → 400
   - Very long topic string → 400 or truncated
   - SQL injection attempt in topic → safe handling

2. **GET `/api/discussions/:id`**:
   - Non-existent ID → 404
   - Malformed UUID → 400

3. **POST `/api/discussions/:id/experts`**:
   - Discussion not found → 404
   - Experts already generated → 409 (idempotency)
   - Discussion not in correct state → 409

4. **GET `/api/discussions/:id/messages`**:
   - Discussion not found → 404
   - Empty transcript → 200 with `[]`
   - Pagination behaviour (if added)

5. **Cross-discussion isolation**: Verify that requesting messages for discussion A does not return messages from discussion B.

### 4.4 Real-time Tests — Missing Scenarios

The TDD mentions SSE/WebSocket testing briefly. Missing:

1. **Connection lifecycle**:
   - Client connects successfully
   - Client reconnects after disconnect (SSE auto-reconnect)
   - Server sends initial state on connect (current experts, recent messages)
   - Multiple clients can connect to the same discussion

2. **Event correctness**:
   - `expert_status_update` contains valid expert_id and status
   - `message_created` contains all required fields
   - `consensus_updated` fires after relevant messages (not after every message)
   - Events are delivered in order

3. **Isolation**:
   - Client connected to discussion A does not receive events from discussion B
   - Disconnecting client A does not affect client B

4. **Error handling**:
   - Server-side error during event generation (e.g., LLM timeout) does not crash the SSE stream
   - Client handles stream interruption gracefully

### 4.5 Integration Tests — Entirely Missing

The TDD does not mention integration tests. Recommended:

1. **LLM API integration** (with mocked LLM):
   - Expert Generator → LLM → parsed result pipeline
   - Round Table Engine → LLM → message generation pipeline
   - Consensus Analyzer → LLM → consensus extraction pipeline

2. **Database integration**:
   - Discussion Manager → SQLite read/write cycle
   - Concurrent write isolation (two discussions writing messages simultaneously)

3. **SSE + Transcript Manager integration**:
   - Message is persisted → SSE event is emitted → client receives it

4. **End-to-end module chain** (without UI):
   - Create discussion → Generate experts → Start engine → Produce N messages → Stop → Get summary

### 4.6 E2E Tests — Missing Scenarios

The TDD lists the happy path but misses:

1. **Error recovery**:
   - LLM API is down during expert generation → user sees error, can retry
   - LLM API fails mid-discussion → discussion pauses gracefully, not crashes
   - Browser refresh mid-discussion → state is restored from database

2. **Concurrent discussions**:
   - Create discussion A, start it, create discussion B, start it → both run independently

3. **Edge cases**:
   - Expert count = 1 (smallest valid panel)
   - Expert count at maximum
   - Very short topic ("AI")
   - Topic in English (the UI is Chinese but topics could be in any language)

### 4.7 Test Infrastructure Gaps

1. **No test framework specified**: The TDD does not name a test runner (Jest? Vitest?) or assertion library.
2. **No LLM mocking strategy**: How will tests mock the DeepSeek API? A mock server? Fixture files? This is critical — without it, tests are slow, expensive, and non-deterministic.
3. **No test data factories**: Reusable helpers for creating test discussions, experts, and messages.
4. **No CI/CD mention**: How and when do tests run?

---

## 5. Development Plan

### Overview

The SDD proposes five phases. I am refining them into six concrete milestones with explicit deliverables and risk assessments. Each milestone should result in a working, testable increment — not just "infrastructure done."

---

### Milestone 1: Project Scaffolding & Database

**Goal**: Establish the development environment, project structure, and database layer. A developer can run the app locally (even if it does nothing useful yet).

**Deliverables**:
- Monorepo structure: `backend/`, `frontend/`, `tests/`, `prompts/`
- Backend: Express server with TypeScript, dotenv for config, health-check endpoint (`GET /api/health`)
- Frontend: Vite + React + TypeScript scaffold, routing (react-router), empty page shells
- Database: SQLite schema (per the revised model in Section 3.4), migration script, seed script
- Database access layer with basic CRUD operations, tested
- ESLint + Prettier config shared across packages
- `README.md` with setup instructions

**Risks**:
- Low risk overall. Tooling compatibility (Windows + Node + native SQLite bindings) is the main concern.

**Suggested Git Commits**:
1. `feat: scaffold monorepo with backend, frontend, and tests directories`
2. `feat: add Express server with health-check endpoint`
3. `feat: add Vite + React + TypeScript frontend scaffold`
4. `feat: add SQLite schema and database access layer`
5. `chore: add ESLint and Prettier configuration`

---

### Milestone 2: Discussion CRUD & Expert Generation

**Goal**: A user can create a discussion, and the system generates a moderator + expert panel from the LLM. The panel is displayed for user confirmation.

**Deliverables**:
- `POST /api/discussions` — create a discussion (persists to DB)
- `GET /api/discussions/:id` — retrieve discussion info
- `GET /api/discussions` — list all discussions (for landing page)
- `POST /api/discussions/:id/experts` — call LLM, generate panel, persist experts
- `GET /api/discussions/:id/experts` — retrieve generated panel
- LLM service abstraction (so the rest of the system never calls the API directly)
- Prompt template for expert generation (stored in `prompts/`)
- LLM response parser with validation and error handling
- Landing page (list discussions, create new)
- Create Discussion page (topic + expert count inputs)
- Panel Confirmation page (display generated experts, confirm button)
- Unit tests for Discussion Manager and Expert Generator
- API tests for all endpoints (happy path + error cases)
- Mock LLM for deterministic testing

**Risks**:
- **LLM output quality**: The expert generator prompt must consistently produce diverse, well-formed panelists. Mitigation: iterate on the prompt with a suite of test topics; validate output schema strictly; have fallback logic for parse failures.
- **LLM API reliability**: The DeepSeek API may be slow or unavailable. Mitigation: set reasonable timeouts (e.g., 30s); show loading state in UI; implement retry with exponential backoff (max 2 retries).

**Suggested Git Commits**:
1. `feat: add discussion CRUD API endpoints`
2. `feat: add expert generation via LLM with prompt template`
3. `feat: add landing page and create-discussion flow`
4. `feat: add panel confirmation page`
5. `test: add unit and API tests for discussion and expert modules`

---

### Milestone 3: Real-time Discussion Engine

**Goal**: The Round Table Engine drives an autonomous discussion. Experts self-select to speak; messages are persisted and pushed to the frontend in real time via SSE. This is the core of the product.

**Deliverables**:
- Agent state machine implementation with all transitions and validation
- Round Table Engine core loop:
  - Moderator opening statement
  - Expert self-selection (each expert evaluates context → decides whether to speak)
  - Scheduling algorithm (select best candidate from READY experts)
  - Speaker produces message (via LLM call)
  - Speaker enters COOLDOWN
  - Moderator intervention logic (steer, question, wrap-up)
- Discussion termination logic (e.g., moderator decides after N messages or natural conclusion)
- SSE endpoint: `GET /api/discussions/:id/events`
  - Pushes `expert_status_update`, `message_created`, `consensus_updated` events
- Transcript Manager: persist messages, serve via API and SSE
- Context window management: transcript summarisation when approaching token limit
- Studio page — three-column layout:
  - Left: Expert status cards (real-time state updates)
  - Center: Transcript (real-time messages, auto-scroll)
  - Right: Consensus/disagreement panel (placeholder, live data in M4)
- Unit tests for state machine, scheduling algorithm, context management
- Integration tests: Engine → Message → SSE pipeline
- API tests for SSE connection and event delivery

**Risks**:
- **Scheduling algorithm tuning**: Getting the balance right — avoiding monopolisation, ensuring diversity, keeping the discussion flowing — will require iterative tuning. Mitigation: extract the scoring function as a configurable, testable module.
- **LLM latency accumulation**: Each message requires at least one LLM call (for the speaker), plus potentially calls for other experts evaluating context. A 10-message discussion with 4 experts could mean 40+ LLM calls. Mitigation: parallelise expert context evaluation; set aggressive timeouts; show progress indicators.
- **Context window overflow**: Transcripts grow linearly. Mitigation: implement a sliding window with summarisation of older messages; this must be implemented in M3, not deferred.
- **SSE connection management**: Dropped connections, client navigation away, multiple browser tabs. Mitigation: SSE auto-reconnect; heartbeat events; clean up stale connections server-side.

**Suggested Git Commits**:
1. `feat: implement agent state machine with transitions`
2. `feat: implement Round Table Engine core loop and scheduling`
3. `feat: add SSE endpoint for real-time event streaming`
4. `feat: add Transcript Manager with persistence`
5. `feat: add Studio page with three-column layout`
6. `feat: wire up real-time transcript and expert status updates in UI`
7. `test: add unit and integration tests for discussion engine`

---

### Milestone 4: Consensus Analysis & Summary

**Goal**: The Consensus Analyzer runs alongside the discussion, continuously updating consensus/disagreement. The moderator delivers a natural wrap-up and the system produces a final summary.

**Deliverables**:
- Consensus Analyzer module:
  - Triggered after every N messages (configurable, default: after every 3 messages or when a significant shift is detected)
  - Calls LLM to extract current consensus points and disagreement points
  - Persists to `summaries` table with versioning
  - Pushes `consensus_updated` events via SSE
- Right panel in Studio: displays live consensus and disagreement, updating in real time
- Moderator wrap-up logic: triggered by termination condition; moderator issues closing statement
- Final summary generation: compiles full consensus/disagreement into a structured, readable summary
- Summary page: displays final results after discussion ends
- Unit tests for Consensus Analyzer
- Integration tests for full discussion → summary pipeline

**Risks**:
- **Consensus quality**: LLM may produce vague or contradictory consensus statements. Mitigation: carefully design the analysis prompt; validate output structure; consider running the analyser less frequently but with more context for better quality.
- **Perceived latency**: If consensus analysis takes 5-10 seconds, users may think it's broken. Mitigation: show a "正在分析共识…" (analysing consensus…) loading state; run analysis asynchronously so it doesn't block message generation.

**Suggested Git Commits**:
1. `feat: implement Consensus Analyzer with LLM integration`
2. `feat: add live consensus/disagreement panel to Studio`
3. `feat: implement moderator wrap-up and final summary generation`
4. `feat: add summary page after discussion ends`
5. `test: add tests for consensus analysis and summary modules`

---

### Milestone 5: Multi-Discussion Isolation & Robustness

**Goal**: The system reliably handles multiple concurrent discussions, survives page refreshes, and gracefully handles errors.

**Deliverables**:
- Per-discussion process isolation (each discussion runs as an independent async context)
- State recovery: on page refresh, the frontend queries the backend to restore:
  - Current transcript (all messages so far)
  - Current expert states
  - Current consensus/disagreement
  - Discussion status (running/completed)
- Reconnection: SSE auto-reconnect restores the event stream
- Error handling audit:
  - LLM API failures: retry with backoff; if exhausted, pause discussion with error state
  - Database errors: graceful degradation, user-visible error, no data loss
  - Malformed LLM responses: log, retry once, skip turn if persistent
- Concurrency test: 3 discussions running simultaneously, each with 4 experts
- Cross-discussion data isolation verification (API + SSE)

**Risks**:
- **SQLite concurrency**: SQLite supports only one writer at a time. With multiple discussions, write contention is possible. Mitigation: use WAL mode; keep write transactions short; if contention becomes real, consider a pool of per-discussion SQLite files or migration to PostgreSQL (post-MVP).
- **Resource usage**: N concurrent discussions = N × M expert agents evaluating context simultaneously. Mitigation: set a maximum concurrent discussion limit; document resource requirements.

**Suggested Git Commits**:
1. `feat: add per-discussion process isolation`
2. `feat: implement state recovery on page refresh`
3. `feat: add error handling and retry logic for LLM calls`
4. `fix: address concurrency issues and data isolation edge cases`
5. `test: add concurrent discussion isolation tests`

---

### Milestone 6: Polish, E2E Testing & Launch Readiness

**Goal**: The product is stable, well-tested end-to-end, and ready for users to try.

**Deliverables**:
- E2E test suite covering the full user workflow (Playwright or Cypress):
  - Create discussion → confirm panel → watch discussion → see consensus → discussion ends → view summary
  - Two concurrent discussions
  - Page refresh recovery
  - Error states (LLM unavailable)
- UI polish:
  - Consistent Chinese-language copy throughout
  - Loading states for all async operations
  - Empty states (no discussions yet, no messages yet)
  - Error states with actionable messages
  - Independent scrolling in all three Studio columns
- Performance review:
  - First contentful paint < 2s
  - SSE connection < 1s after entering Studio
  - Auto-scroll performance with 100+ messages
- Acceptance criteria checklist: verify all 11 AC sections from `ACCEPTANCE_CRITERIA.md`
- `README.md` finalised with setup, run, and troubleshooting instructions
- Documentation: prompt recording for key prompts used

**Risks**:
- **Low risk**: This milestone is about hardening, not new feature work.
- **Scope creep**: The temptation to add "just one more feature" before launch. Mitigation: strictly adhere to the acceptance criteria; new ideas go to a post-MVP backlog.

**Suggested Git Commits**:
1. `test: add E2E test suite with Playwright`
2. `style: polish UI loading, empty, and error states`
3. `perf: optimise initial load and SSE connection time`
4. `docs: finalise README and record key prompts`
5. `chore: verify all acceptance criteria`

---

## Summary of Key Decisions Needed

Before implementation begins, the following design decisions should be resolved:

| # | Decision | Recommendation | Urgency |
|---|----------|---------------|----------|
| 1 | SSE vs WebSocket | **SSE** — simpler, fits unidirectional push model | Before M3 |
| 2 | Discussion termination condition | **Moderator decides** after minimum N messages (configurable, default ~15-20) + natural conclusion signal | Before M3 |
| 3 | LLM context window strategy | **Sliding window** — keep last K messages in full; summarise older messages into a compressed context paragraph | Before M3 |
| 4 | Test framework | **Vitest** for unit/integration (same ecosystem as Vite); **Playwright** for E2E | Before M1 |
| 5 | Expert count limits | **Min 2, max 6** for MVP (recommended default: 4) | Before M2 |
| 6 | LLM timeout & retry | **30s timeout, max 2 retries with exponential backoff** (1s, 4s) | Before M2 |
| 7 | Maximum concurrent discussions | **3 per server instance** for MVP | Before M5 |

---

*End of design review. This document should be revisited and updated as implementation reveals new information.*
