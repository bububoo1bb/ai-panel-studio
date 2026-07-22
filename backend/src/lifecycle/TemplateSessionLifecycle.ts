import { MessageRepository } from "../repositories/MessageRepository.js";
import { Message } from "../domain/message.js";
import { SessionLifecycle } from "./SessionLifecycle.js";

/**
 * Deterministic, non-AI implementation of {@link SessionLifecycle}.
 *
 * Creates one fixed-template message on session start and one on session
 * end.  Both use {@link MessageRole.assistant} — the current domain model
 * does not differentiate system / lifecycle messages from assistant
 * messages.
 *
 * This implementation is intentionally minimal.  It proves the lifecycle
 * abstraction is functional without introducing AI calls, template engines,
 * or speculative moderator behaviour.
 */
export class TemplateSessionLifecycle implements SessionLifecycle {
  private readonly messageRepo: MessageRepository;

  constructor(deps: { messageRepository: MessageRepository }) {
    this.messageRepo = deps.messageRepository;
  }

  async onSessionStart(context: {
    discussionId: string;
  }): Promise<Message[]> {
    const message = await this.messageRepo.create({
      discussionId: context.discussionId,
      role: "assistant",
      content: "讨论环节已开始。主持人将引导专家围绕话题展开讨论。",
    });
    return [message];
  }

  async onSessionEnd(context: {
    discussionId: string;
  }): Promise<Message[]> {
    const message = await this.messageRepo.create({
      discussionId: context.discussionId,
      role: "assistant",
      content: "讨论环节已结束。",
    });
    return [message];
  }
}
