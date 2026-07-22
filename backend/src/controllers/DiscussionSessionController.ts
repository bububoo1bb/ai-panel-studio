import { DiscussionEngine, RunDiscussionRequest } from "../services/DiscussionEngine.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { SessionLifecycle } from "../lifecycle/SessionLifecycle.js";
import { Message } from "../domain/message.js";

/**
 * Application-layer controller that wraps a bounded multi-round discussion
 * session with lifecycle hooks.
 *
 * Responsibilities:
 * - Validate {@link RunDiscussionRequest.maxRounds} before any side effects
 * - Validate discussion existence and reject already-finished discussions
 * - Invoke {@link SessionLifecycle.onSessionStart} before the first round
 * - Delegate all round execution to {@link DiscussionEngine}
 * - Invoke {@link SessionLifecycle.onSessionEnd} after normal engine completion
 * - Return all messages in chronological order
 *
 * DiscussionSessionController does **not** call {@link AIService},
 * PromptBuilder, RoundController, DiscussionController, MessageRepository,
 * or PanelistRepository directly.
 */
export class DiscussionSessionController {
  private readonly engine: DiscussionEngine;
  private readonly discussionRepo: DiscussionRepository;
  private readonly lifecycle: SessionLifecycle;

  constructor(deps: {
    discussionEngine: DiscussionEngine;
    discussionRepository: DiscussionRepository;
    lifecycle: SessionLifecycle;
  }) {
    this.engine = deps.discussionEngine;
    this.discussionRepo = deps.discussionRepository;
    this.lifecycle = deps.lifecycle;
  }

  /**
   * Run a complete discussion session with lifecycle boundaries.
   *
   * Execution order:
   * 1. Validate `maxRounds` — invalid values throw before any side effect
   * 2. Load the discussion — throw if not found; return `[]` if finished
   * 3. Invoke `lifecycle.onSessionStart()`
   * 4. Delegate to `engine.runDiscussion()`
   * 5. Invoke `lifecycle.onSessionEnd()` (only on normal engine completion)
   * 6. Return all Messages in chronological order
   *
   * If any step throws the error propagates unchanged.  No later lifecycle
   * hook executes after an error.
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

    // ── 4. Delegate to engine ───────────────────────────────────
    const engineMessages = await this.engine.runDiscussion(request);

    // ── 5. Session end hook (normal completion only) ────────────
    const endMessages = await this.lifecycle.onSessionEnd({ discussionId });

    // ── 6. Return chronological transcript ──────────────────────
    return [...startMessages, ...engineMessages, ...endMessages];
  }
}
