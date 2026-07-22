import { DiscussionController } from "../controllers/DiscussionController.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { Message } from "../domain/message.js";

/**
 * Request shape for {@link DiscussionEngine.runDiscussion}.
 *
 * - `discussionId` identifies the discussion to run.
 * - `maxRounds` is a required safety boundary. The engine will execute at most
 *   this many rounds before stopping, even if no other stop condition is met.
 */
export interface RunDiscussionRequest {
  discussionId: string;
  maxRounds: number;
}

/**
 * Application-layer service that orchestrates multiple discussion rounds.
 *
 * Responsibilities:
 * - Validate `maxRounds` as a positive finite integer
 * - Loop sequentially up to `maxRounds`
 * - Before every round: reload discussion → stop if finished;
 *   reload panelists → stop if none active
 * - Delegate each round to {@link DiscussionController}
 * - Collect and return all generated {@link Message}s in execution order
 *
 * DiscussionEngine depends only on the abstractions required for
 * orchestration. It does not call AIService, PromptBuilder, or
 * MessageRepository directly.
 *
 * This milestone is orchestration only. The engine does not mutate
 * discussion or panelist statuses, does not persist engine state, and
 * does not introduce cancellation, resume, or retry semantics.
 */
export class DiscussionEngine {
  private readonly discussionController: DiscussionController;
  private readonly discussionRepo: DiscussionRepository;
  private readonly panelistRepo: PanelistRepository;

  constructor(deps: {
    discussionController: DiscussionController;
    discussionRepository: DiscussionRepository;
    panelistRepository: PanelistRepository;
  }) {
    this.discussionController = deps.discussionController;
    this.discussionRepo = deps.discussionRepository;
    this.panelistRepo = deps.panelistRepository;
  }

  /**
   * Execute up to `maxRounds` discussion rounds sequentially.
   *
   * Stop conditions (evaluated before every round in this order):
   * 1. The discussion's `status` is `"finished"` — no more rounds.
   * 2. No panelists with `status !== "finished"` remain — nothing to execute.
   * 3. `maxRounds` has been reached — safety boundary met.
   *
   * If any dependency throws (repository, controller, AI service),
   * execution stops immediately and the error is propagated.
   * Messages persisted by completed earlier rounds are not rolled back.
   *
   * @returns All generated {@link Message}s in chronological execution order.
   */
  async runDiscussion(request: RunDiscussionRequest): Promise<Message[]> {
    const { discussionId, maxRounds } = request;

    // ── Validation ──────────────────────────────────────────────
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

    // ── Sequential round execution ──────────────────────────────
    const allMessages: Message[] = [];

    for (let round = 0; round < maxRounds; round++) {
      // Reload discussion before every round
      const discussion = await this.discussionRepo.findById(discussionId);
      if (discussion === null) {
        throw new Error("Discussion not found");
      }
      if (discussion.status === "finished") {
        break;
      }

      // Reload panelists before every round
      const panelists = await this.panelistRepo.findByDiscussionId(discussionId);
      const activePanelists = panelists.filter(
        (p) => p.status !== "finished",
      );
      if (activePanelists.length === 0) {
        break;
      }

      // Execute one round
      const roundMessages = await this.discussionController.executeDiscussion({
        discussionId,
      });

      allMessages.push(...roundMessages);
    }

    return allMessages;
  }
}
