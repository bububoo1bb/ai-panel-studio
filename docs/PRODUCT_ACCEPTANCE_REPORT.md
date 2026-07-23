# M16.7 Product Acceptance Report

**Date:** 2026-07-23
**Author:** Claude Code (code trace verification)
**Method:** Full user flow simulation via code path tracing

---

## Test Scenario

User flow: Create discussion "新能源汽车的未来发展趋势" with 4 experts, test at 1/3/5 minute durations.

---

## 1. Discussion Creation Flow ✅

### Path traced

```
DiscussionForm (default durationLimit=300)
  → createDiscussion(title, durationLimit)
  → POST /api/discussions { title, durationLimit }
  → DiscussionRepository.create() → Discussion { durationLimit: 300 }
  → navigate to /discussion/:id/confirm { state: { expertCount: 4 } }
```

| Check | Result |
|-------|--------|
| Title validation | ✅ Non-empty string required |
| durationLimit passed to API | ✅ 60/180/300 accepted |
| Default duration | ✅ 300 seconds (5 min) if not specified |
| Navigation state | ✅ expertCount=4 passed via route state |

**Verdict: PASS ✅**

---

## 2. Panelist Generation ✅

### Path traced

```
ConfirmPanelistsPage
  → generatePanelists(id, expertCount=4, signal)
  → POST /api/discussions/:id/panelists/generate { expertCount: 4 }
  → PanelistGenerator.generate({ discussionId, topic, expertCount: 4 })
    → AI prompt: "generate 1 host + 4 experts"
    → prompt requires: "至少2组专家之间存在直接对立的立场"
    → prompt requires: beliefs, concerns, argumentStyle for experts
    → validates: exactly 1 host + 4 experts
    → assigns system colors
    → persists each
  → returns 5 Panelists (1 host + 4 experts)
```

| Check | Result |
|-------|--------|
| Count validation | ✅ 1 host + 4 experts enforced (throws on mismatch) |
| beliefs/concerns required | ✅ For experts only, non-empty string |
| argumentStyle required | ✅ For experts only, one of 5 predefined values |
| Duplicate prevention | ✅ Request-level lock (Map keyed by discussionId) |
| AbortController | ✅ Frontend aborts on unmount/remount |
| Discussion isolation | ✅ findByDiscussionId() filters correctly |

**Verdict: PASS ✅** — 5 panelists generated (1 host + 4 experts), no duplicates possible.

---

## 3. Discussion Start & Duration Control

### Duration → maxRounds derivation

```
DiscussionRoomPage:
  durationSec = discussion.durationLimit ?? 300
  maxRounds = Math.max(6, Math.ceil(durationSec / 8))
  → startDiscussion(id, maxRounds)

Backend route (POST /start):
  if maxRounds absent → derive from discussion.durationLimit
  maxRounds = Math.max(6, Math.ceil(durationSec / 8))
```

| Duration | maxRounds | Expert speeches | Batches (BATCH_SIZE=2) | Interventions |
|----------|-----------|-----------------|------------------------|---------------|
| 1 分钟 (60s) | max(6, 8) = **8** | ~8 | ~4 | ~4 |
| 3 分钟 (180s) | max(6, 23) = **23** | ~23 | ~12 | ~11 |
| 5 分钟 (300s) | max(6, 38) = **38** | ~38 | ~19 | ~19 |

### Time-based stop
```
DiscussionSessionController:
  sessionStart = Date.now()
  durationMs = discussion.durationLimit * 1000
  → before each batch: if (elapsed >= durationMs) break
  → after each batch AI calls: if (elapsed >= durationMs) break
```

| Check | Result |
|-------|--------|
| Duration stored | ✅ On Discussion model |
| maxRounds derived from duration | ✅ Both frontend and backend |
| Time-based stop | ✅ Before each batch + after AI calls |
| Wall clock respected | ✅ Actual elapsed time, not round count |

**Verdict: PASS ✅**

