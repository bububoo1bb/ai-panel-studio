# Prompt 11 — AI Provider Wiring and Configuration

**Stage:** Implementation Phase — Milestone 10

**Date:** 2026-07-22

---

# Goal

Wire the existing `AIService` implementations (`MockAIService` and `DeepSeekAIService`) into the backend application through explicit configuration and dependency injection.

The application must be able to select between `MockAIService` and `DeepSeekAIService` without changing `RoundController`, `DiscussionController`, or any existing business logic.

Milestone 10 is about configuration and dependency composition only.

---

# Context

Before implementation, Claude Code was instructed to read:

- CLAUDE.md
- docs/PRD.md
- docs/SDD.md
- docs/DDD.md
- docs/TDD.md
- all existing Prompt Records
- backend/package.json
- backend/tsconfig.json
- backend/src/index.ts
- backend/src/app.ts
- backend/src/ai/*
- backend/src/controllers/*
- backend/src/repositories/*
- backend/src/routes/*
- backend/src/tests/*

The backend already supported:

- `AIService` interface with `generate(request: GenerateAIRequest): Promise<GenerateAIResponse>`
- `MockAIService` — deterministic in-memory implementation for testing
- `DeepSeekAIService` — production implementation backed by the DeepSeek Chat Completion API
- `PromptBuilder` — constructs provider-independent AI messages from domain objects
- `RoundController` — executes a single panelist turn (depends on repositories + `AIService` via constructor injection)
- `DiscussionController` — orchestrates one complete discussion round across all active panelists (depends on `RoundController` + `PanelistRepository`)
- Repository abstractions with in-memory implementations
- Express application with dependency injection via `createApp(dependencies?)` and an `AppDependencies` interface
- Vitest test infrastructure
- `dotenv` already listed as a dependency

The `DeepSeekAIService` was implemented in Milestone 9 as a pure provider adapter — it accepts `apiKey`, `model`, and optional `baseUrl` through its constructor and never reads `process.env` directly.

At the end of Milestone 9, the dependency graph supported both testing and production through the `AIService` interface, but the application bootstrap did not yet select or inject a concrete implementation. Milestone 10 closes this gap.

---

# Prompt

```text
Wire the existing AIService implementations into the backend application
through explicit configuration and dependency injection.

The application must be able to select between:

- MockAIService
- DeepSeekAIService

without changing RoundController or DiscussionController.

Milestone 10 is about configuration and dependency composition only.

Support an AI provider configuration with these provider values:

- mock
- deepseek

Use "mock" as the safe default.

For the DeepSeek provider, support configuration for:

- API key
- model
- optional base URL

Prefer these environment variable names:

AI_PROVIDER
DEEPSEEK_API_KEY
DEEPSEEK_MODEL
DEEPSEEK_BASE_URL

Do not expose secrets through logs, API responses, thrown error messages,
or committed files.

Configuration must be validated at application startup or composition time.

Prefer a small, explicit design:

backend/src/config/AppConfig.ts
backend/src/ai/createAIService.ts

Do not instantiate DeepSeekAIService inside RoundController,
DiscussionController, routes, repositories, or domain files.

RoundController must still receive AIService through constructor injection.

Do not introduce global mutable service state.

Update the existing backend bootstrap/composition root only as needed.

Do not add new REST endpoints in this milestone.

Do not execute a real AI request during startup.

Testing:

Add focused unit tests for configuration validation and the AIService
factory. Use test doubles or mocked environment objects. Do not mutate
process.env globally. Do not call the real DeepSeek API.
```

---

# Files Created

```
backend/src/config/AppConfig.ts                            (140 lines)
backend/src/ai/createAIService.ts                          ( 37 lines)
backend/.env.example                                       ( 12 lines)
backend/src/tests/config.test.ts                           (305 lines)
backend/src/tests/create-ai-service.test.ts                (224 lines)
```

The `config/` directory is new. The `controllers/` directory already existed from Milestone 7.

---

# Files Modified

```
backend/src/app.ts                                         (+9 lines, 8 contextual)
backend/src/index.ts                                       (+11 lines, 1 deleted)
```

No other files were modified. Specifically, no changes were made to:

- `AIService` interface
- `MockAIService`
- `DeepSeekAIService`
- `PromptBuilder`
- `RoundController`
- `DiscussionController`
- Repository interfaces or implementations
- Domain entities
- REST routes
- Existing test files

---

# Configuration Architecture

### Dependency Graph

```
process.env (read once in index.ts)
        ↓
loadAppConfig(env) → AppConfig
        ↓
createAIService(config.ai) → AIService
        ↓
createApp({ aiService }) → Express app
```

### AppConfig Structure

```ts
type AIProvider = "mock" | "deepseek";

interface DeepSeekConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface AIConfig {
  provider: AIProvider;
  deepseek?: DeepSeekConfig;
}

interface AppConfig {
  ai: AIConfig;
}
```

`AppConfig` is the top-level configuration object. It wraps an `AIConfig` section under the `ai` key, allowing future non-AI configuration sections to be added without restructuring.

### AIProvider Type

```ts
export type AIProvider = "mock" | "deepseek";
```

Exactly two providers are supported. This is a discriminated union — the value determines which nested configuration shape is required. Adding a third provider requires extending this type and updating `loadAppConfig`, `createAIService`, and the validation logic.

### DeepSeekConfig Structure

```ts
export interface DeepSeekConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}
```

`apiKey` and `model` are required when the DeepSeek provider is selected. `baseUrl` is optional — when absent, `DeepSeekAIService` uses its own default (`https://api.deepseek.com/v1`).

### AIConfig Structure

```ts
export interface AIConfig {
  provider: AIProvider;
  deepseek?: DeepSeekConfig;
}
```

`deepseek` is `undefined` when `provider` is `"mock"`. It is guaranteed to be present and populated when `provider` is `"deepseek"` — this guarantee is enforced by `loadAppConfig` before `createAIService` runs.

### loadAppConfig(env)

```ts
export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig;
```

`loadAppConfig` is a pure function that receives an environment-like object and returns a validated `AppConfig`. It does not read `process.env` directly. The function:

1. Reads `AI_PROVIDER` from the environment object
2. Resolves the provider (defaulting to `"mock"` when absent or empty)
3. Validates the provider value against the allowed set
4. For `"deepseek"`, reads and validates required variables (`DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`)
5. For `"deepseek"`, reads optional `DEEPSEEK_BASE_URL`
6. Returns a fully resolved `AppConfig`

The function throws `ConfigValidationError` for any invalid configuration. All errors are thrown synchronously — no async I/O or network calls.

---

# Environment Variables

### Supported Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AI_PROVIDER` | No | `"mock"` | Provider selection (`"mock"` or `"deepseek"`) |
| `DEEPSEEK_API_KEY` | When `AI_PROVIDER=deepseek` | — | DeepSeek API key (Bearer token) |
| `DEEPSEEK_MODEL` | When `AI_PROVIDER=deepseek` | — | Model identifier e.g. `"deepseek-chat"` |
| `DEEPSEEK_BASE_URL` | No | `https://api.deepseek.com/v1` | Override for the API base URL |

### Environment Variable Handling

- `process.env` is read exactly once — at the composition root in `index.ts`
- `loadAppConfig` receives `process.env` as an argument; it never accesses `process.env` directly
- `createAIService` receives the resolved `AIConfig`; it never accesses `process.env`
- `DeepSeekAIService` receives constructor options; it never accesses `process.env`
- `MockAIService` has no knowledge of environment variables
- No controller, repository, domain, or route file reads any environment variable
- The configuration flow is: raw env → pure loader → validated config → factory → concrete instance

### Default Provider

When `AI_PROVIDER` is unset, empty, or whitespace-only, the application starts with `MockAIService`. This is the safe default — no external API calls, no credentials needed, zero configuration overhead for development and testing.

### Environment Example File

`backend/.env.example` was created with placeholder values only:

```
AI_PROVIDER=mock
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
```

The file serves as documentation for developers. All real-credential fields are empty or use well-known public placeholder values. No real `.env` file was created or modified.

The `.gitignore` already covers `.env`, `.env.local`, and `.env.*.local` — no changes were needed.

---

# Configuration Validation

### Validation Rules

All validation happens synchronously inside `loadAppConfig` at application startup. The rules are:

1. `AI_PROVIDER` is optional and defaults to `"mock"`
2. When present and non-empty, `AI_PROVIDER` must be exactly `"mock"` or `"deepseek"` (after trimming)
3. Invalid provider values throw `ConfigValidationError` with a message naming the invalid value and the valid options
4. When `AI_PROVIDER` is `"deepseek"`, `DEEPSEEK_API_KEY` is required (non-empty after trimming)
5. When `AI_PROVIDER` is `"deepseek"`, `DEEPSEEK_MODEL` is required (non-empty after trimming)
6. `DEEPSEEK_BASE_URL` is optional for the `"deepseek"` provider
7. When `AI_PROVIDER` is `"mock"`, DeepSeek variables are not required and are not read
8. Empty strings and whitespace-only strings are treated as missing for all required variables
9. All string values are trimmed before use

### Configuration Error Handling

Invalid configurations throw `ConfigValidationError`, a custom error class extending `Error`:

```ts
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}
```

Error messages are descriptive but secure:

- Missing variable errors name the missing key (e.g. `"Missing required configuration: DEEPSEEK_API_KEY"`)
- Invalid provider errors name the invalid value and the valid options (e.g. `Invalid AI_PROVIDER "openai". Must be "mock" or "deepseek".`)
- No error message ever includes the value of an environment variable — only the key name is exposed

### Secret Protection

API keys and other secret values are protected at multiple levels:

1. **Error messages**: `ConfigValidationError` messages reference environment variable *names* (e.g. `DEEPSEEK_API_KEY`), never their *values*
2. **Logs**: The application does not log configuration values at startup
3. **Committed files**: No real credentials exist in any committed file; test files use obvious placeholder strings (`"sk-test-key-12345"`, `"sk-custom-key-abc"`)
4. **`.env.example`**: Contains only empty values and well-known public defaults
5. **`.gitignore`**: Already covers `.env`, `.env.local`, and `.env.*.local`

---

# AI Service Factory

### createAIService(config)

```ts
export function createAIService(config: AIConfig): AIService;
```

`createAIService` is the single composition point for provider selection. It receives a validated `AIConfig` and returns the appropriate `AIService` implementation.

### Provider Selection

```
config.provider === "mock"
    → new MockAIService()

config.provider === "deepseek"
    → new DeepSeekAIService({
        apiKey: config.deepseek.apiKey,
        model: config.deepseek.model,
        baseUrl: config.deepseek.baseUrl    // included only when defined
      })

any other value
    → throws Error (exhaustiveness check)
```

The factory uses a `switch` statement with an exhaustiveness check in the `default` branch:

```ts
default: {
  const _exhaustive: never = config.provider;
  throw new Error(`Unsupported AI provider: ${String(_exhaustive)}`);
}
```

This ensures that adding a new provider to the `AIProvider` type forces a compile-time error until the factory is updated — unsupported configurations cannot silently fall back to `MockAIService`.

The non-null assertion on `config.deepseek!` is safe because `loadAppConfig` guarantees the field is populated whenever `provider` is `"deepseek"`.

`DeepSeekAIService` options are spread from the config:

```ts
new DeepSeekAIService({
  apiKey: ds.apiKey,
  model: ds.model,
  ...(ds.baseUrl !== undefined ? { baseUrl: ds.baseUrl } : {}),
})
```

The `baseUrl` field is included only when defined. When absent, `DeepSeekAIService` uses its own default.

---

# Dependency Injection

### Composition Root

`index.ts` is the composition root — the single place where configuration is read and concrete implementations are selected:

```ts
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { loadAppConfig } from "./config/AppConfig.js";
import { createAIService } from "./ai/createAIService.js";

dotenv.config();

const config = loadAppConfig(process.env);
const aiService = createAIService(config.ai);

const app = createApp({ aiService });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
```

The composition root calls three functions in sequence:

1. `loadAppConfig(process.env)` — validates and resolves configuration
2. `createAIService(config.ai)` — selects and constructs the concrete implementation
3. `createApp({ aiService })` — injects the service into the application

`process.env` is read only in `index.ts`. Every other module receives configuration through typed parameters.

### AppDependencies Extension

The `AppDependencies` interface was extended with an `aiService` field:

```ts
export interface AppDependencies {
  discussionRepository: DiscussionRepository;
  messageRepository: MessageRepository;
  panelistRepository: PanelistRepository;
  /** AI service implementation. Defaults to MockAIService when not injected. */
  aiService: AIService;
}
```

Inside `createApp`, the AI service is resolved with a safe fallback:

```ts
const aiService =
  dependencies?.aiService ?? new MockAIService();
