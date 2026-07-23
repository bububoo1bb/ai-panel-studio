import { randomUUID } from "node:crypto";
import { DiscussionInsight, CreateInsightInput } from "../domain/insight.js";
import { InsightRepository } from "./InsightRepository.js";

export class InMemoryInsightRepository implements InsightRepository {
  private readonly insights: DiscussionInsight[] = [];

  async create(input: CreateInsightInput): Promise<DiscussionInsight> {
    // Overwrite existing insight for this discussion (idempotent)
    const existing = this.insights.findIndex(
      (i) => i.discussionId === input.discussionId,
    );
    if (existing !== -1) {
      this.insights.splice(existing, 1);
    }

    const insight: DiscussionInsight = {
      id: randomUUID(),
      discussionId: input.discussionId,
      consensus: input.consensus,
      divergence: input.divergence,
      summary: input.summary,
      locked: true,
      createdAt: new Date().toISOString(),
    };
    this.insights.push(insight);
    return insight;
  }

  async findByDiscussionId(
    discussionId: string,
  ): Promise<DiscussionInsight | null> {
    return this.insights.find((i) => i.discussionId === discussionId) ?? null;
  }
}
