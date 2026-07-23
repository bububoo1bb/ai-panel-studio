import { SessionLifecycle } from "./SessionLifecycle.js";
import { ModeratorStrategy } from "../moderator/ModeratorStrategy.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { Message } from "../domain/message.js";

/**
 * AI-powered implementation of {@link SessionLifecycle}.
 *
 * A thin adapter that maps lifecycle hooks to moderator strategy calls
 * and persists the resulting messages.
 *
 * ## Responsibility boundary
 *
 * - **SessionLifecycle** — WHEN moderator events fire (before/after rounds)
 * - **ModeratorStrategy** — WHAT the moderator says (content, prompts, AI calls)
 * - **AISessionLifecycle (this class)** — bridges the two and persists messages
 *
 * This class does NOT construct prompts, call the AI service directly, or
 * own moderator intelligence.  It delegates all moderator behaviour to
 * {@link ModeratorStrategy} and only handles lifecycle timing + persistence.
 *
 * ## Dependencies
 *
 * - `ModeratorStrategy` — generates moderator content
 * - `MessageRepository` — persists the generated content as domain Messages
 */
export class AISessionLifecycle implements SessionLifecycle {
  private readonly moderator: ModeratorStrategy;
  private readonly messageRepo: MessageRepository;

  constructor(deps: {
    moderator: ModeratorStrategy;
    messageRepository: MessageRepository;
  }) {
    this.moderator = deps.moderator;
    this.messageRepo = deps.messageRepository;
  }

  /**
   * Session-start hook: generate and persist the moderator's opening statement.
   *
   * Delegates to {@link ModeratorStrategy.openDiscussion} for content,
   * then persists the result via {@link MessageRepository}.
   */
  async onSessionStart(context: {
    discussionId: string;
  }): Promise<Message[]> {
    const { content, panelistId, kind } =
      await this.moderator.openDiscussion(context.discussionId);

    const message = await this.messageRepo.create({
      discussionId: context.discussionId,
      role: "assistant",
      content,
      panelistId,
      kind,
    });

    return [message];
  }

  /**
   * Session-end hook: generate and persist the moderator's closing statement.
   *
   * Delegates to {@link ModeratorStrategy.closeDiscussion} for content,
   * then persists the result via {@link MessageRepository}.
   */
  async onSessionEnd(context: {
    discussionId: string;
  }): Promise<Message[]> {
    const { content, panelistId, kind } =
      await this.moderator.closeDiscussion(context.discussionId);

    const message = await this.messageRepo.create({
      discussionId: context.discussionId,
      role: "assistant",
      content,
      panelistId,
      kind,
    });

    return [message];
  }
}
