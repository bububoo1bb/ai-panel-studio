# Prompt 15 — AI Generated Panelist System

**Stage:** Implementation Phase — Milestone 15

**Date:** 2026-07-23

---

# Goal

Implement the AI-powered panelist generation pipeline so that when a user provides a discussion topic and expert count, the system calls the LLM to dynamically generate a diverse panel of 1 moderator + N experts, parses the structured response, persists the panelists, and presents them to the frontend for user confirmation.

Previous limitation: the frontend used hardcoded demo panelist data. The confirmation page always showed the same 8 fixed experts regardless of the discussion topic. There was no connection between the user's topic and the generated panelists. The AI roundtable had no dynamic participant generation — the system could create discussions and execute turns, but the experts themselves were not AI-generated.

M15 bridges this gap:

```
M14 Frontend Implementation
        ↓
M15 AI Generated Panelists   ← THIS MILESTONE
        ↓
Future Discussion Execution
```

Without M15, the discussion engine runs with whatever panelists happen to exist in the repository — but there is no mechanism to create topic-relevant, diverse panelists automatically.

---

# Context

Before implementation, Claude Code was instructed to read:

- CLAUDE.md
- docs/PRD.md — §4.3 AI 嘉宾生成 requirements
- docs/SDD.md — §3.2 Expert Generator module, §5 API design
- docs/DDD.md — §2.3 嘉宾确认页面 design
- docs/TDD.md — §2.2 Expert Generator tests
- docs/ACCEPTANCE_CRITERIA.md — AC-03 嘉宾生成 criteria
- docs/M14_FRONTEND_IMPLEMENTATION.md — current frontend state
- All existing Prompt Records for style reference
- backend/package.json
- backend/src/domain/panelist.ts — Panelist, PanelistRole, PanelistStatus, CreatePanelistInput
- backend/src/domain/discussion.ts — Discussion
- backend/src/ai/AIService.ts — provider-independent interface
- backend/src/ai/PromptBuilder.ts — existing prompt construction patterns
- backend/src/ai/types.ts — AIMessage, GenerateAIRequest, GenerateAIResponse
- backend/src/ai/MockAIService.ts — test double with request recording
- backend/src/ai/DeepSeekAIService.ts — production implementation
- backend/src/ai/createAIService.ts — provider factory
- backend/src/repositories/PanelistRepository.ts — persistence interface
- backend/src/repositories/InMemoryPanelistRepository.ts — implementation
- backend/src/repositories/DiscussionRepository.ts — discussion lookup
- backend/src/routes/panelist.ts — existing CRUD routes (GET /, POST /)
- backend/src/app.ts — dependency injection / composition root
- backend/src/config/AppConfig.ts — configuration model
- backend/src/services/DiscussionEngine.ts — service layer pattern reference
- backend/src/lifecycle/SessionLifecycle.ts — lifecycle pattern reference
- backend/src/controllers/RoundController.ts — turn execution reference
- backend/src/tests/panelist.test.ts — existing test patterns
- frontend/src/api/panelistApi.ts — current API layer with TODO for /generate
- frontend/src/pages/ConfirmPanelistsPage.tsx — demo data that needs replacement
- frontend/src/types/panelist.ts — frontend type definitions

The backend already supported:

- `AIService` interface with `MockAIService` (test) and `DeepSeekAIService` (production)
- `PanelistRepository` with `create()`, `findById()`, `findByDiscussionId()`
- `DiscussionRepository` with `findById()` and `findAll()`
- `PromptBuilder` with `buildPanelistSystemPrompt()` and `buildPanelistMessages()` for discussion turns
- `createAIService` factory and `loadAppConfig` for provider selection
- Express application with constructor-based dependency injection via `createApp(dependencies?)`
- `DiscussionEngine`, `DiscussionSessionController`, `RoundController` — execution hierarchy
- Vitest test infrastructure with in-memory repository test doubles
- 281 tests across 14 test files, all passing

The frontend already had:

- `ConfirmPanelistsPage` at `/discussion/:id/confirm` using hardcoded demo data
- `panelistApi.ts` with `fetchPanelists()` and a TODO comment for the /generate endpoint
- Typed `Panelist` interface matching the backend domain model
- React Router with routes: `/`, `/create`, `/discussion/:id/confirm`, `/discussion/:id`

