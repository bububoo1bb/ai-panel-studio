# M14 — Frontend Implementation Report

## Summary

Implemented the complete frontend MVP for AI Panel Studio per the DDD.md design document. The frontend is a React + TypeScript + Vite SPA that communicates with the existing Express backend via REST APIs (proxied through Vite dev server).

## Implemented Pages

| Route | Page | DDD Reference | Status |
|---|---|---|---|
| `/` | DashboardPage | §2.1 首页 Dashboard | ✅ Done |
| `/create` | CreateDiscussionPage | §2.2 创建讨论页面 | ✅ Done |
| `/discussion/:id/confirm` | ConfirmPanelistsPage | §2.3 嘉宾确认页面 | ✅ Done |
| `/discussion/:id` | DiscussionRoomPage | §3 演播厅页面设计 | ✅ Done |

## Component Mapping (DDD → Code)

### Dashboard (§2.1)
- **DiscussionList** → `components/discussion/DiscussionList.tsx`
- **DiscussionCard** → `components/discussion/DiscussionCard.tsx`
  - Displays: topic, created time, status, expert count per DDD

### Create Discussion (§2.2)
- **DiscussionForm** → `components/discussion/DiscussionForm.tsx`
  - Inputs: discussion topic, number of experts (2–8, default 4)

### Panelist Confirmation (§2.3)
- **ConfirmPanelistsPage** → `pages/ConfirmPanelistsPage.tsx`
  - Shows host + experts with: name, occupation, title, stance, color per DDD
  - User confirms before entering studio

### Studio Room (§3)

Three-column layout per DDD §3.1:

| Column | Component | DDD Reference | Purpose |
|---|---|---|---|
| Left | `ExpertPanel` + `ExpertCard` | §3.2 左侧专家状态区域 | Panelist status cards with color identity |
| Center | `TranscriptPanel` + `MessageBubble` | §3.3 中央 Transcript区域 | Live transcript with speaker identity |
| Right | `InsightPanel` | §3.4 右侧共识与分歧区域 | Consensus & divergence analysis |

## Frontend Architecture

```
frontend/src/
├── api/                    # Typed API layer
│   ├── discussionApi.ts    # CRUD for discussions
│   ├── panelistApi.ts      # CRUD for panelists
│   ├── messageApi.ts       # CRUD for messages
│   └── index.ts
├── types/                  # TypeScript types mirroring backend domain
│   ├── discussion.ts       # Discussion, DiscussionStatus
│   ├── panelist.ts         # Panelist, PanelistStatus, PanelistRole
│   ├── message.ts          # Message, MessageRole, MessageKind
│   └── index.ts
├── components/
│   └── discussion/
│       ├── DiscussionCard.tsx    + .module.css
│       ├── DiscussionList.tsx    + .module.css
│       ├── DiscussionForm.tsx    + .module.css
│       ├── ExpertCard.tsx        + .module.css
│       ├── ExpertPanel.tsx       + .module.css
│       ├── MessageBubble.tsx     + .module.css
│       ├── TranscriptPanel.tsx   + .module.css
│       └── InsightPanel.tsx      + .module.css
├── pages/
│   ├── DashboardPage.tsx         + .module.css
│   ├── CreateDiscussionPage.tsx  + .module.css
│   ├── ConfirmPanelistsPage.tsx  + .module.css
│   └── DiscussionRoomPage.tsx    + .module.css
├── styles/
│   └── global.css               # Design tokens, reset, utilities
├── App.tsx                       # React Router configuration
├── main.tsx                      # Entry point
└── css-modules.d.ts              # Type declarations for CSS modules
```

## Design Decisions

### Visual Language
- **Studio/broadcast feel**: dark background palette (`--color-bg-primary: #0d0f14`), warm amber accent (`--color-accent: #e2a83e`) for the "on air" studio light feel
- **Expert identity**: each panelist has a unique color used as avatar background, card left border, and speaker name color — ensures clear visual distinction per DDD
- **Desktop-first**: three-column fixed layout at 260px / flex / 280px with independent scrolling per area
- **Chinese UI**: all labels, status text, and user-facing strings in Chinese per PRD requirement

