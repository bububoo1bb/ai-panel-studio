/**
 * Typed API layer for Discussion endpoints.
 *
 * All functions call the existing backend REST API.
 * The Vite dev server proxies /api to http://localhost:3000.
 */

import type { Discussion } from "../types/discussion.js";

const API_BASE = "/api/discussions";

/** Fetch all discussions, ordered by insertion. */
export async function fetchDiscussions(): Promise<Discussion[]> {
  const res = await fetch(API_BASE);
  if (!res.ok) {
    throw new Error(`Failed to fetch discussions: ${res.status}`);
  }
  return res.json();
}

/** Fetch a single discussion by id. */
export async function fetchDiscussion(id: string): Promise<Discussion> {
  const res = await fetch(`${API_BASE}/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch discussion ${id}: ${res.status}`);
  }
  return res.json();
}

/** Create a new discussion with the given title and optional duration. */
export async function createDiscussion(
  title: string,
  durationLimit?: number,
): Promise<Discussion> {
  const body: Record<string, unknown> = { title };
  if (durationLimit !== undefined && durationLimit !== null) {
    body.durationLimit = durationLimit;
  }
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to create discussion: ${res.status}`);
  }
  return res.json();
}

/** Start the AI roundtable discussion for the given discussion. */
export async function startDiscussion(
  discussionId: string,
  maxRounds: number,
): Promise<void> {
  const res = await fetch(`${API_BASE}/${discussionId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxRounds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to start discussion: ${res.status}`);
  }
}

/** Stop a running discussion. */
export async function stopDiscussion(discussionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${discussionId}/stop`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to stop discussion: ${res.status}`);
  }
}

/** Insights returned by the backend analysis endpoint. */
export interface InsightData {
  consensus: string[];
  divergence: string[];
}

/** Fetch live consensus and divergence analysis. */
export async function fetchInsights(discussionId: string): Promise<InsightData> {
  const res = await fetch(`${API_BASE}/${discussionId}/insights`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to fetch insights: ${res.status}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// TODO — Missing backend endpoints
// ─────────────────────────────────────────────────────────────
//
//   POST /api/discussions/:id/finish
//     — Manually finish/stop a running discussion.
//
//   GET  /api/discussions/:id/summary
//     — Retrieve the current consensus & divergence summary.
//       Response: { consensus: string; disagreement: string }
//
//   GET  /api/discussions/:id/events (SSE)
//     — Server-Sent Events stream for real-time updates.
//       Events: expert_status_update, message_created, consensus_updated
