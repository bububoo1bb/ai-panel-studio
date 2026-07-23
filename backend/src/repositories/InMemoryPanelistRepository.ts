import { randomUUID } from "node:crypto";
import { Panelist, CreatePanelistInput, PanelistStatus } from "../domain/panelist.js";
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
      beliefs: input.beliefs ?? null,
      concerns: input.concerns ?? null,
      argumentStyle: input.argumentStyle ?? null,
      color: input.color,
      status: "waiting",
      currentFocus: null,
      publicSummary: null,
      createdAt: new Date().toISOString(),
      lastSpokeAt: null,
      speakCount: 0,
    };
    this.panelists.push(panelist);
    return panelist;
  }

  async findById(id: string): Promise<Panelist | null> {
    const panelist = this.panelists.find((p) => p.id === id);
    return panelist ?? null;
  }

  async findByDiscussionId(discussionId: string): Promise<Panelist[]> {
    // Return a shallow copy filtered by discussionId in insertion order.
    return this.panelists.filter((p) => p.discussionId === discussionId);
  }

  async update(
    id: string,
    changes: Partial<Pick<Panelist, "status" | "currentFocus" | "publicSummary" | "lastSpokeAt" | "speakCount">>,
  ): Promise<Panelist> {
    const index = this.panelists.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new Error("Panelist not found");
    }
    const existing = this.panelists[index];
    const updated: Panelist = {
      ...existing,
      status: (changes.status as PanelistStatus) ?? existing.status,
      currentFocus: changes.currentFocus !== undefined ? changes.currentFocus : existing.currentFocus,
      publicSummary: changes.publicSummary !== undefined ? changes.publicSummary : existing.publicSummary,
      lastSpokeAt: changes.lastSpokeAt !== undefined ? changes.lastSpokeAt : existing.lastSpokeAt,
      speakCount: changes.speakCount !== undefined ? changes.speakCount : existing.speakCount,
    };
    this.panelists[index] = updated;
    return updated;
  }
}