### State Design
- Expert states map directly to backend `PanelistStatus`: `waiting`, `preparing`, `speaking`, `finished`
- Discussion lifecycle: `active` (running) or `finished`
- No raw Chain-of-Thought exposed — only `publicSummary` and `currentFocus` displayed

### API Layer
- Typed functions for all existing backend endpoints
- TODO comments documenting missing endpoints needed for full MVP:
  - `POST /api/discussions/:id/start` — start discussion engine
  - `GET /api/discussions/:id/events` — SSE real-time stream
  - `POST /api/discussions/:id/panelists/generate` — AI panelist generation
  - `GET /api/discussions/:id/summary` — consensus/divergence data

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` (typecheck) | ✅ Pass |
| `tsc -b && vite build` | ✅ Pass (69 modules, 198 KB JS + 19 KB CSS) |
| `vitest run` (backend 281 tests) | ✅ All 14 test files / 281 tests pass |

## Limitations & Future Work

### Limitations
1. **No real-time updates**: SSE endpoint not yet implemented; DiscussionRoom loads data once on mount
2. **Demo panelist generation**: ConfirmPanelistsPage uses hardcoded demo data instead of calling an AI generation endpoint
3. **No discussion start/stop controls**: the backend engine requires a direct API call to start; no UI controls exist yet
4. **InsightPanel is static**: consensus/divergence data has no backend endpoint; panel shows placeholder state
5. **No user messages**: the UI only displays AI-generated messages; user input during discussion is not yet supported

### Future Work
1. Implement backend SSE endpoint and connect `DiscussionRoomPage` to real-time events
2. Implement `POST /api/discussions/:id/panelists/generate` for AI panelist generation
3. Add discussion start/stop controls in the studio UI
4. Implement `GET /api/discussions/:id/summary` and connect `InsightPanel`
5. Add user message input during active discussions
6. Add discussion summary view after the moderator closing
7. Add loading skeletons and error boundary components

## Files Created (26 files)

```
frontend/src/types/discussion.ts
frontend/src/types/panelist.ts
frontend/src/types/message.ts
frontend/src/types/index.ts
frontend/src/api/discussionApi.ts
frontend/src/api/panelistApi.ts
frontend/src/api/messageApi.ts
frontend/src/api/index.ts
frontend/src/styles/global.css
frontend/src/css-modules.d.ts
frontend/src/components/discussion/DiscussionCard.tsx
frontend/src/components/discussion/DiscussionCard.module.css
frontend/src/components/discussion/DiscussionList.tsx
frontend/src/components/discussion/DiscussionList.module.css
frontend/src/components/discussion/DiscussionForm.tsx
frontend/src/components/discussion/DiscussionForm.module.css
frontend/src/components/discussion/ExpertCard.tsx
frontend/src/components/discussion/ExpertCard.module.css
frontend/src/components/discussion/ExpertPanel.tsx
frontend/src/components/discussion/ExpertPanel.module.css
frontend/src/components/discussion/MessageBubble.tsx
frontend/src/components/discussion/MessageBubble.module.css
frontend/src/components/discussion/TranscriptPanel.tsx
frontend/src/components/discussion/TranscriptPanel.module.css
frontend/src/components/discussion/InsightPanel.tsx
frontend/src/components/discussion/InsightPanel.module.css
frontend/src/pages/DashboardPage.tsx
frontend/src/pages/DashboardPage.module.css
frontend/src/pages/CreateDiscussionPage.tsx
frontend/src/pages/CreateDiscussionPage.module.css
frontend/src/pages/ConfirmPanelistsPage.tsx
frontend/src/pages/ConfirmPanelistsPage.module.css
frontend/src/pages/DiscussionRoomPage.tsx
frontend/src/pages/DiscussionRoomPage.module.css
```

## Files Modified (2 files)

```
frontend/src/App.tsx           — Added React Router with all routes
frontend/src/main.tsx          — Added global CSS import
```

## Dependencies Added

```
react-router-dom               — Client-side routing
```
