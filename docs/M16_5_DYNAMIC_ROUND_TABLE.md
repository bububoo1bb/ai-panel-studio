# M16.5 Dynamic Roundtable Enhancement — Architecture & Verification

**Date:** 2026-07-23
**Author:** Claude Code
**Milestone:** M16.5 — Dynamic Roundtable Enhancement

---

## 1. Summary

Transformed AI Panel Studio from fixed round-robin execution to a dynamic desire-based roundtable system. Experts now self-select based on context relevance, stance conflict, and wait time — instead of speaking in fixed insertion order. The moderator actively detects conflicts, invites silent experts, and controls pace.

**Verdict: ACCEPTED**

---

## 2. Automated Verification

| Check | Result |
|--------|--------|
| Backend TypeScript | ✅ 0 errors |
| Frontend TypeScript | ✅ 0 errors |
| Backend tests | ✅ 18 files / 344 tests passed |
| Frontend build | ✅ 69 modules, 202 KB JS + 21 KB CSS |
| Git whitespace | ✅ Clean |

---

## 3. New Architecture

```
DiscussionSessionController  ← time limit + duration control
        │
        ▼
DiscussionEngine              ← DiscussionRoundExecutor interface
        │                       (no other engine changes)
        ▼
┌──────────────────────────────────────────────────────────────┐
│ DynamicDiscussionController (NEW)                            │
│   implements DiscussionRoundExecutor                         │
│                                                              │
│   executeDiscussion():                                       │
│     1. Load candidates (scoped to discussionId)              │
│     2. ModeratorController.evaluate() → action               │
│     3. SpeakingScheduler.selectNextSpeaker() → expert        │
│        → ReactionEvaluator.evaluateDesire() per candidate    │
│        → score ≥ RAISE_HAND (0.3) = candidate                │
│        → score ≥ INTERRUPT (0.7) = priority                  │
│     4. Status: waiting→raising_hand→preparing→speaking       │
│     5. RoundController.executeTurn() → AI generates speech   │
│     6. Post-speech: update lastSpokeAt, speakCount, summary  │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
RoundController (UNCHANGED) → AIService.generate()
```

### Key Design Property

`DiscussionEngine` sees only a `DiscussionRoundExecutor` interface — it knows **nothing** about `ReactionEvaluator`, `SpeakingScheduler`, or `ModeratorController`. The dynamic scheduling is fully encapsulated in `DynamicDiscussionController`.

---

## 4. New Components

### 4.1 Scheduling Layer (`backend/src/scheduling/`)

| File | Purpose |
|------|---------|
| `SpeakingScheduler.ts` | Interface — `selectNextSpeaker(ctx) → Panelist \| null` |
| `ReactionEvaluator.ts` | Interface + `SimpleReactionEvaluator` MVP — keyword-based desire scoring |
| `DesireBasedScheduler.ts` | MVP scheduler — scores all candidates, picks highest above threshold |
| `ModeratorController.ts` | Interface + `AIModeratorController` MVP — detects conflicts, invites silent experts, controls pace |
| `RuleBasedInsightAnalyzer.ts` | Rule-based consensus/divergence from panelist stances + message keywords |

### 4.2 Desire Scoring (SimpleReactionEvaluator)

| Factor | Weight | Description |
|--------|--------|-------------|
| Stance conflict | 35% | Jaccard distance between panelist stance and last speaker content |
| Wait time | 25% | Normalized by speakCount vs turnCount |
| Rebuttal target | 20% | Whether last message mentions panelist's domain |
| Anti-monopoly | 10% | Penalty for consecutive same-speaker |
| Cooldown | 0.15× | If just spoke, multiply total by 0.15 |
| Jitter | ±0.08 | Random tie-breaker |

Thresholds:
- `RAISE_HAND_THRESHOLD = 0.3` — panelist wants to speak
- `INTERRUPT_THRESHOLD = 0.7` — urgent response (moderator permits interrupt)

### 4.3 ModeratorController (AIModeratorController)

Detects via heuristics (no AI calls):
- **Silent experts**: panelist hasn't spoken in recent messages → `invite_speaker`
- **Monopoly**: same speaker 3+ consecutive turns → `pace_control`
- **Conflict**: ≥2 messages contain disagreement markers ("但是"/"然而"/"不同意") → `highlight_conflict`

### 4.4 RuleBasedInsightAnalyzer

