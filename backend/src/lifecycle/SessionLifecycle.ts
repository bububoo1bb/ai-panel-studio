import { Message } from "../domain/message.js";

/**
 * Lifecycle hooks invoked around a discussion session.
 *
 * Each hook receives a minimal context object containing only the data
 * required to produce session-boundary messages. Future hook signatures
 * may be extended if concrete implementations require additional context.
 *
 * Implementations are responsible for persisting any Messages they create
 * and returning them so the session controller can include them in the
 * final transcript.
 */
export interface SessionLifecycle {
  /** Invoked once before the first round executes. */
  onSessionStart(context: { discussionId: string }): Promise<Message[]>;

  /** Invoked once after the final round completes normally. */
  onSessionEnd(context: { discussionId: string }): Promise<Message[]>;
}