```

This preserves backward compatibility: tests and callers that use `createApp()` without passing an `aiService` get `MockAIService` automatically.

### Application Bootstrap Flow

```
index.ts                            app.ts
─────────                           ──────
dotenv.config()
    │
loadAppConfig(process.env)
    │
createAIService(config.ai)
    │
createApp({ aiService }) ──────▶   resolve repositories
    │                               resolve aiService (injected or default)
    │                               configure middleware
    │                               mount routes
    │                               return Express app
    │
app.listen(PORT)
```

The application creates the configured `AIService` before the Express app starts. If configuration is invalid, the process fails before `app.listen()` is reached — no half-configured server starts.

### Provider Selection is Centralized

`createAIService` is the only function in the codebase that contains provider-specific conditionals. No other module branches on `config.provider` or checks which implementation is active. Controllers, routes, and repositories remain fully provider-agnostic.

---

# Testing

### Test Infrastructure

Both new test files use Vitest and follow the existing test conventions:

- **config.test.ts**: Tests `loadAppConfig` with explicit `NodeJS.ProcessEnv` objects — never mutates `process.env`
- **create-ai-service.test.ts**: Tests the factory with typed `AIConfig` objects; uses `vi.stubGlobal("fetch", ...)` for DeepSeek service verification — never calls the real API

No Express app is created. No `listen()` is called.

### Test Coverage

**37 new tests** across 2 new test files:

#### config.test.ts (27 tests)

| # | Category | Tests |
|---|---|---|
| 1 | Default provider (3) | AI_PROVIDER unset → mock; empty string → mock; whitespace-only → mock |
| 2 | Explicit mock (2) | accepts "mock"; does not require DeepSeek config |
| 3 | Explicit deepseek (1) | accepts "deepseek" with required config |
| 4 | Optional base URL (3) | preserves DEEPSEEK_BASE_URL; omits when unset; omits when empty |
| 5 | Invalid provider (3) | throws ConfigValidationError; message mentions invalid value; message mentions valid options |
| 6 | Missing API key (2) | throws when DEEPSEEK_API_KEY unset; error names DEEPSEEK_API_KEY |
| 7 | Missing model (2) | throws when DEEPSEEK_MODEL unset; error names DEEPSEEK_MODEL |
| 8 | Mock ignores DeepSeek vars (2) | succeeds without DeepSeek vars; succeeds with DeepSeek vars present |
| 9 | Empty as missing (4) | empty API key; whitespace API key; empty model; whitespace model |
| 10 | Secret protection (3) | no API key value in model-missing error; no "sk-" prefix in key-missing error; no unrelated secret values in errors |
| 11 | Trimming (2) | AI_PROVIDER trimmed; DeepSeek config values trimmed |

#### create-ai-service.test.ts (10 tests)

| # | Category | Tests |
|---|---|---|
| 11 | Mock provider (2) | returns MockAIService instance; functional MockAIService with defaults |
| 12 | DeepSeek provider (2) | returns DeepSeekAIService instance; functional DeepSeekAIService (mocked fetch) |
| 13 | Options mapping (4) | apiKey mapped correctly; model mapped correctly; baseUrl mapped when present; default URL when baseUrl absent |
| 14 | No silent fallback (2) | unknown provider throws; invalid config does not silently become mock |

### Total Test Count

**193 tests** across 11 test files, all passing. (Previously 156 tests across 9 test files; +37 new tests.)

---

# Verification

All verification commands completed successfully.

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ Passed (0 errors) |
| `npm test` (backend) | ✅ 11 test files passed / 193 tests passed |
| `npm run build` | ✅ Backend compiled successfully |
| `git diff --check` | ✅ No whitespace issues |
| `git status --short` | ✅ 2 modified, 5 new files |
| `git diff --stat` | ✅ +19/-1 lines in existing files |

Additionally verified:

- `git diff` inspected for secrets — no real API keys or credentials appear in the diff
- All test values use placeholder strings (`"sk-test-key-12345"`, `"sk-custom-key-abc"`)
- `.env.example` contains only empty values and public defaults

---

# Architecture Notes

### Dependency Graph

```
Environment variables (process.env)
        ↓
