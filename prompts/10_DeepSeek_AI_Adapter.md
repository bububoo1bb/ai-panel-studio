# Prompt 10 — DeepSeek AI Adapter

**Stage:** Implementation Phase — Milestone 9

**Date:** 2026-07-22

---

# Goal

Implement a production `AIService` implementation backed by the DeepSeek Chat Completion API.

The implementation must conform exactly to the existing `AIService` interface. No application-layer logic should change.

---

# Context

Before implementation, Claude Code was instructed to read:

- CLAUDE.md
- docs/PRD.md
- docs/SDD.md
- docs/DDD.md
- docs/TDD.md
- all existing Prompt Records
- backend/src/ai/*
- backend/src/controllers/*
- backend/src/tests/*

The backend already supported:

- `AIService` interface with `generate(request: GenerateAIRequest): Promise<GenerateAIResponse>`
- `MockAIService` — a deterministic in-memory implementation for testing
- `PromptBuilder` — constructs provider-independent AI messages from domain objects
- `RoundController` — executes a single panelist turn (validation, prompt construction, AI generation, message persistence)
- `DiscussionController` — orchestrates one complete discussion round across all active panelists
- Repository abstractions with in-memory implementations
- Express application with dependency injection
- Vitest test infrastructure

The `AIService` interface was the only extension point needed. All application-layer controllers depend on the interface, never on concrete implementations.

---

# Prompt

```text
Implement a production AIService implementation backed by the DeepSeek Chat
Completion API.

The implementation must conform exactly to the existing AIService interface.

Scope:

Implement:
- backend/src/ai/DeepSeekAIService.ts
- Unit tests
- Environment configuration if necessary

Constructor:
- Accept apiKey, model, baseUrl (optional) through dependency injection.
- Never hardcode credentials.

generate():
- Convert existing AIMessage[] into the provider request.
- Call the DeepSeek Chat Completion API.
- Return content, usage, model mapped into GenerateAIResponse.

Do not change:
- AIService
- PromptBuilder
- RoundController
- DiscussionController
- Repositories
- Domain
- REST

Error handling:
- If the API returns 401, 403, 429, 5xx, or network errors: throw Error.
- Do not retry.
- Do not swallow exceptions.

Testing:
- Use mocked fetch. Do NOT call the real API.
- Cover: successful completion, empty content, 401, 403, 429, 500,
  network failure, request mapping, response mapping.
```

---

# Files Created

```
backend/src/ai/DeepSeekAIService.ts               (160 lines)
backend/src/tests/deepseek-ai-service.test.ts     (841 lines)
```

No files were modified. The implementation is purely additive.

---

# DeepSeekAIService API

```ts
export interface DeepSeekAIServiceOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class DeepSeekAIService implements AIService {
  constructor(options: DeepSeekAIServiceOptions);

  generate(request: GenerateAIRequest): Promise<GenerateAIResponse>;
}
```

### Constructor Dependency Injection

The service accepts three configuration values via a constructor options object:

| Parameter | Required | Default | Purpose |
|---|---|---|---|
| `apiKey` | Yes | — | DeepSeek API key (Bearer token) |
| `model` | Yes | — | Model identifier e.g. `"deepseek-chat"` |
| `baseUrl` | No | `"https://api.deepseek.com/v1"` | API base URL (trailing slashes stripped before use) |

Credentials are injected through the constructor. The service never reads `process.env` directly. At startup, callers wire `process.env.DEEPSEEK_API_KEY` and `process.env.DEEPSEEK_MODEL` into the constructor — the service itself has no knowledge of environment variables.

### AIService Interface Conformance

`DeepSeekAIService` implements the existing `AIService` interface:

```ts
export interface AIService {
  generate(request: GenerateAIRequest): Promise<GenerateAIResponse>;
}
```

The interface was not modified. `DeepSeekAIService` is a provider adapter — one of potentially many implementations of the same abstraction.

### Base URL Normalization

The `baseUrl` option is normalized by removing all trailing slashes before `/chat/completions` is appended:

```
"https://api.deepseek.com/v1"   → "https://api.deepseek.com/v1/chat/completions"
"https://api.deepseek.com/v1/"  → "https://api.deepseek.com/v1/chat/completions"
"https://api.deepseek.com/v1///"→ "https://api.deepseek.com/v1/chat/completions"
```

This prevents double-slash URLs regardless of how the caller configures the base URL.

---

# Request Mapping

### AIMessage[] → DeepSeek Messages

Each `AIMessage` is mapped directly:

```ts
request.messages.map((m) => ({ role: m.role, content: m.content }))
```

| `GenerateAIRequest` field | DeepSeek API field | Behaviour |
|---|---|---|
| `messages[].role` | `messages[].role` | Pass-through |
| `messages[].content` | `messages[].content` | Pass-through |
| `temperature` | `temperature` | Included only when defined |
| `maxTokens` | `max_tokens` | Included only when defined |

Optional fields (`temperature`, `maxTokens`) are omitted from the request body when `undefined`, rather than being sent as `null` or a default value.

### HTTP Request

```
POST {baseUrl}/chat/completions
Content-Type: application/json
Authorization: Bearer {apiKey}

{
  model: string,
  messages: { role: string, content: string }[],
  temperature?: number,
  max_tokens?: number
}
```

---

# Response Mapping

### DeepSeek API → GenerateAIResponse

| DeepSeek API field | `GenerateAIResponse` field | Behaviour |
|---|---|---|
| `choices[0].message.content` | `content` | Validated — must be a string |
| `model` | `model` | Pass-through |
| `usage.prompt_tokens` | `usage.promptTokens` | snake_case → camelCase |
| `usage.completion_tokens` | `usage.completionTokens` | snake_case → camelCase |
| `usage.total_tokens` | `usage.totalTokens` | snake_case → camelCase |

### Usage

`usage` is optional. When the API response has no `usage` field, `response.usage` is `undefined`. When present, all three sub-fields are mapped from `snake_case` to `camelCase`.

### Malformed Completion Validation

Before extracting `content`, the response structure is validated:

```
checks:
  1. choices is an array        → fail → throw
  2. choices.length > 0          → fail → throw
  3. choices[0].message exists   → fail → throw
  4. choices[0].message.content
     is a string                 → fail → throw

error message:
  "DeepSeek API returned an invalid completion response"
```

An explicit empty string (`content: ""`) passes validation and is returned as `content: ""`. This is treated as a valid, successful response.

Conditions that trigger the error:

- `choices` missing from the response
- `choices` is `null`
- `choices` is an empty array `[]`
- `choices[0].message` is missing
- `choices[0].message.content` is missing
- `choices[0].message.content` is `null`
- `choices[0].message.content` is not a string (e.g. a number)

---

# Error Handling

### HTTP Error Status Codes

When `response.ok` is `false`, the service throws:

```
Error("DeepSeek API error: {status} {statusText}")
```

Covered status codes: 401, 403, 429, 500, 502, 503.

### Network Errors

When `fetch` itself rejects (connection refused, DNS failure, timeout, etc.), the service throws:

```
Error("DeepSeek API network error: {message}")
```

Non-Error rejections (e.g. a plain string) are handled via `String(err)`.

### Error Propagation

- Errors are thrown as plain `Error` objects.
- No retry logic exists.
- No error wrapping or transformation beyond the messages shown above.
- Callers (e.g. `RoundController`) receive the error unchanged and propagate it further.

### Malformed 200 Responses

As described in Response Mapping, a 200 response whose body does not contain a valid completion structure throws:

```
Error("DeepSeek API returned an invalid completion response")
```

This covers the case where the API returns HTTP 200 but the response body is structurally invalid.

---

# Testing

### Test Infrastructure

All tests use mocked `fetch` via `vi.stubGlobal("fetch", ...)`. No real API calls are made. Tests construct `Response`-like objects with controlled status codes and JSON bodies.

Test helpers:

| Helper | Purpose |
|---|---|
| `sampleRequest()` | Create a minimal valid `GenerateAIRequest` |
| `successResponse()` | Create a well-formed DeepSeek API response body |
| `mockResponse()` | Build a `Response`-like object with configurable status |
| `mockFetch()` | Stub `global.fetch` and return a spy for assertion |

### Test Coverage

**37 tests** across 10 categories:

| Category | Count | Coverage |
|---|---|---|
| Successful completion | 4 | content, model, usage present, usage absent |
| Empty content | 1 | explicit `""` is valid |
| Invalid completion response | 7 | choices missing, choices null, choices empty, message missing, content missing, content non-string (number), content null |
| 401 Unauthorized | 1 | throws with status |
| 403 Forbidden | 1 | throws with status |
| 429 Too Many Requests | 1 | throws with status |
| 5xx errors | 3 | 500, 502, 503 |
| Network failure | 2 | Error rejection, non-Error rejection |
| Request mapping | 12 | default URL, custom baseUrl, single trailing slash stripped, multiple trailing slashes stripped, Authorization header, Content-Type header, message mapping, model, temperature present/absent, max_tokens present/absent |
| Response mapping | 3 | content, model, usage snake_case→camelCase |
| Constructor defaults | 2 | default baseUrl, all options accepted |

### Total Test Count

**156 tests** across 9 test files, all passing. (Previously 119 tests across 8 test files.)

---

# Verification

All verification commands completed successfully.

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ Passed (0 errors) |
| `npm test` (backend) | ✅ 9 test files passed / 156 tests passed |
| `npm run build` | ✅ All workspaces compiled |
| `git diff --check` | ✅ No whitespace issues |
| `git status --short` | ✅ 2 new files only |
| `git diff --stat` | ✅ 0 existing files modified |

---

# Architecture Notes

### Dependency Graph

```
DiscussionController
        │
        ▼
RoundController
        │
        ▼
AIService (interface)
        │
        ├── MockAIService        (tests / development)
        └── DeepSeekAIService    (production)  ← NEW
```

`DeepSeekAIService` is a provider adapter. It implements the existing `AIService` interface without requiring any changes to the interface itself, the controllers that consume it, or the domain layer below it.

### Layer Relationships

```
DiscussionController (application orchestration)
        │
        ▼
RoundController (single-turn execution)
        │
        ├────▶ Repository Interfaces
        │
        └────▶ AIService Interface
                    │
                    ├────▶ MockAIService
                    │
                    └────▶ DeepSeekAIService  ← NEW
                                │
                                ▼
                        DeepSeek Chat Completion API
```

### Responsibility Separation

| Component | Responsibility |
|---|---|
| `DiscussionController` | Panelist loading, finished-filtering, sequential orchestration |
| `RoundController` | Cross-entity validation, prompt construction, AI generation, message persistence |
| `PromptBuilder` | Prompt construction, system prompt formatting, message conversion |
| `AIService` (interface) | Provider-independent AI text generation |
| `DeepSeekAIService` | DeepSeek API HTTP calls, request/response mapping, error handling |
| `MockAIService` | Deterministic in-memory AI for testing |

### Why No Application-Layer Changes Were Needed

The `AIService` interface was designed from the start to be provider-independent. `RoundController` and `DiscussionController` depend only on the interface — they call `aiService.generate()` without knowledge of which provider is behind it. Adding a new provider implementation is a matter of writing a new class that conforms to the interface and wiring it in at startup.

---

# Review

The initial implementation was reviewed, and one focused revision was applied.

### Initial Implementation

The first version:

- Implemented `generate()` with correct HTTP call and response mapping
- Used `data.choices?.[0]?.message?.content ?? ""` with optional chaining — silently treating malformed 200 responses as empty completions
- Did not normalize trailing slashes on `baseUrl`
- Included 30 unit tests

### Focused Revision

Two changes were applied:

1. **Base URL normalization** — trailing slashes are now stripped from `baseUrl` in the constructor:
   ```ts
   this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com/v1").replace(/\/+$/, "");
   ```
   This ensures exactly one slash before `/chat/completions` regardless of how the caller formats the base URL.

2. **Malformed completion validation** — the response mapping now validates the completion structure before extracting content:
   ```ts
   if (
     !Array.isArray(data.choices) ||
     data.choices.length === 0 ||
     !data.choices[0].message ||
     typeof data.choices[0].message.content !== "string"
   ) {
     throw new Error("DeepSeek API returned an invalid completion response");
   }
   ```
   An explicit empty-string content (`""`) remains valid and returns `content: ""`. Only missing or non-string content triggers the error.

Tests were updated accordingly:
- 2 tests reclassified from "returns empty string" to "throws invalid completion response"
- 7 new tests added for the validation paths (choices missing, choices null, choices empty, message missing, content missing, content non-string, content null)
- 2 new tests added for trailing-slash normalization (single slash, multiple slashes)
- 1 test retained for explicit empty-string content (still valid)

### Review Confirmed

The review confirmed:

- proper `AIService` interface conformance
- correct DeepSeek Chat Completion API request/response mapping
- constructor-based dependency injection (credentials never hardcoded)
- base URL normalization (trailing slashes stripped)
- malformed 200 responses throw rather than silently returning empty content
- explicit empty-string content remains valid
- network errors and HTTP error status codes throw with descriptive messages
- no retry logic
- no modifications to `AIService`, `PromptBuilder`, `RoundController`, `DiscussionController`, repositories, domain types, or REST routes
- service never reads `process.env` directly
- all 37 tests pass using mocked `fetch`

No further code changes were required after the revision.

---

# Scope Boundaries Respected

The following were **not** introduced:

- ✅ No modifications to `AIService` interface
- ✅ No modifications to `PromptBuilder`
- ✅ No modifications to `RoundController`
- ✅ No modifications to `DiscussionController`
- ✅ No modifications to repositories
- ✅ No modifications to domain types
- ✅ No modifications to REST routes or Express app
- ✅ No `process.env` access inside `DeepSeekAIService`
- ✅ No retry logic
- ✅ No streaming
- ✅ No function calling / tool calling
- ✅ No response caching
- ✅ No request routing or load balancing
- ✅ No environment variable files created
- ✅ No package additions
- ✅ No frontend changes
- ✅ No real API calls in tests

---

# Result

**Milestone 9 completed successfully.**

The project now has a production `AIService` implementation backed by the DeepSeek Chat Completion API.

The dependency graph supports both testing and production through a single interface:

```
AIService (interface)
    │
    ├── MockAIService        — deterministic, used in all controller tests
    └── DeepSeekAIService    — production, backed by DeepSeek HTTP API
```

The application-layer architecture (`RoundController`, `DiscussionController`, `PromptBuilder`, repositories, domain) remained completely unchanged because the `AIService` interface was designed from the start to be provider-independent. Adding a new AI provider requires only a new class that implements the interface — no controller, repository, or domain changes are needed.

Subsequent milestones can wire `DeepSeekAIService` into the Express application at startup (injecting credentials from environment variables at the composition root) to enable real AI-powered discussions without modifying any existing application logic.
