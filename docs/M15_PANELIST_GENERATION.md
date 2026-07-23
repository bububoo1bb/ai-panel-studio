# M15 — AI-Generated Panelist System

## Summary

Implemented the AI-powered panelist generation pipeline. When a user creates a discussion with a topic and expert count, the backend calls the LLM (DeepSeek or Mock) to generate a diverse panel of 1 moderator + N experts, parses the structured JSON response, assigns visual identity colors, persists to the repository, and returns the panelists to the frontend for user confirmation.

## Architecture

```
User request (topic + expertCount)
        │
        ▼
POST /api/discussions/:id/panelists/generate
        │
        ▼
PanelistGenerator.generate()
        │
        ├─ 1. Validate discussion exists
        ├─ 2. Validate expertCount (2–8)
        ├─ 3. buildPanelistGenerationMessages(topic, expertCount)
        ├─ 4. AIService.generate(messages)
        ├─ 5. parsePanelistGenerationResponse(rawText)
        ├─ 6. Validate & convert each entry
        ├─ 7. Assign system colors (palette)
        ├─ 8. PanelistRepository.create() × N
        └─ 9. Return Panelist[]
        │
        ▼
Frontend ConfirmPanelistsPage
  → User confirms → Navigate to /discussion/:id
```

## Files Created

| File | Purpose |
|---|---|
| `backend/src/services/PanelistGenerator.ts` | Service that orchestrates AI panelist generation |
| `backend/src/services/parsePanelistGenerationResponse.ts` | Robust JSON parser for AI responses (handles fences, surrounding text, balanced brackets) |
| `backend/src/tests/panelist-generator.test.ts` | 27 tests covering the full pipeline |

## Files Modified

| File | Change |
|---|---|
| `backend/src/ai/PromptBuilder.ts` | Added `buildPanelistGenerationSystemPrompt()` and `buildPanelistGenerationMessages()` — system prompt instructing AI to output structured JSON panelist array |
| `backend/src/routes/panelist.ts` | Added optional `PanelistGenerator` parameter; mounted `POST /generate` endpoint with full input validation |
| `backend/src/app.ts` | Added `PanelistGenerator` to `AppDependencies`; auto-creates from `AIService` + repos; passes to panelist router |
| `frontend/src/api/panelistApi.ts` | Added `generatePanelists()` function calling the new endpoint |
| `frontend/src/pages/ConfirmPanelistsPage.tsx` | Replaced demo data generation with real API call; added loading/error states |
| `frontend/src/pages/ConfirmPanelistsPage.module.css` | Added status container, icon, hint, and error styles |

## Design Decisions

### Prompt Design
The system prompt instructs the AI to:
- Act as a "roundtable discussion producer"
- Output ONLY valid JSON (no markdown, no commentary)
- Generate 1 host (neutral facilitator) + N experts (diverse perspectives)
- Use realistic Chinese names, specific occupations/titles, distinct stances
- All text in Chinese

### Color Assignment
Colors are **system-assigned** (not AI-generated). A deterministic 9-color palette is applied in insertion order — the AI cannot influence visual identity. This ensures:
- Valid CSS hex colors
- High contrast between panelists
- Deterministic behavior in tests

### JSON Parsing Resilience
The parser handles three common AI output patterns:
1. Pure JSON: `[{...}, {...}]`
2. Markdown-fenced: ` ```json [...]``` `
3. JSON with surrounding text (extracts via balanced bracket tracking)

### API Validation
The `/generate` endpoint validates:
- `expertCount`: required, must be an integer between 2–8
- Discussion existence (404 if not found)
- AI parse failures → 422 with descriptive error
- Unexpected errors → 500 (logged server-side)

### Existing Architecture Preserved
- `PanelistGenerator` follows the same constructor-injection pattern as `DiscussionEngine`
- Depends only on abstractions (`AIService`, `DiscussionRepository`, `PanelistRepository`)
- Routes follow the same factory-function pattern as existing routes
- Test file follows the same `createTestApp` helper pattern as existing tests
- No changes to domain models, controllers, repositories, or lifecycle modules

## Test Results

| Suite | Tests | Status |
|---|---|---|
| `panelist-generator.test.ts` (new) | 27 | ✅ All pass |
| All other backend tests (14 suites) | 281 | ✅ All pass |
| **Total** | **308** | ✅ |

### Test Coverage (PanelistGenerator)

- **Success**: generates panelists, persists to repo, assigns colors, generates UUIDs, isolates per discussion
- **Validation**: non-existent discussion, non-number expertCount, non-integer, < 2, > 8
- **AI response**: unparseable text, missing fields, invalid roles, markdown fences, whitespace trimming
- **Prompt**: verifies correct system + user messages sent to AIService
- **API**: 201 success, 404 missing discussion, 400 invalid input, 422 unparseable AI response

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` (frontend) | ✅ Pass |
| `tsc -b && vite build` (frontend) | ✅ 69 modules, 199 KB JS + 19 KB CSS |
| `vitest run` (backend 308 tests) | ✅ 15 test files, all pass |
| Backend architecture unchanged | ✅ Domain, controllers, repositories unchanged |

## Future Work

- The mock AI always returns the same 3 panelists — in production with DeepSeek, each topic gets unique, topic-relevant experts
- Consider adding a retry mechanism for AI parse failures (with backoff)
- Could add a "regenerate" endpoint if user doesn't like the generated panel
