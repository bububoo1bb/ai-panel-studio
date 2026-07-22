import { randomUUID } from "node:crypto";
import { Message, CreateMessageInput } from "../domain/message.js";
import { MessageRepository } from "./MessageRepository.js";

/**
 * In-memory implementation of MessageRepository.
 *
 * Messages live only for the lifetime of the process.
 * Insertion order is preserved; the internal storage array is never
 * exposed directly.
 */
export class InMemoryMessageRepository implements MessageRepository {
  private readonly messages: Message[] = [];

  async create(input: CreateMessageInput): Promise<Message> {
    const message: Message = {
      id: randomUUID(),
      discussionId: input.discussionId,
      role: input.role,
      content: input.content,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(message);
    return message;
  }

  async findByDiscussionId(discussionId: string): Promise<Message[]> {
    // Return a shallow copy filtered by discussionId in insertion order.
    return this.messages.filter((m) => m.discussionId === discussionId);
  }
}
