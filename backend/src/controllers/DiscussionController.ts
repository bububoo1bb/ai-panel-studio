import { RoundController } from "./RoundController.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { Message } from "../domain/message.js";

/**
 * Application-layer controller that executes one complete discussion round.
 *
 * Responsibilities:
 * - Load all panelists belonging to a discussion
 * - Skip panelists whose status is "finished"
 * - Delegate each active panelist's turn to RoundController
 * - Collect and return all created Messages in execution order
 *
 * DiscussionController is responsible only for orchestration.
 * It must never duplicate RoundController logic.
 */
export class DiscussionController {
  private readonly roundController: RoundController;
  private readonly panelistRepo: PanelistRepository;

  constructor(deps: {
    roundController: RoundController;
    panelistRepository: PanelistRepository;
  }) {
    this.roundController = deps.roundController;
    this.panelistRepo = deps.panelistRepository;
  }

  /**
   * Execute one complete discussion round:
   *
   * 1. Load all panelists belonging to the discussion (insertion order)
   * 2. Skip panelists whose status is "finished"
   * 3. For every remaining panelist, call RoundController.executeTurn()
   * 4. Collect returned Messages
   * 5. Return all created Messages in execution order
   *
   * If RoundController throws, execution stops immediately and the
   * error is propagated unchanged.
   */
  async executeDiscussion(input: {
    discussionId: string;
  }): Promise<Message[]> {
    const { discussionId } = input;

    // 1. Load all panelists belonging to the discussion in insertion order
    const panelists = await this.panelistRepo.findByDiscussionId(discussionId);

    // 2. Skip panelists whose status is "finished"
    const activePanelists = panelists.filter(
      (p) => p.status !== "finished",
    );

    // 3-4. For every remaining panelist, execute turn and collect Messages
    const messages: Message[] = [];
    for (const panelist of activePanelists) {
      const message = await this.roundController.executeTurn({
        discussionId,
        panelistId: panelist.id,
      });
      messages.push(message);
    }

    // 5. Return all created Messages in execution order
    return messages;
  }
}
