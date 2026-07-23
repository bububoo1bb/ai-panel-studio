import { DiscussionInsight, CreateInsightInput } from "../domain/insight.js";

/**
 * Persistence abstraction for DiscussionInsight entities.
 */
export interface InsightRepository {
  /** Persist a new insight and return the saved entity. */
  create(input: CreateInsightInput): Promise<DiscussionInsight>;

  /** Return the insight for the given discussion, or null. */
  findByDiscussionId(discussionId: string): Promise<DiscussionInsight | null>;
}
