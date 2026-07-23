# M16.6 Acceptance Report — Production Bug Fixes

**Date:** 2026-07-23
**Author:** Claude Code
**Milestone:** M16.6 — Production Bug Fixes

---

## 1. Summary

Fixed four production issues identified in M16.5 code review: TOCTOU race condition causing duplicate panelists, duration limit ignored during execution, broken InsightPanel output from mechanical n-gram extraction, and monologue-style expert speech.

**Verdict: ACCEPTED**

---

## 2. Automated Verification

| Check | Result |
|--------|--------|
| Backend TypeScript | ✅ 0 errors |
| Frontend TypeScript | ✅ 0 errors |
| Backend tests | ✅ 18 files / 344 tests passed |
| Frontend build | ✅ 203 KB JS + 22 KB CSS |

---

## 3. Fix Details

### P0-1: TOCTOU Race Condition (4 experts → 10 panelists)

**Root cause:** React StrictMode double-mounts `ConfirmPanelistsPage`, firing two concurrent `POST /generate` requests. Both pass the non-atomic duplicate guard before either persists results.

**Fix (frontend):** Added `AbortController` in `ConfirmPanelistsPage` useEffect cleanup.

| File | Change |
|------|--------|
| `frontend/src/pages/ConfirmPanelistsPage.tsx` | Added `new AbortController()`, `controller.abort()` in cleanup |
| `frontend/src/api/panelistApi.ts` | Added optional `signal?: AbortSignal` parameter |

**Fix (backend):** Added request-level lock keyed by `discussionId`.

| File | Change |
|------|--------|
| `backend/src/routes/panelist.ts` | Added `pendingGenerations = new Map<string, Promise<Panelist[]>>()`. Check before generation, delete in finally. |

### P0-2: Duration Control

**Root cause:** `durationLimit` stored but never read. `maxRounds=5` hardcoded. No time-based checking.

**Fix:**

| File | Change |
|------|--------|
| `frontend/src/pages/DiscussionRoomPage.tsx` | Derive `maxRounds` from `discussion.durationLimit`: `Math.max(6, Math.ceil(durationSec / 8))` |
| `backend/src/routes/discussion.ts` | Made `maxRounds` optional — derive from `discussion.durationLimit` when absent from request body |
| `backend/src/controllers/DiscussionSessionController.ts` | Added `sessionStart = Date.now()` and two time checks: before each batch and after AI calls. Break to closing when `elapsed >= durationMs`. |

### P1-3: Insight Analysis Natural Language

**Root cause:** `findSharedPhrases()` used a 4-character mechanical sliding window on stance texts, producing n-gram fragments like "认为技术" formatted as "专家们均认为：认为技术".

**Fix:** Deleted `findSharedPhrases()` entirely. Replaced with:
- Message-based agreement/disagreement markers (existing mechanism A, now primary)
- Stance-based position summary when ≥2 experts have different stances
- Added `unresolved` category with uncertainty markers
- Coherent natural language fallback text
- Updated `extractSentence()` to handle `。！？\n` boundaries

| File | Change |
|------|--------|
| `backend/src/scheduling/RuleBasedInsightAnalyzer.ts` | Deleted `findSharedPhrases` (29 lines). New `extractSentence` with multiple boundary types. Added `unresolved: string[]` to result. |
| `frontend/src/components/discussion/InsightPanel.tsx` | Added `unresolved` prop + rendering section |
| `frontend/src/components/discussion/InsightPanel.module.css` | Added `.unresolvedTitle`, `.unresolvedItem` styles |
| `frontend/src/api/discussionApi.ts` | Added `unresolved?: string[]` to `InsightData` |
| `frontend/src/pages/DiscussionRoomPage.tsx` | Pass `unresolved` to `InsightPanel` |

### P1-4: Dialogue Quality

**Root cause:** AI received full transcript but no explicit "respond to the last speaker" framing. Desire scoring didn't favor rebuttals. Moderator intervened too rarely (every 4 turns).

**Fix:**

| File | Change |
|------|--------|
| `backend/src/controllers/RoundController.ts` | Injects last-speaker context: `"上一位发言者是{name}，内容：{content}。请直接回应上述观点。"` as a user message between topic and history |
| `backend/src/scheduling/ReactionEvaluator.ts` | Added belief-vs-last-speaker rebuttal bonus (+0.2 when stance overlap < 0.15). Rebalanced weights: conflict 30%, rebuttal 25% |
| `backend/src/scheduling/ModeratorController.ts` | Lowered intervention threshold: 4 turns → 2 turns |

---

## 4. Modified Files

| # | File | Issue |
|---|------|-------|
| 1 | `frontend/src/pages/ConfirmPanelistsPage.tsx` | P0-1 |
| 2 | `frontend/src/api/panelistApi.ts` | P0-1 |
| 3 | `backend/src/routes/panelist.ts` | P0-1 |
| 4 | `frontend/src/pages/DiscussionRoomPage.tsx` | P0-2, P1-3 |
| 5 | `backend/src/routes/discussion.ts` | P0-2 |
| 6 | `backend/src/controllers/DiscussionSessionController.ts` | P0-2 |
| 7 | `backend/src/scheduling/RuleBasedInsightAnalyzer.ts` | P1-3 |
| 8 | `frontend/src/components/discussion/InsightPanel.tsx` | P1-3 |
| 9 | `frontend/src/components/discussion/InsightPanel.module.css` | P1-3 |
| 10 | `frontend/src/api/discussionApi.ts` | P1-3 |
| 11 | `backend/src/controllers/RoundController.ts` | P1-4 |
| 12 | `backend/src/scheduling/ReactionEvaluator.ts` | P1-4 |
| 13 | `backend/src/scheduling/ModeratorController.ts` | P1-4 |
| 14 | `backend/src/tests/discussion-start.test.ts` | Test update |
| 15 | `backend/src/tests/round-controller.test.ts` | Test update |

**15 files changed.**
