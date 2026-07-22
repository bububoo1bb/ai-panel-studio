import { Message, CreateMessageInput } from "../domain/message.js";

/**
 * Persistence abstraction for Message entities.
 *
 * All methods are async so that the interface can later be implemented
 * with a real database without changing the API layer.
 */
export interface MessageRepository {
  /** Persist a new Message and return the saved entity. */
  create(input: CreateMessageInput): Promise<Message>;

  /** Return every Message belonging to the given discussion in insertion order. */
  findByDiscussionId(discussionId: string): Promise<Message[]>;
}
