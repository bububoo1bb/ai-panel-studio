import { Panelist } from "../domain/panelist.js";

/**
 * Context passed to the scheduler for making a selection decision.
 */
export interface SchedulingContext {
  discussionId: string;
  /** The discussion topic. */
  topic: string;
  /** All active expert panelists (excludes host and finished). */
  candidates: Panelist[];
  /** How many expert turns have been executed so far. */
  turnCount: number;
  /** Recent messages (last N) for rebuttal/context analysis. */
  recentTranscript: Array<{
    role: "user" | "assistant";
    content: string;
    panelistId: string | null;
  }>;
}

/**
 * Selects the next speaker dynamically based on expert desire scores
 * rather than a fixed round-robin order.
 */
export interface SpeakingScheduler {
  /**
   * Select the next expert to speak, or null if no one wants to.
   *
   * The implementation should:
   * - Evaluate each candidate's speaking desire via a {@link ReactionEvaluator}
   * - Apply cooldown for recently-spoken panelists
   * - Respect moderator overrides when present
   * - Return the highest-scoring candidate above the raise-hand threshold
   */
  selectNextSpeaker(context: SchedulingContext): Promise<Panelist | null>;
}
