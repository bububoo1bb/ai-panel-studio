import { DiscussionEngine, RunDiscussionRequest } from "../services/DiscussionEngine.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { SessionLifecycle } from "../lifecycle/SessionLifecycle.js";
import { ModeratorStrategy } from "../moderator/ModeratorStrategy.js";
import { Message } from "../domain/message.js";

/**
 * Application-layer controller that wraps a bounded multi-round discussion
 * session with lifecycle hooks.
 *
 * Responsibilities:
 * - Validate {@link RunDiscussionRequest.maxRounds} before any side effects
 * - Validate discussion existence and reject already-finished discussions
 * - Invoke {@link SessionLifecycle.onSessionStart} before the first round
 * - Delegate round execution to {@link DiscussionEngine}
 * - Insert moderator interventions between round batches (M16.5)
 * - Invoke {@link SessionLifecycle.onSessionEnd} after normal engine completion
 * - Return all messages in chronological order
 *
 * DiscussionSessionController does **not** call {@link AIService},
 * PromptBuilder, RoundController, or DiscussionController directly.
 */
export class DiscussionSessionController {
  private readonly engine: DiscussionEngine;
  private readonly discussionRepo: DiscussionRepository;
  private readonly messageRepo: MessageRepository | undefined;
  private readonly lifecycle: SessionLifecycle;
  private readonly moderator: ModeratorStrategy | undefined;

  constructor(deps: {
    discussionEngine: DiscussionEngine;
    discussionRepository: DiscussionRepository;
    lifecycle: SessionLifecycle;
    /** Optional — enables moderator interventions between round batches. */
    messageRepository?: MessageRepository;
    /** Optional — enables moderator interventions between round batches. */
    moderatorStrategy?: ModeratorStrategy;
  }) {
    this.engine = deps.discussionEngine;
    this.discussionRepo = deps.discussionRepository;
    this.messageRepo = deps.messageRepository;
    this.lifecycle = deps.lifecycle;
    this.moderator = deps.moderatorStrategy;
  }

  /**
   * Run a complete discussion session with lifecycle boundaries
   * and moderator interventions between round batches.
   *
   * Execution order (M16.5 enhanced):
   * 1. Validate `maxRounds` — invalid values throw before any side effect
   * 2. Load the discussion — throw if not found; return `[]` if finished
   * 3. Invoke `lifecycle.onSessionStart()` → moderator opening
   * 4. Run expert rounds in batches with moderator interventions between:
   *    → engine.runDiscussion(batch) → moderator.intervene() → ...
   * 5. Invoke `lifecycle.onSessionEnd()` → moderator closing
   * 6. Return all Messages in chronological order
   *
   * If any step throws the error propagates unchanged.  No later lifecycle
   * hook executes after an error.
   *
   * @remarks
   * When `moderator` and `messageRepo` are provided, the session splits
   * maxRounds into batches of 2, inserting moderator interventions
   * between each batch.  When absent, falls back to the M16 behaviour
   * of running all rounds at once.
   */
  async runSession(request: RunDiscussionRequest): Promise<Message[]> {
    const { discussionId, maxRounds } = request;

    // ── 1. Validate maxRounds (before any side effect) ──────────
    if (typeof maxRounds !== "number") {
      throw new Error("maxRounds must be a number");
    }
    if (!Number.isFinite(maxRounds)) {
      throw new Error("maxRounds must be finite");
    }
    if (!Number.isInteger(maxRounds)) {
      throw new Error("maxRounds must be an integer");
    }
    if (maxRounds <= 0) {
      throw new Error("maxRounds must be greater than zero");
    }

    // ── 2. Load discussion ──────────────────────────────────────
    const discussion = await this.discussionRepo.findById(discussionId);
    if (discussion === null) {
      throw new Error("Discussion not found");
    }
    if (discussion.status === "finished") {
      return [];
    }

    // ── 3. Session start hook ───────────────────────────────────
    const startMessages = await this.lifecycle.onSessionStart({ discussionId });

    // ── 4. Run rounds with moderator interventions ──────────────
    const allMessages: Message[] = [...startMessages];
    const BATCH_SIZE = 5;

    if (this.moderator && this.messageRepo) {
      let remaining = maxRounds;
      while (remaining > 0) {
        const current = await this.discussionRepo.findById(discussionId);
        if (!current || current.status !== "active") break;

        const batchRounds = Math.min(BATCH_SIZE, remaining);

        const batchMessages = await this.engine.runDiscussion({
          discussionId,
          maxRounds: batchRounds,
        });
        allMessages.push(...batchMessages);

        remaining -= batchRounds;
        if (remaining <= 0) break;

        const recheck = await this.discussionRepo.findById(discussionId);
        if (!recheck || recheck.status !== "active") break;

        const recentMessages = allMessages.slice(-12).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const intervention = await this.moderator.intervene(
          discussionId,
          recentMessages,
        );

        const persistedIntervention = await this.messageRepo.create({
          discussionId,
          role: "assistant",
          content: intervention.content,
          panelistId: intervention.panelistId,
          kind: intervention.kind,
        });

        allMessages.push(persistedIntervention);
      }
    } else {
      // Fallback M16: run all rounds at once
      const engineMessages = await this.engine.runDiscussion(request);
      allMessages.push(...engineMessages);
    }

    // ── 5. Session end hook ────────────────────────────────────
    const endMessages = await this.lifecycle.onSessionEnd({ discussionId });
    allMessages.push(...endMessages);

    // ── 6. Return chronological transcript ──────────────────────
    return allMessages;
  }
}