The existing panelist routes (`GET /`, `POST /`) supported manual CRUD but had no AI generation capability. The `PromptBuilder` supported building prompts for panelists to speak in discussions, but had no prompt for generating the panelists themselves.

---

# Prompt

The implementation was preceded by a codebase inspection phase where Claude Code read all relevant files — backend domain models, AI service layer, repositories, routes, app composition root, test patterns, frontend pages, and API layer. No design proposal was required because the architecture followed established patterns from previous milestones.

The implementation prompt specified:

```
M15 — AI Generated Panelist System

Based on PRD:
User inputs topic and expert number.
System calls DeepSeek.
Generate moderator and expert panelists.

Need:
- new service abstraction
- repository integration
- API endpoint
- frontend integration
- tests

Do not break existing architecture.
Follow SDD/DDD/TDD.
```

The implementation was structured across five layers:

1. **Prompt Engineering** — add generation prompt to `PromptBuilder.ts`
2. **Service** — create `PanelistGenerator` service following `DiscussionEngine` pattern
3. **Route** — add `POST /generate` endpoint to panelist routes
4. **App Wiring** — inject `PanelistGenerator` into `createApp`
5. **Frontend** — replace demo data with real API call

Each layer was implemented and verified before the next layer began.

---

# Design Decision

### AI Responsibility vs. System Responsibility

A fundamental design question was: what should the AI control, and what should the system control?

**AI generates** (creative, topic-dependent):

- Panelist identity (name, occupation, title)
- Stance / viewpoint on the topic
- Diversity of perspectives across experts

**System controls** (deterministic, integrity-critical):

- Validation of input parameters
- Persistence (IDs, timestamps, discussion association)
- Visual identity colors (CSS hex values from a fixed palette)
- Data integrity (required fields, type checking)
- Error handling and API response codes

The reasoning: if the AI generates colors, it could produce invalid hex codes, duplicate colors, or low-contrast values that break visual identity. If the AI generates IDs, they could collide or violate UUID format. System-assigned colors guarantee valid, distinct, high-contrast visual markers for each panelist — exactly what DDD.md §2.3 requires ("每位专家具有专属视觉标识").

### Service Design: Following DiscussionEngine Pattern

`PanelistGenerator` was designed as a service in `backend/src/services/`, following the same constructor-injection pattern as `DiscussionEngine`:

```ts
export class PanelistGenerator {
  constructor(deps: {
    aiService: AIService;
    discussionRepository: DiscussionRepository;
    panelistRepository: PanelistRepository;
  }) { ... }
}
```

The service depends only on abstractions — never on concrete implementations. This enables:
- Testing with `MockAIService` and in-memory repositories
- Swapping AI providers without changing the service
- Isolated unit tests without Express or HTTP

### Route Design: Optional Generator Injection

The existing `createPanelistRouter` factory took two repository parameters. Rather than creating a separate router or duplicating the factory, the generator was added as an optional third parameter:

```ts
export function createPanelistRouter(
  panelistRepository: PanelistRepository,
  discussionRepository: DiscussionRepository,
  panelistGenerator?: PanelistGenerator,
): Router
```

