/** A single divergence entry in the final insight. */
export interface DivergenceEntry {
  expertA: string;
  expertAView: string;
  expertB: string;
  expertBView: string;
  conflictSummary: string;
}

/**
 * Persisted discussion insight.
 *
 * - Realtime insights are ephemeral (computed live, not persisted).
 * - Final Insight is generated once when discussion ends, then locked.
 */
export interface DiscussionInsight {
  /** Unique identifier. */
  id: string;
  /** The discussion this insight belongs to. */
  discussionId: string;
  /** Summarized consensus points (natural language). */
  consensus: string[];
  /** Structured divergence with named expert pairs. */
  divergence: DivergenceEntry[];
  /** Moderator's closing summary (1-2 sentences). */
  summary: string;
  /** Whether this insight is locked (true after final generation). */
  locked: boolean;
  /** ISO 8601 timestamp of creation. */
  createdAt: string;
}

/** Data required to create a DiscussionInsight. */
export interface CreateInsightInput {
  discussionId: string;
  consensus: string[];
  divergence: DivergenceEntry[];
  summary: string;
}