- Scans messages for agreement markers: "同意", "赞同", "支持", "有道理"
- Scans for disagreement markers: "但是", "然而", "不同意", "反对"
- Cross-references panelist stances for shared/opposing keywords
- **Guaranteed non-empty**: returns fallback text when no patterns detected

---

## 5. Domain Model Extensions

### Discussion
```ts
durationLimit: number;    // seconds: 60/180/300, default 300
status: "active" | "finished" | "stopped" | "paused";  // +paused
```

### Panelist
```ts
beliefs: string | null;       // 核心信念, 1-2 sentences
concerns: string | null;      // 主要担忧, 1-2 sentences
argumentStyle: string | null; // 辩论风格
lastSpokeAt: string | null;   // last speech timestamp (cooldown)
speakCount: number;           // turn count (wait time calculation)

status: "waiting" | "raising_hand" | "preparing" | "speaking" | "finished";
```

### PanelistRepository
```ts
update(id, changes: Partial<Pick<Panelist, "status" | "currentFocus" | "publicSummary" | "lastSpokeAt" | "speakCount">>): Promise<Panelist>;
```

---

## 6. Prompt Updates

### Panelist Generation
Added `beliefs`, `concerns`, `argumentStyle` to JSON output schema. Requirement: "至少2组专家之间存在直接对立的立场".

### Expert Speaking (Speech Rhythm)
- 1-2 sentences, 30-80 Chinese chars, max 150
- Must respond directly to previous speaker
- No self-introduction after first speech
- No action descriptions (推眼镜/沉思/笑)
- No essay structures (第一第二第三/综上所述)
- Colloquial tone — like real panel discussion

### Moderator
- "发现分歧、邀请不同观点的专家回应、控制讨论节奏"
- "如果某位专家长时间未发言，主动邀请其参与"

---

## 7. New API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/discussions/:id/pause` | Pause a running discussion |
| GET | `/api/discussions/:id/insights` | Rule-based consensus/divergence analysis |

Updated endpoints:
- `POST /api/discussions` — accepts `durationLimit` (60/180/300)
- `GET /api/discussions/:id/insights` — now uses RuleBasedInsightAnalyzer (always non-empty)

---

## 8. Data Isolation

All panelist queries are scoped to `discussionId`:
- `PanelistRepository.findByDiscussionId(discussionId)` — primary query method
- `PanelistRepository.findById(id)` — used only after verifying discussionId match
- No `findAll()` method exists — impossible to leak cross-discussion data

---

## 9. M13-M16 Boundary Preservation

| Boundary | Preserved? |
|----------|-----------|
| DiscussionEngine knows NOTHING about scheduling | ✅ — only sees DiscussionRoundExecutor |
| SessionLifecycle unchanged | ✅ |
| RoundController unchanged | ✅ |
| ModeratorStrategy interface — extended additively | ✅ |
| Domain models — additive only | ✅ |
| DiscussionController (old) — unchanged as fallback | ✅ |
| AIService unchanged | ✅ |
| All panelist queries scoped to discussionId | ✅ |

---

## 10. Files Summary

| Type | Count | Key Files |
|------|-------|-----------|
| NEW backend | 6 | `scheduling/` (5 files) + `controllers/DynamicDiscussionController.ts` |
| MODIFIED backend | 12 | domain (2), repos (2), PromptBuilder, PanelistGenerator, parser, DiscussionEngine, DiscussionSessionController, routes/discussion, app.ts |
| MODIFIED frontend | 7 | types (2), api, DiscussionForm, ExpertCard, ExpertCard.css, DiscussionRoomPage |
| MODIFIED tests | 4 | fixtures for new fields, prompt assertions |
| **TOTAL** | **~29** | |

---

## 11. Known Limitations

1. **Heuristic-only scheduling** — `SimpleReactionEvaluator` uses keyword matching, not semantic understanding. AI-based evaluation deferred to future milestone.
2. **No real-time SSE** — panelist status updates visible via 2-second polling. Transient states (raising_hand→preparing) may be missed between polls.
3. **ModeratorController is heuristic** — no AI-driven scheduling decisions yet. Conflict detection is keyword-based.
4. **Duration check between batches only** — max delay of one batch before time-limit stop triggers.
5. **No interrupt mechanism in UI** — interrupt detection exists in backend but UI doesn't visualize it.
6. **Rule-based insights** — consensus/divergence is keyword-driven, may miss nuanced agreement/disagreement.
