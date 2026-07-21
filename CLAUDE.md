# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Panel Studio is an AI-powered roundtable discussion web app. Users input a discussion topic and expert count; the system dynamically generates a moderator and multiple experts with distinct backgrounds/positions via an LLM, then runs a real-time, autonomous discussion. The app displays the transcript, expert states, and live consensus/disagreement analysis.

## Tech Stack

| Layer    | Technology              |
| -------- | ----------------------- |
| Frontend | React, TypeScript, Vite |
| Backend  | Node.js, Express        |
| Database | SQLite                  |
| AI Model | DeepSeek V4 Pro         |
| Real-time| SSE or WebSocket        |

## Architecture

```
User → Web Frontend → Backend API Server → AI Agent System → LLM API
                         ↓
                    SQLite Database
```

### Core Modules (from SDD)

- **Discussion Manager** — create/manage discussions; isolate data between concurrent discussions
- **Expert Generator** — given a topic + count, generate 1 moderator + N experts (each with name, title, position, color)
- **Round Table Engine** — orchestrates the discussion: moderator controls flow, experts self-select to speak based on context; no fixed round-robin
- **Transcript Manager** — persist and push messages (speaker, content, timestamp)
- **Consensus Analyzer** — continuously analyze discussion to produce live consensus/disagreement; updates in real time, not only at the end

### Expert Agent State Machine

```
IDLE → THINKING → READY → SPEAKING → COOLDOWN → IDLE
```

- **IDLE**: no intent to participate
- **THINKING**: evaluating context, own stance, others' views
- **READY**: decided to participate, waiting for scheduling
- **SPEAKING**: actively delivering remarks
- **COOLDOWN**: just spoke, temporary backoff to avoid monopolizing

### Real-time Event Types (SSE/WebSocket)

- `expert_status_update` — expert state changes
- `message_created` — new transcript entry
- `consensus_updated` — consensus/disagreement changes

### Data Model

- **Discussion**: id, title, status, created_at
- **Expert**: id, discussion_id, name, title, position, color
- **Message**: id, discussion_id, speaker_id, content, created_at
- **Summary**: id, discussion_id, consensus, disagreement

### API Endpoints

| Method | Path                           | Purpose                 |
| ------ | ------------------------------ | ----------------------- |
| POST   | `/api/discussions`             | Create discussion       |
| GET    | `/api/discussions/:id`         | Get discussion info     |
| POST   | `/api/discussions/:id/experts` | Generate panelists      |
| GET    | `/api/discussions/:id/messages`| Get transcript          |
| SSE/WS | (real-time endpoint)           | Push events             |

## UI Layout (Studio Page)

Three-column layout:
- **Left**: Expert status cards (avatar/color, name, title, current state)
- **Center**: Transcript (real-time, auto-scroll, speaker name + title + content)
- **Right**: Live consensus & disagreement panel

## Key Constraints

- **API Key security**: LLM API key lives in backend env vars only; never exposed to browser
- **Multi-discussion isolation**: Transcripts, expert states, event streams, consensus data must be isolated per discussion
- **No fixed turn order**: Experts self-select; the scheduling engine picks based on relevance, value-add, stance alignment, and novelty
- **No raw CoT exposure**: Show expert status and short public thinking summary only; never expose full chain-of-thought
- **UI language**: Chinese throughout
- **Desktop-first**: MVP targets desktop browsers; core areas must have independent scrolling
- **No auth in MVP**: No user registration/login system

## MVP Scope (Included)

- Create/join discussions
- AI-generated moderator + expert panel
- Real-time autonomous roundtable discussion
- Live transcript with visual speaker identity
- Live consensus & disagreement tracking
- Discussion summary after moderator wrap-up
- SQLite persistence (survives page refresh)
- SSE/WebSocket real-time updates

## MVP Scope (Excluded)

- User registration/login
- Social sharing
- Complex permissions
- Mobile apps
- Non-discussion analytics
- Non-essential animations/effects

## Development Phases (from SDD)

1. Project scaffolding
2. Database setup
3. Discussion creation + expert generation
4. Real-time discussion engine
5. Summary & polish

## Key Documents

- `docs/PRD.md` — Product requirements
- `docs/SDD.md` — System design (modules, API, data flow, agent states)
- `docs/DDD.md` — UI/UX design (layout, interactions, responsive principles)
- `docs/TDD.md` — Test strategy (unit, API, real-time, E2E, priorities)
- `docs/ACCEPTANCE_CRITERIA.md` — Acceptance criteria checklist

## Directory Structure (planned, currently empty)

```
backend/     — Express API server, AI agent system, database layer
frontend/    — React + Vite SPA
tests/       — Test suites (unit, API, E2E)
prompts/     — LLM prompt templates
```

## Git Workflow

- Create a meaningful git commit after each completed milestone.
- Use conventional commit messages:
  - `docs:` — documentation changes
  - `feat:` — new features
  - `fix:` — bug fixes
  - `refactor:` — code restructuring without functional changes
  - `test:` — test additions or changes
- Avoid large commits that contain unrelated changes.
- Before each commit, explain what changed and why.

## Prompt Recording

This project is evaluated on AI collaboration.

Record every important prompt under the `prompts/` directory.

Each prompt record should include:

- **Goal** — what the prompt was trying to achieve
- **Context** — what had been done before this prompt
- **Prompt** — the exact prompt given to the AI
- **Claude's output summary** — what Claude produced or suggested
- **Final decision** — whether the output was accepted, modified, or rejected, and why

## AI Collaboration Rules

Before implementing any feature:

1. Read `docs/PRD.md`
2. Read `docs/SDD.md`
3. Read `docs/DDD.md`
4. Read `docs/TDD.md`
5. Read `docs/ACCEPTANCE_CRITERIA.md`

Never skip the design documents.

Always explain major architectural decisions before implementation.

Prefer small iterative changes instead of generating a large amount of code at once.

Never overwrite user-written code without explaining the reason.

## Coding Guidelines

- Use TypeScript strict mode.
- Prefer readable code over clever code.
- Keep functions focused and small.
- Separate business logic from UI.
- Keep frontend and backend responsibilities independent.
- Use meaningful variable and function names.

## Development Workflow

The project follows this engineering process:

```
Requirements (PRD)
        ↓
  System Design (SDD)
        ↓
     Design (DDD)
        ↓
   Test Design (TDD)
        ↓
   Implementation
        ↓
      Testing
        ↓
      Review
        ↓
    Git Commit
```

Every feature should follow this workflow.

## Before Every Commit

Before creating a git commit:

- Summarize all modified files.
- Explain why the changes were made.
- Ask for confirmation before committing.