When the generator is provided, `POST /generate` is mounted. When absent (e.g., in tests that don't need generation), the endpoint simply doesn't exist. This preserves backward compatibility — all existing panelist tests continue to work without modification.

### Frontend: Removing Demo Data

The `ConfirmPanelistsPage` previously contained a 70-line `generateDemoPanelists()` function with 8 hardcoded experts. The refactored page:

1. Calls `generatePanelists(discussionId, expertCount)` from the API layer
2. Shows loading state with 🤖 icon and "正在生成嘉宾阵容…" message
3. Shows error state with retry button on failure
4. On confirm, navigates to the studio — panelists are already persisted server-side

The demo data function was removed entirely. The page now reflects real AI-generated panelists specific to the user's topic.

---

# Prompt Engineering Strategy

### System Prompt Design

The generation prompt had specific constraints:

```
You are a roundtable discussion producer.
Given a discussion topic and the number of experts requested,
generate a diverse panel consisting of 1 moderator (host) and
the requested number of experts.

Output ONLY valid JSON — no markdown fences, no commentary,
no surrounding text, no trailing commas.

The JSON must be an array of objects, each with these exact keys:
- role: "host" or "expert"
- name: full Chinese name
- occupation: profession or field (Chinese)
- title: specific job title or role description (Chinese)
- stance: concise statement of their position on the topic, 1 sentence (Chinese)

Requirements:
- The host must be neutral, skilled at facilitation,
  with stance "中立，引导讨论深入"
- Experts must represent genuinely different perspectives on the topic
- Each expert's stance must be distinct — avoid overlapping positions
- Names must be realistic Chinese names (2-3 characters for given name)
- Occupations and titles must be specific, not generic
- All text must be in Chinese
```

### Why Structured Output Is Required

The AI response feeds directly into the persistence layer. Every field must be present and correctly typed. If the AI returns free-form text, the system cannot extract structured panelist data. If the AI returns JSON with missing fields, the system cannot create valid `CreatePanelistInput` objects.

The JSON-only constraint minimizes parsing ambiguity. The explicit key list ensures every required field is present. The Chinese-language constraint ensures the UI (which is entirely Chinese per PRD §5.4) displays correctly.

### Parsing Resilience

Despite the "ONLY valid JSON" instruction, AI models sometimes wrap JSON in markdown fences (` ```json ``` `) or add surrounding commentary. The parser (`parsePanelistGenerationResponse.ts`) handles three patterns:

1. **Pure JSON** — direct `JSON.parse()`
2. **Markdown-fenced** — regex extraction of ` ```json ... ``` ` blocks
3. **Text-wrapped** — balanced bracket tracking to find the first complete JSON array

If all three strategies fail, the parser throws a descriptive error that the route handler maps to HTTP 422.

---

# Data Flow

```
Input:
  discussionId: string
  topic: string          (from Discussion.title)
  expertCount: number    (2–8)

        ↓

PanelistGenerator.generate()
  ├─ 1. Validate discussion exists (DiscussionRepository.findById)
  ├─ 2. Validate expertCount (number, integer, 2–8)
  ├─ 3. Build AI messages (PromptBuilder.buildPanelistGenerationMessages)
  │      → [{role:"system", content: generation instructions},
  │         {role:"user",   content: topic + expertCount}]
  ├─ 4. Call AIService.generate(messages) → GenerateAIResponse
  ├─ 5. Parse JSON (parsePanelistGenerationResponse)
  │      → RawGeneratedPanelist[]
  ├─ 6. Validate each entry (role, name, occupation, title, stance)
  │      → CreatePanelistInput[] (without color)
  ├─ 7. Assign system colors (deterministic palette, ordered)
  │      → CreatePanelistInput[] (with color)
  ├─ 8. Persist via PanelistRepository.create() × N
  │      → Panelist[]
  └─ 9. Return Panelist[]

        ↓

Output:
  Panelist[]  (1 host + N experts, persisted)
```

Colors are assigned from a 9-color palette in insertion order:

```ts
const PANELIST_COLORS = [
  "#e0556a", "#5b9bd5", "#4caf88", "#e2a83e",
  "#9b7ed8", "#e87d3e", "#3dbfc9", "#d67ba8", "#6c8ebf",
];
```

The host always receives the first color. Experts receive subsequent colors. For up to 9 panelists (1 host + 8 experts), every color is guaranteed distinct.

---

# Error Handling

### Validation Errors (HTTP 400)

| Condition | Error Message |
|---|---|
| `expertCount` missing | `"expertCount is required"` |
| `expertCount` not a number | `"expertCount must be a number"` |
| `expertCount` not an integer | `"expertCount must be an integer"` |
| `expertCount` < 2 or > 8 | `"expertCount must be between 2 and 8"` |

### Resource Errors (HTTP 404)

| Condition | Error Message |
|---|---|
| Discussion not found | `"Discussion not found"` |

### AI Response Errors (HTTP 422)

| Condition | Error Message |
|---|---|
| No valid JSON in response | `"Failed to parse panelist generation response: no valid JSON array found"` |
| Response is not an array | `"Panelist generation response is not a JSON array"` |
| Missing required field | `"Panelist[N]: {field} must be a non-empty string"` |
| Invalid role value | `"Panelist[N]: role must be "host" or "expert", got "{value}""` |

### Unexpected Errors (HTTP 500)

Any unexpected error (e.g., repository failure, AI service crash) returns `"Panelist generation failed"` with the actual error logged server-side via `console.error`.

### Service-Level Validation

`PanelistGenerator.generate()` performs its own validation before any side effects:

- Discussion existence — throws before AI call
- expertCount type and range — throws before AI call
- AI response fields — throws before any panelist is persisted

No partial panelists are persisted. If any entry fails validation after AI response parsing, the entire generation fails and nothing is saved.

---

# Testing Strategy

### Test File: `panelist-generator.test.ts` (27 tests)

#### Unit Tests — PanelistGenerator.generate()

**Success cases (7 tests):**
- Generates 1 host + N experts from valid AI response
- Persists generated panelists to the repository
- Assigns system colors in palette order (all valid hex, all distinct)
- Sets status to `"waiting"` for all generated panelists
- Generates valid UUID v4 IDs for all panelists
- Isolates panelists per discussion (different discussionIds, no cross-contamination)
- Verifies correct AI messages sent (system prompt + user message with topic and expertCount)

**Validation cases (5 tests):**
- Throws when discussion does not exist
- Throws when expertCount is not a number
- Throws when expertCount is not an integer
- Throws when expertCount < 2
- Throws when expertCount > 8

**AI response handling (5 tests):**
- Throws when AI returns unparseable text (no JSON)
- Throws when AI returns JSON with missing required fields
- Throws when AI returns an invalid role value
- Accepts JSON wrapped in markdown code fences (```json ... ```)
- Trims whitespace from all string fields

#### API Integration Tests — POST /generate

**Success cases (3 tests):**
- Returns 201 with generated panelists (correct count, host first)
- Generated panelists appear in subsequent GET /panelists
- Isolates generated panelists between different discussions

**Validation cases (6 tests):**
- Returns 404 when discussion does not exist
- Returns 400 when expertCount is missing
- Returns 400 when expertCount is not a number
- Returns 400 when expertCount is not an integer
- Returns 400 when expertCount < 2
- Returns 400 when expertCount > 8

**Error handling (1 test):**
- Returns 422 when AI response cannot be parsed

### Test Infrastructure

All tests use `MockAIService` with configurable content — no real AI API calls. Repositories are `InMemory*` variants. Each test creates an isolated app via `createApp()` with injected dependencies. No `listen()` is called, no network ports are opened.

---

# Relationship With Existing Architecture

### What M15 Reuses

| Component | How Used |
|---|---|
| `AIService` interface | Called by `PanelistGenerator` for AI generation |
| `DiscussionRepository` | Discussion existence validation |
| `PanelistRepository` | Persist generated panelists |
| `PromptBuilder` | Extended with generation prompt (same pattern as discussion prompts) |
| `createPanelistRouter` | Extended with optional generator parameter |
| `createApp` / `AppDependencies` | Extended with optional `panelistGenerator` dependency |
| `InMemoryPanelistRepository` | Used in tests (unchanged) |
| `MockAIService` | Used in tests with configurable content |

### What M15 Does NOT Modify

- `Discussion` domain entity — unchanged
- `Panelist` domain entity — unchanged
- `Message` domain entity — unchanged
- `DiscussionEngine` — unchanged
- `DiscussionSessionController` — unchanged
- `DiscussionController` — unchanged
- `RoundController` — unchanged
- `SessionLifecycle` / `TemplateSessionLifecycle` — unchanged
- `DiscussionRepository` interface — unchanged
- `PanelistRepository` interface — unchanged
- `MessageRepository` interface — unchanged
- `DeepSeekAIService` — unchanged
- `createAIService` — unchanged
- `loadAppConfig` — unchanged
- REST routes other than panelist — unchanged
- Existing test files — unchanged
- Frontend type definitions — unchanged

### Architecture Diagram

```
POST /api/discussions/:id/panelists/generate
        │
        ▼
createPanelistRouter (extended with optional generator)
        │
        ▼
PanelistGenerator.generate()           ← NEW service
    ├── DiscussionRepository           ← reused
    ├── PromptBuilder                  ← extended
    ├── AIService                      ← reused
    ├── parsePanelistGenerationResponse ← NEW parser
    └── PanelistRepository             ← reused
        │
        ▼
Panelist[] returned to frontend
        │
        ▼
ConfirmPanelistsPage (updated)        ← calls real API
```

---

# Verification

All verification commands completed successfully.

| Command | Result |
|---|---|
| `npx vitest run` (backend) | ✅ 15 test files passed / 308 tests passed |
| `npx tsc --noEmit` (frontend) | ✅ 0 errors |
| `npm run build` (frontend) | ✅ 69 modules, 199 KB JS + 19 KB CSS |
| `git diff --check` | ✅ No whitespace issues |
| Backend existing tests | ✅ All 281 pre-existing tests pass unchanged |
| Frontend existing build | ✅ No regressions |

Additionally verified:

- No domain model was modified
- No repository interface was modified
- No existing controller was modified
- No existing test file was modified
- No `AIService`, `MockAIService`, `DeepSeekAIService`, or `createAIService` was modified
- No `DiscussionEngine`, `DiscussionSessionController`, or `RoundController` was modified
- No `process.env` access exists in `PanelistGenerator` or the parser
- The parser is a pure function — no side effects, no dependencies
- Frontend demo data function (`generateDemoPanelists`) was removed entirely
- Panelists are persisted server-side before the frontend confirmation — the confirm button only navigates

---

# Files Created

```
backend/src/services/PanelistGenerator.ts
backend/src/services/parsePanelistGenerationResponse.ts
backend/src/tests/panelist-generator.test.ts
prompts/15_AI_Panelist_Generation.md
```

The `services/` directory already existed from Milestone 11 (`DiscussionEngine.ts`). The `tests/` directory already existed with 14 test files.

---

# Files Modified

| File | Change |
|---|---|
| `backend/src/ai/PromptBuilder.ts` | Added `buildPanelistGenerationSystemPrompt()` and `buildPanelistGenerationMessages()` |
| `backend/src/routes/panelist.ts` | Added optional `PanelistGenerator` parameter; mounted `POST /generate` |
| `backend/src/app.ts` | Added `panelistGenerator` to `AppDependencies` interface; auto-creates from `aiService` + repos; passes to panelist router |
| `frontend/src/api/panelistApi.ts` | Added `generatePanelists()` function; removed TODO for /generate |
| `frontend/src/pages/ConfirmPanelistsPage.tsx` | Replaced 70-line demo data function with real API call; added loading/error states |
| `frontend/src/pages/ConfirmPanelistsPage.module.css` | Added status container, icon, hint, error, and action styles |

No pre-existing implementation files were structurally changed — only extended.

---

# Scope Boundaries Respected

The following were **not** introduced:

- ✅ No AI moderator behaviour in the discussion engine
- ✅ No streaming or SSE for generation progress
- ✅ No "regenerate" or "edit panelist" features
- ✅ No panelist avatar images (only color + initial)
- ✅ No panelist deletion or modification endpoints
- ✅ No multi-step generation (retry, refinement, user editing)
- ✅ No topic-to-panelist relevance scoring
- ✅ No panelist diversity metrics or validation
- ✅ No real DeepSeek calls in tests
- ✅ No `DiscussionStatus` mutation during generation
- ✅ No `PanelistStatus` mutation during generation
- ✅ No `Message` creation during generation
- ✅ No `PanelistRepository` interface changes
- ✅ No `DiscussionRepository` interface changes
- ✅ No existing route behaviour changes (GET /, POST / remain identical)
- ✅ No frontend routing changes
- ✅ No new npm dependencies

---

# Review

The implementation was reviewed by inspecting:

- `PanelistGenerator` class — constructor injection, validation order, error propagation
- `parsePanelistGenerationResponse` — three fallback strategies, balanced bracket tracking
- Prompt additions — system prompt constraints, output format requirements
- Route changes — optional generator parameter, validation, error-to-status-code mapping
- App wiring — dependency creation, interface extension
- Frontend changes — demo data removal, API integration, loading/error states
- All 27 new tests — coverage of success, validation, AI failure, and API behaviour

The review confirmed:

- `PanelistGenerator` follows the same constructor-injection pattern as `DiscussionEngine`
- `parsePanelistGenerationResponse` is a pure function with no side effects
- AI generates identity/occupation/title/stance; system controls IDs, colors, persistence
- Colors are assigned from a fixed palette — AI cannot produce invalid hex codes
- Validation runs before any side effect — no partial persistence on failure
- The parser handles three AI output patterns (pure JSON, markdown-fenced, text-wrapped)
- Route validation is independent of service validation (defense in depth)
- The optional generator parameter preserves backward compatibility with existing tests
- Frontend demo data function was completely removed
- All 281 pre-existing tests pass without modification
- No domain model, repository interface, or existing controller was changed

No code changes were required after review.

---

# Result

**Milestone 15 completed successfully.**

The project now has a complete AI-powered panelist generation pipeline:

```
User Input (topic + expertCount)
        ↓
POST /api/discussions/:id/panelists/generate
        ↓
PanelistGenerator.generate()
    ├── PromptBuilder.buildPanelistGenerationMessages()
    ├── AIService.generate()
    ├── parsePanelistGenerationResponse()
    ├── Field validation + color assignment
    └── PanelistRepository.create() × N
        ↓
Frontend ConfirmPanelistsPage
    → User confirms → Navigate to /discussion/:id
```

The milestone introduced:

- `PanelistGenerator` — a service that orchestrates AI panelist generation following the established `DiscussionEngine` pattern
- `parsePanelistGenerationResponse` — a robust, pure-function JSON parser handling three AI output patterns
- `POST /api/discussions/:id/panelists/generate` — a validated REST endpoint
- `buildPanelistGenerationSystemPrompt` and `buildPanelistGenerationMessages` — structured prompt for AI panelist generation
- Frontend integration replacing hardcoded demo data with real API calls
- 27 focused tests covering generation, validation, AI failure modes, parsing, and API behaviour

### Architectural Significance

1. **AI/System boundary established**: The AI generates creative, topic-dependent content (identities, stances). The system controls integrity-critical metadata (IDs, colors, persistence). This boundary prevents AI errors from corrupting system state.
2. **Existing architecture extended, not modified**: `PromptBuilder` was extended with new functions. `createPanelistRouter` was extended with an optional parameter. `AppDependencies` was extended with a new field. No existing function signature, interface, or behaviour was changed.
3. **Demo data eliminated**: The frontend no longer contains hardcoded panelist data. Every panelist shown to users is AI-generated and topic-specific.
4. **Clean handoff to discussion execution**: Generated panelists are persisted with `status: "waiting"` — the same initial state expected by `DiscussionEngine`. M15 produces panelists; future milestones execute their discussion.

Subsequent milestones can now run full discussion sessions with dynamically generated, topic-relevant expert panels — the core value proposition of AI Panel Studio.

---

# Reflection

This milestone demonstrates the value of the established architecture patterns:

- The `AIService` interface allowed `PanelistGenerator` to be tested with `MockAIService` — no real API calls in tests, deterministic behaviour, fast execution.
- The `createPanelistRouter` factory pattern allowed adding the `/generate` endpoint without duplicating the router or breaking existing tests.
- The constructor-injection pattern from `DiscussionEngine` provided a clear template for `PanelistGenerator`.

The hardest technical challenge was parsing AI responses. Despite instructing the model to output "ONLY valid JSON," real AI models sometimes wrap JSON in markdown fences or add commentary. The three-fallback parser strategy (direct parse → fence extraction → bracket tracking) was essential for robustness.

The prompt engineering was constrained by the need for structured output. Unlike the existing discussion prompts (which expect free-form text), the generation prompt must produce machine-parseable JSON with specific keys. The prompt explicitly lists required keys, provides an example format, and repeats the "ONLY JSON" constraint at multiple points.

A deliberate decision was made **not** to add a "regenerate" feature in this milestone. While users might want to re-roll panelists they don't like, that feature requires additional API design (idempotency, replacement semantics, UI for selective regeneration) that is better addressed after the core generation pipeline proves stable.
