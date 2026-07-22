import { randomUUID } from "node:crypto";
import { Panelist, CreatePanelistInput } from "../domain/panelist.js";
import { PanelistRepository } from "./PanelistRepository.js";

/**
 * In-memory implementation of PanelistRepository.
 *
 * Panelists live only for the lifetime of the process.
 * Insertion order is preserved; the internal storage array is never
 * exposed directly.
 */
export class InMemoryPanelistRepository implements PanelistRepository {
  private readonly panelists: Panelist[] = [];

  async create(input: CreatePanelistInput): Promise<Panelist> {
    const panelist: Panelist = {
      id: randomUUID(),
      discussionId: input.discussionId,
      role: input.role,
      name: input.name,
      occupation: input.occupation,
      title: input.title,
      stance: input.stance,
      color: input.color,
      status: "waiting",
      currentFocus: null,
      publicSummary: null,
      createdAt: new Date().toISOString(),
    };
    this.panelists.push(panelist);
    return panelist;
  }

  async findByDiscussionId(discussionId: string): Promise<Panelist[]> {
    // Return a shallow copy filtered by discussionId in insertion order.
    return this.panelists.filter((p) => p.discussionId === discussionId);
  }
}