loadAppConfig(env) → AppConfig
        ↓
createAIService(config.ai) → AIService
        ↓
createApp({ aiService }) → Express app
        ↓
Routes (unchanged)
```

The dependency graph was established across three files:

| File | Role |
|---|---|
| `backend/src/config/AppConfig.ts` | Types, pure loader, validation |
| `backend/src/ai/createAIService.ts` | Single composition point for provider selection |
| `backend/src/index.ts` | Composition root — wires config → factory → app |

### Layer Relationships

```
index.ts (composition root)
    │
    ├── loadAppConfig(process.env)      ← reads env once
    │       ↓
    │   AppConfig (validated)
    │
    ├── createAIService(config.ai)       ← provider selection
    │       ↓
    │   AIService (concrete)
    │
    └── createApp({ aiService })         ← injection
            ↓
        Express app
            │
            ├── Routes (unchanged)
            ├── Repositories (unchanged)
            └── AIService available for future controller wiring
```

Controllers (`RoundController`, `DiscussionController`) remain unchanged. They continue to accept `AIService` through constructor injection.

### Responsibility Separation

| Component | Responsibility |
|---|---|
| `loadAppConfig` | Parse and validate environment into typed config (pure function) |
| `createAIService` | Select and construct the concrete AIService (single composition point) |
| `createApp` | Wire dependencies into the Express application |
| `RoundController` | Single-panelist turn execution (unchanged) |
| `DiscussionController` | Discussion round orchestration (unchanged) |
| `AIService` (interface) | Provider-independent AI text generation (unchanged) |
| `MockAIService` | Deterministic in-memory AI for testing (unchanged) |
| `DeepSeekAIService` | DeepSeek API HTTP calls (unchanged) |

### Key Design Properties

- **Centralized provider selection**: `createAIService` is the only function that branches on provider type
- **Pure configuration loading**: `loadAppConfig(env)` is a pure function — given the same environment, it always returns the same result
- **Early validation**: Invalid configuration fails before `app.listen()` — no half-configured server starts
- **Safe default**: `MockAIService` when no provider is specified — zero configuration for development
- **Provider-agnostic controllers**: `RoundController` and `DiscussionController` depend only on the `AIService` interface
- **No process.env pollution**: Only `index.ts` reads `process.env`; all other modules receive configuration through typed parameters
- **Secret safety**: Error messages name missing keys, never expose values

---

# Review

The implementation was reviewed by inspecting:

- `loadAppConfig` function and all internal helpers
- `createAIService` factory function
- `AppDependencies` extension in `app.ts`
- `index.ts` composition root
- `.env.example` content
- All 37 new unit tests
- Git diff for secret exposure

The review confirmed:

- proper `AIService` interface conformance (no changes needed)
- `loadAppConfig` is a pure function — receives env object, never reads `process.env` directly
- `createAIService` is the single composition point for provider selection
- `MockAIService` remains the safe default when `AI_PROVIDER` is unset
- DeepSeek configuration (apiKey, model) validated before application startup
- `DEEPSEEK_BASE_URL` correctly handled as optional
- unsupported provider values fail immediately with `ConfigValidationError`
- empty and whitespace-only values treated as missing
- error messages identify missing keys but never include secret values
- no `process.env` access in `DeepSeekAIService`, `createAIService`, or `loadAppConfig`
- `process.env` read only at the composition root in `index.ts`
- `AppDependencies` extended with `aiService` field — backward compatible via `MockAIService` fallback
- no changes to `AIService`, `MockAIService`, `DeepSeekAIService`, `PromptBuilder`
- no changes to `RoundController` or `DiscussionController`
- no changes to repositories, domain entities, or REST routes
- existing REST behavior intentionally preserved
- `.env.example` contains placeholder values only — no real credentials
- no real credentials in any committed or modified file
- `.gitignore` already covers `.env` files
- no new REST endpoints, streaming, retries, or provider fallback
- all 193 tests pass (37 new, 156 existing unchanged)

No code changes were required after review.

---

# Scope Boundaries Respected

The following were **not** introduced:

- ✅ No modifications to `AIService` interface
- ✅ No modifications to `MockAIService`
- ✅ No modifications to `DeepSeekAIService`
- ✅ No modifications to `PromptBuilder`
- ✅ No modifications to `RoundController`
- ✅ No modifications to `DiscussionController`
- ✅ No modifications to repository interfaces or implementations
- ✅ No modifications to domain entities
- ✅ No modifications to REST routes
- ✅ No changes to request handling logic
- ✅ No changes to runtime behavior
- ✅ No new REST endpoints
- ✅ No streaming
- ✅ No retries
- ✅ No timeout policies
- ✅ No rate limiting
- ✅ No caching
- ✅ No provider fallback
- ✅ No provider routing per request
- ✅ No multiple DeepSeek models per discussion
- ✅ No tool calling / function calling
- ✅ No host moderation
- ✅ No frontend settings
- ✅ No database persistence for configuration
- ✅ No secret management services
- ✅ No real API integration tests
- ✅ No real API calls during startup
- ✅ No `process.env` access in `DeepSeekAIService`
- ✅ No `process.env` access in `createAIService`
- ✅ No `process.env` access in controllers
- ✅ No provider-specific conditionals in controllers
- ✅ No provider-specific conditionals in routes
- ✅ No global mutable service state
- ✅ No real credentials committed
- ✅ No real `.env` file created or modified

---

# Result

**Milestone 10 completed successfully.**

The project now has explicit AI provider configuration and dependency injection. The dependency graph is:

```
process.env
        ↓
loadAppConfig(env) → AppConfig
        ↓
createAIService(config.ai) → AIService
        ↓
createApp({ aiService }) → Express app
```

The application can select between `MockAIService` and `DeepSeekAIService` through the `AI_PROVIDER` environment variable without changing any controller, repository, domain, or route code.

Provider selection is centralized in `createAIService`. Configuration validation runs at startup and fails fast with descriptive, secure error messages. Controllers remain provider-agnostic, depending only on the `AIService` interface.

Subsequent milestones can build on this foundation to wire controllers into routes, add real-time discussion orchestration, and integrate additional AI providers without modifying the established configuration or composition architecture.