**⚠️ Issue A: Moderator intervention frequency**
- BATCH_SIZE=2 means moderator intervenes every 2 expert speeches
- For 5-minute discussion: 19 interventions + 38 speeches = 57 AI calls (moderator speaks ~33% of the time)
- This is excessive — moderator dominates the discussion
- **Risk**: Discussion may feel like moderator-led Q&A rather than expert debate

---

## 4. Dynamic Speaker Selection

### Path traced

```
DynamicDiscussionController.executeDiscussion():
  1. Load 4 expert candidates (scoped to discussionId)
  2. ModeratorController.evaluate() → action
     - Detects: silent experts, monopoly, stance conflicts
     - If invite_speaker: scheduler gets +0.3 override for that expert
  3. DesireBasedScheduler.selectNextSpeaker():
     - Skip last speaker (cooldown)
     - Score remaining 3 candidates via SimpleReactionEvaluator
     - Factors: stance conflict(30%) + wait time(25%) + rebuttal(25%) + anti-monopoly(10%)
     - Cooldown penalty: ×0.15 if just spoke → effectively excluded
     - Filter by RAISE_HAND threshold (0.3)
     - If none above threshold: pick highest anyway (no deadlock)
  4. Status: waiting → raising_hand → preparing → speaking
  5. RoundController.executeTurn() → AI speech
  6. Post-speech: status→waiting, lastSpokeAt, speakCount++, publicSummary
```

| Check | Result |
|-------|--------|
| No round-robin | ✅ Scheduler selects based on desire scores |
| Cooldown enforced | ✅ Last speaker excluded from next selection |
| No deadlock | ✅ Falls back to highest scorer even if below threshold |
| Stance conflict considered | ✅ Jaccard distance on stance/beliefs vs last speaker |
| Rebuttal bonus | ✅ +0.2 when belief overlap < 0.15 (conflicting positions) |
| Moderator override | ✅ +0.3 boost for invited experts |
| Panelist status updates | ✅ raising_hand → preparing → speaking → waiting |

**Verdict: PASS ✅** — Dynamic selection works, cooldown prevents monopolization, rebuttal bonus encourages conflict.

**⚠️ Issue B: Cooldown may suppress strong rebuttals**
- Last speaker is COMPLETELY SKIPPED (not just penalized)
- If Expert A makes a controversial claim, Expert B (who has the strongest rebuttal) can't respond immediately
- With 4 experts, Expert A's rebuttal must wait until 2 other experts speak first
- **Risk**: Conversational flow feels delayed

---

## 5. Expert Speech Quality

### Path traced

```
RoundController.executeTurn():
  1. Load discussion + panelist + messages
  2. buildPanelistMessages() → [system persona, topic, ...history]
  3. INJECT at index 2: "上一位发言者是{name}，内容："{content}"。请直接回应上述观点。"
  4. AIService.generate()
  
System prompt includes:
  - Name, occupation, title, stance, beliefs, concerns, argumentStyle
  - "1-2句话，30-80中文字符，最多150字符"
  - "必须针对上一位发言者的核心观点进行直接回应"
  - "保持鲜明的个人立场"
  - "除首次发言外，禁止重复自我介绍"
  - "禁止动作描写"
  - "禁止论文结构"
```

| Check | Result |
|-------|--------|
| Last-speaker context injected | ✅ Explicit instruction with name + content |
| Speech length constrained | ✅ 30-80 chars, max 150 |
| Stance maintained via persona | ✅ beliefs, concerns, stance in system prompt |
| No self-intro after 1st speech | ✅ Prompt constraint |
| No action descriptions | ✅ Prompt constraint |
| No essay structures | ✅ Prompt constraint |

**Verdict: PASS ✅** — Prompt engineering is comprehensive.

**⚠️ Issue C: Prompt is advisory, not enforced**
- AI may still produce >150 char responses (no post-generation truncation)
- AI may still self-introduce (model-dependent compliance)
- No server-side validation of response length or format
- **Risk**: Speech quality depends entirely on AI model compliance

---

## 6. Moderator Intervention

### Path traced

