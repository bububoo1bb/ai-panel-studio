import { Discussion, CreateDiscussionInput } from "../domain/discussion.js";

/**
 * Persistence abstraction for Discussion entities.
 *
 * All methods are async so that the interface can later be implemented
 * with a real database without changing the API layer.
 */
export interface DiscussionRepository {
  /** Persist a new Discussion and return the saved entity. */
  create(input: CreateDiscussionInput): Promise<Discussion>;

  /** Return every Discussion in insertion order. */
  findAll(): Promise<Discussion[]>;

  /** Return the Discussion with the given id, or null when not found. */
  findById(id: string): Promise<Discussion | null>;
}
