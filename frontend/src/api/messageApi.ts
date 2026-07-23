/**
 * Typed API layer for Message endpoints.
 */

import type { Message } from "../types/message.js";

/** Fetch all messages for a given discussion, in insertion order. */
export async function fetchMessages(discussionId: string): Promise<Message[]> {
  const res = await fetch(`/api/discussions/${discussionId}/messages`);
  if (!res.ok) {
    throw new Error(`Failed to fetch messages: ${res.status}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// TODO — Missing backend endpoints
// ─────────────────────────────────────────────────────────────
//
// The POST /api/discussions/:id/messages endpoint exists but is
// meant for user messages only. AI-generated messages with
// panelistId / kind / replyToMessageId are created server-side
// by the RoundController and streamed via SSE.
//
// The frontend will receive messages via SSE events rather than
// polling this endpoint during an active discussion.
