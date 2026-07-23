import { AIService } from "../ai/AIService.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import {
  buildModeratorOpeningMessages,
  buildModeratorClosingMessages,
  buildModeratorInterventionMessages,
} from "../ai/PromptBuilder.js";
import { ModeratorStrategy, ModeratorMessage } from "./ModeratorStrategy.js";

/**
 * AI-powered implementation of {@link ModeratorStrategy}.
 *
 * Generates moderator opening and closing statements by calling the AI
 * service with specialized prompts.  Returns {@link ModeratorMessage}
 * data objects — it does **not** persist messages directly.
 *
 * Message persistence is owned by the execution orchestration layer.
 *
 * ## Dependencies
 *
 * - `AIService` — for AI text generation
 * - `DiscussionRepository` — to load discussion topic
 * - `PanelistRepository` — to find the host panelist and expert names
 *
 * Notably absent: `MessageRepository`.  This class produces moderator
 * content; the caller decides when and how to persist it.
 */
export class AIModeratorStrategy implements ModeratorStrategy {
  private readonly aiService: AIService;
  private readonly discussionRepo: DiscussionRepository;
  private readonly panelistRepo: PanelistRepository;

  constructor(deps: {
    aiService: AIService;
    discussionRepository: DiscussionRepository;
    panelistRepository: PanelistRepository;
  }) {
    this.aiService = deps.aiService;
    this.discussionRepo = deps.discussionRepository;
    this.panelistRepo = deps.panelistRepository;
  }

  /**
   * Generate the moderator's opening statement.
   *
   * 1. Load the discussion and panelists
   * 2. Find the host panelist (throws if absent)
   * 3. Collect expert names for the prompt
   * 4. Build the opening prompt and call the AI
   * 5. Return ModeratorMessage data (NOT persisted)
   */
  async openDiscussion(discussionId: string): Promise<ModeratorMessage> {
    // 1. Load discussion
    const discussion = await this.discussionRepo.findById(discussionId);
    if (!discussion) {
      throw new Error("Discussion not found");
    }

    // 2. Load panelists
    const panelists = await this.panelistRepo.findByDiscussionId(discussionId);

    // 3. Find host
    const host = panelists.find((p) => p.role === "host");
    if (!host) {
      throw new Error("No moderator found for this discussion");
    }

    // 4. Collect expert names
    const expertNames = panelists
      .filter((p) => p.role === "expert")
      .map((p) => p.name);

    // 5. Build AI messages and generate
    const aiMessages = buildModeratorOpeningMessages({
      hostName: host.name,
      hostTitle: host.title,
      topic: discussion.title,
      expertNames,
    });

    const response = await this.aiService.generate({ messages: aiMessages });

    // 6. Return ModeratorMessage (caller persists)
    return {
      content: response.content,
      panelistId: host.id,
      kind: "moderator_opening",
    };
  }

  /**
   * Generate a mid-discussion moderator intervention.
   *
   * 1. Load the discussion and panelists
   * 2. Find the host panelist (throws if absent)
   * 3. Build the intervention prompt with recent messages
   * 4. Call the AI and return ModeratorMessage data (NOT persisted)
   */
  async intervene(
    discussionId: string,
    recentMessages: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<ModeratorMessage> {
    // 1. Load discussion
    const discussion = await this.discussionRepo.findById(discussionId);
    if (!discussion) {
      throw new Error("Discussion not found");
    }

    // 2. Load panelists and find host
    const panelists = await this.panelistRepo.findByDiscussionId(discussionId);
    const host = panelists.find((p) => p.role === "host");
    if (!host) {
      throw new Error("No moderator found for this discussion");
    }

    // 3. Build intervention messages with context
    const aiMessages = buildModeratorInterventionMessages({
      hostName: host.name,
      hostTitle: host.title,
      topic: discussion.title,
      recentMessages,
    });

    // 4. Call AI
    const response = await this.aiService.generate({ messages: aiMessages });

    // 5. Return ModeratorMessage (caller persists)
    return {
      content: response.content,
      panelistId: host.id,
      kind: "moderator_call",
    };
  }

  /**
   * Generate the moderator's closing statement.
   *
   * 1. Load the discussion and panelists
   * 2. Find the host panelist (throws if absent)
   * 3. Build the closing prompt and call the AI
   * 4. Return ModeratorMessage data (NOT persisted)
   */
  async closeDiscussion(discussionId: string): Promise<ModeratorMessage> {
    // 1. Load discussion
    const discussion = await this.discussionRepo.findById(discussionId);
    if (!discussion) {
      throw new Error("Discussion not found");
    }

    // 2. Load panelists
    const panelists = await this.panelistRepo.findByDiscussionId(discussionId);

    // 3. Find host
    const host = panelists.find((p) => p.role === "host");
    if (!host) {
      throw new Error("No moderator found for this discussion");
    }

    // 4. Build AI messages and generate
    const aiMessages = buildModeratorClosingMessages({
      hostName: host.name,
      hostTitle: host.title,
      topic: discussion.title,
    });

    const response = await this.aiService.generate({ messages: aiMessages });

    // 5. Return ModeratorMessage (caller persists)
    return {
      content: response.content,
      panelistId: host.id,
      kind: "moderator_closing",
    };
  }
}
