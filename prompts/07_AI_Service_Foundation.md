# Prompt 07 — AI Service Foundation

## Goal

Establish a provider-independent AI foundation for the backend.

This milestone introduces a unified AI abstraction layer, a deterministic mock implementation, and a reusable Prompt Builder for future discussion orchestration. No real AI provider integration is included in this milestone.

---

## Context

This milestone follows the completion of the core domain model:

- Discussion
- Message
- Panelist

The next milestones will require AI-generated discussion content. Before implementing orchestration logic or integrating external LLM providers, the project needs a stable abstraction that separates prompt construction, AI invocation, and business logic.

This milestone focuses only on the AI infrastructure.

---

## Prompt

Implement a provider-independent AI foundation including:

- AI request and response types
- AIService interface
- MockAIService
- PromptBuilder
- Unit tests

Requirements:

- No DeepSeek or other real AI providers
- No HTTP requests
- No environment variables
- No REST endpoints
- No discussion orchestration
- No frontend changes

The implementation must remain deterministic and fully testable.

---

## Files Created

```
backend/src/ai/
├── AIService.ts
├── MockAIService.ts
├── PromptBuilder.ts
└── types.ts

backend/src/tests/
├── ai-service.test.ts
└── prompt-builder.test.ts
```

---

## AI Architecture

Introduced a provider-independent abstraction:

```
Application
        │
        ▼
AIService (Interface)
        │
        ▼
MockAIService
```

The application layer depends only on the AIService interface.

Concrete providers (such as DeepSeek) can be introduced later without changing business logic.

---

## Prompt Builder

Implemented a reusable PromptBuilder responsible for constructing AI prompts.

Responsibilities include:

- Building deterministic system prompts
- Building ordered AI message lists
- Converting domain objects into provider-independent AI messages

PromptBuilder:

- does not access repositories
- does not call AI services
- does not mutate domain objects
- contains no provider-specific logic

---

## MockAIService

Implemented a deterministic in-memory AI service.

Features:

- configurable response content
- configurable model name
- optional usage statistics
- request history recording
- defensive copying of stored requests
- defensive copying of returned request history

No network requests, randomness, delays, or failure simulation were introduced.

---

## Testing

Added comprehensive unit tests covering:

### MockAIService

- default behavior
- configurable responses
- request recording
- request ordering
- defensive copy protection
- history clearing

### PromptBuilder

- deterministic prompt generation
- required panelist information
- discussion topic inclusion
- role mapping
- conversation ordering
- message preservation
- non-mutation guarantees

All new functionality is covered by unit tests.

---

## Verification

Completed successfully:

```bash
npm run typecheck
npm test
npm run build

git diff --check
git status --short
git diff --stat
```

Results:

- TypeScript compilation passed
- All tests passed (81 tests)
- Build succeeded
- No whitespace issues

---

## Architecture Notes

This milestone establishes the project's AI foundation.

Responsibilities are clearly separated:

```
PromptBuilder
        │
        ▼
AIService
        │
        ▼
AI Provider (future)
```

Future AI providers should implement the AIService interface without requiring changes to the application layer.

---

## Review

The implementation underwent architecture and code review.

The following components were inspected:

- AIService interface
- MockAIService implementation
- PromptBuilder implementation

The review confirmed:

- proper responsibility separation
- provider independence
- deterministic behavior
- defensive copy strategy
- correct domain field usage

No code changes were required after review.

---

## Result

Milestone 6 establishes a stable AI infrastructure for the project.

Subsequent milestones can focus on discussion orchestration and AI provider integration without modifying the established architecture.