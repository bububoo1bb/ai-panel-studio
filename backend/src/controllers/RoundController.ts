import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { AIService } from "../ai/AIService.js";
import { buildPanelistMessages } from "../ai/PromptBuilder.js";
import { Message } from "../domain/message.js";

/**
 * Application-layer controller that executes a single panelist turn
 * within a roundtable discussion.
 *
 * Responsibilities:
 * - Validate discussion existence and panelist membership
 * - Load existing discussion context
 * - Build provider-independent AI messages via PromptBuilder
 * - Call AIService and persist the public assistant response
 *
 * The controller depends only on abstractions (repository interfaces
 * and the AIService interface), never on concrete implementations.
 */
export class RoundController {
  private readonly discussionRepo: DiscussionRepository;
  private readonly messageRepo: MessageRepository;
  private readonly panelistRepo: PanelistRepository;
  private readonly aiService: AIService;

  constructor(deps: {
    discussionRepository: DiscussionRepository;
    messageRepository: MessageRepository;
    panelistRepository: PanelistRepository;
    aiService: AIService;
  }) {
    this.discussionRepo = deps.discussionRepository;
    this.messageRepo = deps.messageRepository;
    this.panelistRepo = deps.panelistRepository;
    this.aiService = deps.aiService;
  }

  /**
   * Execute exactly one panelist turn:
   *
   * 1. Load and validate the discussion
   * 2. Load and validate the panelist
   * 3. Confirm panelist belongs to the discussion
   * 4. Require the panelist to be active (not finished)
   * 5. Load existing discussion messages
   * 6. Build AI messages via PromptBuilder
   * 7. Call AIService.generate()
   * 8. Persist the generated content as an assistant Message
   * 9. Return the created Message
   */
  async executeTurn(input: {
    discussionId: string;
    panelistId: string;
  }): Promise<Message> {
    const { discussionId, panelistId } = input;

    // 1. Find the discussion
    const discussion = await this.discussionRepo.findById(discussionId);
    if (discussion === null) {
      throw new Error("Discussion not found");
    }

    // 2. Find the panelist
    const panelist = await this.panelistRepo.findById(panelistId);
    if (panelist === null) {
      throw new Error("Panelist not found");
    }

    // 3. Confirm panelist belongs to the discussion
    if (panelist.discussionId !== discussionId) {
      throw new Error("Panelist does not belong to discussion");
    }

    // 4. Require the panelist to be active (finished is the inactive terminal state)
    if (panelist.status === "finished") {
      throw new Error("Panelist is not active");
    }

    // 5. Load existing discussion messages
    const messages = await this.messageRepo.findByDiscussionId(discussionId);

    // 6. Build provider-independent AI messages
    const aiMessages = buildPanelistMessages({
      discussion,
      panelist,
      messages,
    });

    // 7. Call AIService
    const response = await this.aiService.generate({ messages: aiMessages });

    // 8. Persist the public assistant response
    const createdMessage = await this.messageRepo.create({
      discussionId,
      role: "assistant",
      content: response.content,
    });

    // 9. Return the created Message
    return createdMessage;
  }
}
