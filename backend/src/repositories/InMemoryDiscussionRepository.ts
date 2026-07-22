import { randomUUID } from "node:crypto";
import { Discussion, CreateDiscussionInput } from "../domain/discussion.js";
import { DiscussionRepository } from "./DiscussionRepository.js";

/**
 * In-memory implementation of DiscussionRepository.
 *
 * Discussions live only for the lifetime of the process.
 * Insertion order is preserved; the internal storage array is never
 * exposed directly.
 */
export class InMemoryDiscussionRepository implements DiscussionRepository {
  private readonly discussions: Discussion[] = [];

  async create(input: CreateDiscussionInput): Promise<Discussion> {
    const discussion: Discussion = {
      id: randomUUID(),
      title: input.title,
      createdAt: new Date().toISOString(),
    };
    this.discussions.push(discussion);
    return discussion;
  }

  async findAll(): Promise<Discussion[]> {
    // Return a shallow copy so callers cannot mutate internal state.
    return [...this.discussions];
  }

  async findById(id: string): Promise<Discussion | null> {
    const discussion = this.discussions.find((d) => d.id === id);
    return discussion ?? null;
  }
}
