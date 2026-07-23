import { MessageKind } from "../domain/message.js";

/**
 * The output of a moderator strategy call.
 *
 * Contains the data required to construct a persisted {@link Message},
 * but does NOT perform the persistence itself.  Message persistence
 * is owned by the execution orchestration layer
 * ({@link AISessionLifecycle} / {@link DiscussionSessionController}).
 */
export interface ModeratorMessage {
  /** The AI-generated public moderator text. */
  content: string;
  /** The host panelist who authored this message. */
  panelistId: string;
  /** The conversational function — "moderator_opening" or "moderator_closing". */
  kind: MessageKind;
}

/**
 * Abstraction for moderator intelligence in a roundtable discussion.
 *
 * Implementations produce moderator content (opening statements, closing
 * summaries, and in future milestones expert introductions and bridging
 * transitions) without directly persisting messages.
 *
 * ## Responsibility boundary
 *
 * - **ModeratorStrategy** — WHAT the moderator says (content, prompts, AI calls)
 * - **SessionLifecycle** — WHEN the moderator speaks (before rounds, after rounds)
 * - **Execution orchestration layer** — persists messages returned by the strategy
 *
 * This separation prevents {@link SessionLifecycle} from accumulating AI
 * orchestration logic and keeps moderator intelligence independently
 * evolvable.
 */
export interface ModeratorStrategy {
  /**
   * Generate the moderator's opening statement.
   *
   * The implementation should:
   * - Load the discussion and host panelist
   * - Build a moderator-specific opening prompt
   * - Call the AI service
   * - Return content + metadata (NOT a persisted Message)
   */
  openDiscussion(discussionId: string): Promise<ModeratorMessage>;

  /**
   * Generate a mid-discussion moderator intervention.
   *
   * Called between rounds to bridge expert statements, highlight
   * emerging themes, note disagreements, and guide the discussion
   * toward deeper exploration.
   *
   * @param discussionId - The discussion to intervene in.
   * @param recentMessages - Recent transcript messages for context
   *   (role + content only, not full Message objects).
   *
   * The implementation should:
   * - Load the discussion, host, and use provided messages for context
   * - Build an intervention prompt that references recent exchanges
   * - Call the AI service
   * - Return content + metadata (NOT a persisted Message)
   */
  intervene(
    discussionId: string,
    recentMessages: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<ModeratorMessage>;

  /**
   * Generate the moderator's closing statement.
   *
   * The implementation should:
   * - Load the discussion and host panelist
   * - Build a moderator-specific closing prompt
   * - Call the AI service
   * - Return content + metadata (NOT a persisted Message)
   */
  closeDiscussion(discussionId: string): Promise<ModeratorMessage>;
}
