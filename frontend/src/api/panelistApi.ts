/**
 * Typed API layer for Panelist endpoints.
 */

import type { Panelist } from "../types/panelist.js";

/** Fetch all panelists for a given discussion. */
export async function fetchPanelists(discussionId: string): Promise<Panelist[]> {
  const res = await fetch(`/api/discussions/${discussionId}/panelists`);
  if (!res.ok) {
    throw new Error(`Failed to fetch panelists: ${res.status}`);
  }
  return res.json();
}

/**
 * Generate a panel of 1 host + N experts via AI for a discussion.
 *
 * Calls POST /api/discussions/:id/panelists/generate.
 * The generated panelists are persisted server-side and returned.
 */
export async function generatePanelists(
  discussionId: string,
  expertCount: number,
  signal?: AbortSignal,
): Promise<Panelist[]> {
  const res = await fetch(
    `/api/discussions/${discussionId}/panelists/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expertCount }),
      signal,
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error ?? `Failed to generate panelists: ${res.status}`,
    );
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────
// TODO — Missing backend endpoint
// ─────────────────────────────────────────────────────────────
//
//   PATCH /api/discussions/:id/panelists/:panelistId/status
//     — Update a panelist's status (for SSE-driven updates).
//       Request: { status: PanelistStatus; currentFocus?: string; publicSummary?: string }
