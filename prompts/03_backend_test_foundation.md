# Prompt 03 - Backend Test Foundation

**Stage:** Implementation Phase - Milestone 2

**Date:** 2026-07-22

---

# Goal

Improve the backend architecture by separating the Express application from the server startup process and establish the initial automated API testing foundation.

This milestone focuses exclusively on backend infrastructure and testing. No business logic, database integration, domain models, AI functionality, or frontend changes are introduced.

---

# Context

Before implementation, Claude Code was instructed to read:

- CLAUDE.md
- docs/SDD.md
- docs/TDD.md
- docs/project-analysis.md
- backend/package.json
- backend/src/index.ts
- backend/tsconfig.json
- tsconfig.base.json

The existing backend already provided a functional `/api/health` endpoint. The objective was to improve the project architecture and prepare for future TDD-driven development.

---

# Prompt

```text
Read the following files before making changes:

- CLAUDE.md
- docs/SDD.md
- docs/TDD.md
- docs/project-analysis.md
- backend/package.json
- backend/src/index.ts
- backend/tsconfig.json
- tsconfig.base.json

Your task is to improve the backend structure and establish the initial API test foundation.

Do not implement any discussion, expert, message, database, repository, or AI-related functionality.

## Goals

1. Separate the Express application from the server startup.
2. Preserve the existing health endpoint behavior.
3. Add an automated API test for the health endpoint.
4. Keep the scope limited to backend infrastructure and testing.

## Required Structure

Refactor the backend into:

backend/src/app.ts
backend/src/index.ts
backend/src/tests/health.test.ts

## Application Requirements

### backend/src/app.ts

- Create and configure the Express application.
- Configure CORS.
- Configure JSON body parsing.
- Define GET /api/health.
- Return:

{
  "status": "ok"
}

- Export the Express app.
- Do not call app.listen().
- Do not load environment variables.

### backend/src/index.ts

- Load environment variables.
- Import the Express app.
- Read PORT from environment, defaulting to 3000.
- Start the HTTP server.
- Do not redefine middleware or routes.

## Testing Requirements

Use:

- Vitest
- Supertest

Create an automated test for:

GET /api/health

The test must:

- verify HTTP 200
- verify response body equals { "status": "ok" }
- import app directly
- never import index.ts
- never start a real server

## Package Configuration

Update backend/package.json.

Add:

- test
- test:watch

Do not remove existing scripts.

## Verification

Run:

npm install
npm run typecheck
npm run test -w backend
npm run build -w backend

Fix any failures before finishing.

## Constraints

- No database
- No repositories
- No domain models
- No Discussion APIs
- No frontend
- No documentation changes
- Stop after completing this milestone.
```

---

# Files Created

```
backend/src/app.ts
backend/src/tests/health.test.ts
backend/vitest.config.ts
```

# Files Modified

```
backend/src/index.ts
backend/package.json
package-lock.json
```

---

# Output Summary

Claude Code completed the following tasks:

- Extracted the Express application into `app.ts`.
- Left `index.ts` responsible only for environment loading and server startup.
- Preserved the `/api/health` endpoint.
- Added Vitest.
- Added Supertest.
- Added the first automated backend API test.
- Added backend test scripts.
- Added a dedicated Vitest configuration.

No unrelated files were modified.

---

# Verification

All verification commands completed successfully.

| Command | Result |
|---------|--------|
| `npm install` | ✅ Success |
| `npm run typecheck` | ✅ All workspaces passed |
| `npm run test -w backend` | ✅ 1 test passed |
| `npm run build -w backend` | ✅ Backend compiled successfully |

---

# Code Review

The implementation was manually reviewed.

## app.ts

✅ Responsibilities are limited to:

- Express initialization
- Middleware registration
- Route registration
- Exporting the application

No server startup logic exists.

---

## index.ts

✅ Responsibilities are limited to:

- Loading environment variables
- Reading PORT
- Starting the HTTP server

No middleware or routes are duplicated.

---

## health.test.ts

✅ Uses:

```ts
request(app)
```

instead of:

```ts
request("http://localhost:3000")
```

Therefore:

- no network port is opened
- tests execute entirely in memory
- suitable for CI/CD pipelines

---

## package.json

Confirmed:

- Express 4.x
- @types/express 4.x
- Vitest
- Supertest
- @types/supertest

Script configuration is complete.

---

## vitest.config.ts

Configuration is intentionally minimal.

Only:

```
src/tests/**/*.test.ts
```

is included.

No unnecessary global configuration was introduced.

---

# Engineering Improvements

This milestone introduced a cleaner backend architecture.

Previous structure:

```
index.ts

├── Express setup
├── Routes
└── app.listen()
```

Current structure:

```
app.ts

├── Express setup
├── Middleware
└── Routes

↓

index.ts

└── Server startup
```

Benefits:

- Improved separation of concerns
- Better maintainability
- Easier unit and integration testing
- No side effects when importing the Express app
- Better support for future CI pipelines

---

# Reflection

This milestone marks the transition from a runnable backend to a testable backend.

The most significant architectural improvement is separating the Express application from the server lifecycle.

With the introduction of Vitest and Supertest, future API development can follow a consistent workflow:

```
Implement API
      ↓
Write Test
      ↓
Run Verification
      ↓
Code Review
      ↓
Git Commit
```

The backend now has a reusable testing foundation that supports future development of Discussion APIs, repositories, services, and AI integration without requiring a running HTTP server.

This milestone also reinforced an important engineering principle:

> A working application is not enough; it should also be testable, maintainable, and independently verifiable.

---

# Result

**Milestone 2 completed successfully.**

Status:

- ✅ Backend architecture improved
- ✅ Automated API testing established
- ✅ Verification passed
- ✅ Manual Code Review passed
- ✅ Ready for Milestone 3