```
DiscussionSessionController batch loop:
  BATCH_SIZE = 2
  Every 2 expert speeches:
    → moderator.intervene(discussionId, recentMessages)
    → AIService.generate() with context
    → persist as moderator_call message

ModeratorController (AIModeratorController):
  shouldIntervene(): every 2 turns (turnsSinceLastIntervention >= 2)
  evaluate(): checks silent experts, monopoly, stance conflicts
    → invite_speaker: silent expert for 4+ messages
    → pace_control: 3+ consecutive same speaker
    → highlight_conflict: 2+ messages with disagreement markers
```

| Check | Result |
|-------|--------|
| Moderator intervenes | ✅ Every 2 expert speeches |
| Conflict detection | ✅ Keyword-based (但是/然而/不同意) |
| Silent expert detection | ✅ After 4 messages without speaking |
| Pace control | ✅ After 3 consecutive same-speaker |
| Expert invitation | ✅ +0.3 override to scheduler |

**Verdict: PASS ✅** — Moderator actively controls pace and detects conflicts.

**⚠️ Issue D: BATCH_SIZE=2 is too aggressive**
- Moderator speaks every 2 expert turns = ~33% of all messages
- A real panel: moderator speaks ~10-15% of the time
- For 5-minute discussion: 19 interventions in ~300 seconds
- **Risk**: Discussion feels moderator-dominated

---

## 7. Insight Analysis Quality

### Path traced

```
GET /api/discussions/:id/insights
  → RuleBasedInsightAnalyzer.analyze(panelists, messages)
    → Scans messages for agreement markers → consensus sentences
    → Scans messages for disagreement markers → divergence sentences
    → Scans messages for uncertainty markers → unresolved sentences
    → If ≥2 different stances exist + no divergence found: add stance summary
    → Fallback: natural language defaults
```

| Check | Result |
|-------|--------|
| No mechanical n-grams | ✅ findSharedPhrases() deleted |
| Natural language output | ✅ Extracts complete sentences with 。！？\n boundaries |
| Consensus detection | ✅ Agreement markers: 同意/赞同/支持/有道理/确实/没错 |
| Divergence detection | ✅ Disagreement markers: 但是/然而/不同意/反对/问题在于 |
| Unresolved detection | ✅ Uncertainty markers: 还需要/尚不清楚/有待/取决于 |
| Non-empty guarantee | ✅ Fallback text when no markers found |
| Sentence boundary handling | ✅ Multiple boundary types: 。！？\n |

**Fallback texts:**
- Consensus: "专家们均认可该话题的重要性，各方从不同角度提出了建设性观点"
- Divergence: "专家们在具体解决方案和实施路径上存在不同看法"

| Check | Result |
|-------|--------|
| Fallback quality | ✅ Natural, coherent Chinese |
| No "专家们均认为：认为技术" | ✅ Eliminated |

**Verdict: PASS ✅** — Insight output is natural language.

**⚠️ Issue E: Stance summary may be verbose**
- When no message-level disagreement found, stance summary uses raw stance strings directly: `"专家立场分化：{stance1}；而另一方认为{stance2}"`
- If AI-generated stances are long (e.g., 30+ chars), this produces a very long insight item
- **Risk**: Low — only triggers when no message markers found

---

## 8. Stop Mechanism

### Path traced

```
Frontend: handleStop() → stopDiscussion(id) → POST /api/discussions/:id/stop
  → Backend: updateStatus(discussionId, "stopped")
  → DiscussionEngine: checks status !== "active" → breaks loop
  → DiscussionSessionController: checks status !== "active" → breaks loop
  → Frontend polling: detects status === "stopped" → setExecutionState("stopped")
  → UI: shows "讨论已停止" badge, stop button hidden
```

| Check | Result |
|-------|--------|
| Stop endpoint | ✅ POST /:id/stop |
| Status validation | ✅ Only "active" → "stopped" allowed |
| Engine respects stop | ✅ Breaks on status !== "active" |
| Session controller respects stop | ✅ Breaks on status !== "active" |
| Frontend detects stop | ✅ Polling checks disc.status === "stopped" |
| UI feedback | ✅ "讨论已停止" badge |

