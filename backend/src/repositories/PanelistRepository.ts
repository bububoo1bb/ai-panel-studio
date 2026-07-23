import { Panelist, CreatePanelistInput } from "../domain/panelist.js";

/**
 * Persistence abstraction for Panelist entities.
 *
 * All methods are async so that the interface can later be implemented
 * with a real database without changing the API layer.
 */
export interface PanelistRepository {
  /** Persist a new Panelist and return the saved entity. */
  create(input: CreatePanelistInput): Promise<Panelist>;

  /** Return the Panelist with the given id, or null when not found. */
  findById(id: string): Promise<Panelist | null>;

  /** Return every Panelist belonging to the given discussion in insertion order. */
  findByDiscussionId(discussionId: string): Promise<Panelist[]>;

  /** Update mutable fields of an existing Panelist. */
  update(
    id: string,
    changes: Partial<Pick<Panelist, "status" | "currentFocus" | "publicSummary" | "lastSpokeAt" | "speakCount">>,
  ): Promise<Panelist>;
}