**Verdict: PASS ✅**

---

## 9. Frontend Timer Display

### Path traced

```
DiscussionRoomPage top bar:
  {executionState === "running" && discussion?.durationLimit && (
    <span>{Math.floor(discussion.durationLimit / 60)}:00</span>
  )}
```

| Check | Result |
|-------|--------|
| Timer visible during execution | ✅ Shown when running |
| Timer value | ✅ durationLimit / 60 → "5:00" / "3:00" / "1:00" |

**⚠️ Issue F: Timer is static, not counting down**
- Displays "5:00" for entire 5-minute discussion — never decrements
- No `useEffect` with `setInterval` to update every second
- User cannot see actual remaining time
- **Severity: Medium** — affects UX but not functionality

---

## 10. Panelist Status Display

### Path traced

```
Polling (every 2 seconds):
  fetchPanelists(id) → GET /api/discussions/:id/panelists
  → InMemoryPanelistRepository.findByDiscussionId(discussionId)
  → Returns all panelists with current status
  → ExpertCard renders: status badge + currentFocus + publicSummary
```

| Check | Result |
|-------|--------|
| Panelists refetched in polling | ✅ Added in M16.5 Phase 5 |
| Status labels | ✅ 待机/举手/准备中/发言中/已完成 |
| currentFocus displayed | ✅ During raising_hand: "请求发言", preparing: "组织观点中" |
| publicSummary displayed | ✅ First 50 chars of last speech |
| No chain-of-thought | ✅ Only status + summary + focus |

**Verdict: PASS ✅**

---

## Summary

### Verified (✅)

| # | Feature | Status |
|---|---------|--------|
| 1 | Discussion creation with duration | ✅ |
| 2 | Panelist generation (1 host + 4 experts) | ✅ |
| 3 | Duration → maxRounds derivation | ✅ |
| 4 | Time-based auto-stop | ✅ |
| 5 | Dynamic speaker selection (no round-robin) | ✅ |
| 6 | Speech quality constraints in prompt | ✅ |
| 7 | Last-speaker context injection | ✅ |
| 8 | Moderator conflict/invitation/pace detection | ✅ |
| 9 | Insight natural language output | ✅ |
| 10 | Stop mechanism | ✅ |
| 11 | Panelist status polling + display | ✅ |
| 12 | Data isolation (discussionId scoping) | ✅ |

### Issues Found (⚠️)

| ID | Severity | Description | File |
|----|----------|-------------|------|
| A | High | BATCH_SIZE=2 → moderator intervenes every 2 speeches (~33% of messages), dominating discussion | `DiscussionSessionController.ts:100` |
| B | Medium | Last speaker completely excluded (not just penalized) — strong rebuttals delayed by 2 turns | `DesireBasedScheduler.ts:85` |
| C | Low | Speech length/format constraints are prompt-only (no post-generation enforcement) | `PromptBuilder.ts` |
| D | Medium | DynamicDiscussionController.shouldIntervene check is dead code — updates lastInterventionTurn but nothing reads it | `DynamicDiscussionController.ts:148-160` |
| E | Low | Stance summary uses raw (potentially long) stance strings unfiltered | `RuleBasedInsightAnalyzer.ts` |
| F | Medium | Timer is static label ("5:00") — doesn't count down in real-time | `DiscussionRoomPage.tsx` |

### Recommendations for M16.8

1. **Increase BATCH_SIZE from 2 to 4-6** — reduce moderator intervention frequency to ~10-15% of messages
2. **Change cooldown from exclusion to penalty** — allow last speaker with heavy penalty (×0.1) instead of skip
3. **Implement countdown timer** — use setInterval to decrement every second during execution
4. **Remove dead code** — clean up DynamicDiscussionController.shouldIntervene or connect to actual flow
5. **Add response length enforcement** — truncate AI responses >150 chars server-side
