import { describe, it, expect, beforeEach } from "vitest";
import { ModeratorStrategy, ModeratorMessage } from "../moderator/ModeratorStrategy.js";
import { AIModeratorStrategy } from "../moderator/AIModeratorStrategy.js";
import { MockAIService } from "../ai/MockAIService.js";
import { InMemoryDiscussionRepository } from "../repositories/InMemoryDiscussionRepository.js";
import { InMemoryPanelistRepository } from "../repositories/InMemoryPanelistRepository.js";
import { Discussion } from "../domain/discussion.js";
import { Panelist } from "../domain/panelist.js";

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const OPENING_RESPONSE = "欢迎各位专家参加今天的讨论。";
const CLOSING_RESPONSE = "感谢各位专家的精彩发言，今天的讨论到此结束。";

async function createDiscussion(repo: InMemoryDiscussionRepository): Promise<Discussion> {
  return repo.create({ title: "新能源汽车的未来发展" });
}

async function createHost(
  repo: InMemoryPanelistRepository,
  discussionId: string,
): Promise<Panelist> {
  return repo.create({
    discussionId,
    role: "host",
    name: "林澜",
    occupation: "主持人",
    title: "圆桌讨论主持人",
    stance: "中立，引导讨论深入",
    color: "#e0556a",
  });
}

async function createExpert(
  repo: InMemoryPanelistRepository,
  discussionId: string,
  name: string,
): Promise<Panelist> {
  return repo.create({
    discussionId,
    role: "expert",
    name,
    occupation: "专家",
    title: "研究员",
    stance: "支持创新",
    color: "#5b9bd5",
  });
}

// ═══════════════════════════════════════════════════════════════
// ModeratorStrategy interface contract
// ═══════════════════════════════════════════════════════════════

describe("ModeratorStrategy interface", () => {
  it("is implemented by AIModeratorStrategy", () => {
    // The interface contract is verified by TypeScript compilation.
    // AIModeratorStrategy implements ModeratorStrategy — if it didn't,
    // this test file wouldn't compile.  This test is a sentinel that
    // documents the contract.
    const strategy: ModeratorStrategy = new AIModeratorStrategy({
      aiService: new MockAIService(),
      discussionRepository: new InMemoryDiscussionRepository(),
      panelistRepository: new InMemoryPanelistRepository(),
    });
    expect(strategy).toBeDefined();
    expect(typeof strategy.openDiscussion).toBe("function");
    expect(typeof strategy.closeDiscussion).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════
// AIModeratorStrategy.openDiscussion()
// ═══════════════════════════════════════════════════════════════

describe("AIModeratorStrategy.openDiscussion()", () => {
  let strategy: AIModeratorStrategy;
  let aiService: MockAIService;
  let discussionRepo: InMemoryDiscussionRepository;
  let panelistRepo: InMemoryPanelistRepository;

  beforeEach(() => {
    aiService = new MockAIService({ content: OPENING_RESPONSE });
    discussionRepo = new InMemoryDiscussionRepository();
    panelistRepo = new InMemoryPanelistRepository();
    strategy = new AIModeratorStrategy({
      aiService,
      discussionRepository: discussionRepo,
      panelistRepository: panelistRepo,
    });
  });

  it("returns a ModeratorMessage with correct panelistId", async () => {
    const discussion = await createDiscussion(discussionRepo);
    const host = await createHost(panelistRepo, discussion.id);
    await createExpert(panelistRepo, discussion.id, "张明远");

    const result = await strategy.openDiscussion(discussion.id);

    expect(result.panelistId).toBe(host.id);
  });

  it("returns a ModeratorMessage with kind moderator_opening", async () => {
    const discussion = await createDiscussion(discussionRepo);
    await createHost(panelistRepo, discussion.id);
    await createExpert(panelistRepo, discussion.id, "张明远");

    const result = await strategy.openDiscussion(discussion.id);

    expect(result.kind).toBe("moderator_opening");
  });

  it("returns non-empty content", async () => {
    const discussion = await createDiscussion(discussionRepo);
    await createHost(panelistRepo, discussion.id);
    await createExpert(panelistRepo, discussion.id, "张明远");

    const result = await strategy.openDiscussion(discussion.id);

    expect(result.content).toBe(OPENING_RESPONSE);
  });

  it("does NOT return a persisted Message (returns plain data)", async () => {
    const discussion = await createDiscussion(discussionRepo);
    await createHost(panelistRepo, discussion.id);
    await createExpert(panelistRepo, discussion.id, "张明远");

    const result = await strategy.openDiscussion(discussion.id);

    // ModeratorMessage is a plain object, not a domain Message
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("panelistId");
    expect(result).toHaveProperty("kind");
    // It should NOT have Message-specific fields like id, role, createdAt
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("role");
    expect(result).not.toHaveProperty("createdAt");
  });

  it("throws when no host panelist exists", async () => {
    const discussion = await createDiscussion(discussionRepo);
    // Only experts, no host
    await createExpert(panelistRepo, discussion.id, "张明远");

    await expect(
      strategy.openDiscussion(discussion.id),
    ).rejects.toThrow("No moderator found");
  });

  it("throws when discussion does not exist", async () => {
    await expect(
      strategy.openDiscussion("nonexistent-id"),
    ).rejects.toThrow("Discussion not found");
  });

  it("calls AIService with the discussion topic in the prompt", async () => {
    const discussion = await createDiscussion(discussionRepo);
    await createHost(panelistRepo, discussion.id);
    await createExpert(panelistRepo, discussion.id, "张明远");

    await strategy.openDiscussion(discussion.id);

    const requests = aiService.getRequests();
    expect(requests.length).toBe(1);

    // The system prompt should reference the discussion topic
    const systemMsg = requests[0].messages.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain(discussion.title);
  });

  it("calls AIService with expert names in the prompt", async () => {
    const discussion = await createDiscussion(discussionRepo);
    await createHost(panelistRepo, discussion.id);
    await createExpert(panelistRepo, discussion.id, "张明远");
    await createExpert(panelistRepo, discussion.id, "李思涵");

    await strategy.openDiscussion(discussion.id);

    const requests = aiService.getRequests();
    const systemMsg = requests[0].messages.find((m) => m.role === "system");
    expect(systemMsg!.content).toContain("张明远");
    expect(systemMsg!.content).toContain("李思涵");
  });
});

// ═══════════════════════════════════════════════════════════════
// AIModeratorStrategy.closeDiscussion()
// ═══════════════════════════════════════════════════════════════

describe("AIModeratorStrategy.closeDiscussion()", () => {
  let strategy: AIModeratorStrategy;
  let aiService: MockAIService;
  let discussionRepo: InMemoryDiscussionRepository;
  let panelistRepo: InMemoryPanelistRepository;

  beforeEach(() => {
    aiService = new MockAIService({ content: CLOSING_RESPONSE });
    discussionRepo = new InMemoryDiscussionRepository();
    panelistRepo = new InMemoryPanelistRepository();
    strategy = new AIModeratorStrategy({
      aiService,
      discussionRepository: discussionRepo,
      panelistRepository: panelistRepo,
    });
  });

  it("returns a ModeratorMessage with kind moderator_closing", async () => {
    const discussion = await createDiscussion(discussionRepo);
    const host = await createHost(panelistRepo, discussion.id);
    await createExpert(panelistRepo, discussion.id, "张明远");

    const result = await strategy.closeDiscussion(discussion.id);

    expect(result.kind).toBe("moderator_closing");
    expect(result.panelistId).toBe(host.id);
  });

  it("returns non-empty content from the AI response", async () => {
    const discussion = await createDiscussion(discussionRepo);
    await createHost(panelistRepo, discussion.id);
    await createExpert(panelistRepo, discussion.id, "张明远");

    const result = await strategy.closeDiscussion(discussion.id);

    expect(result.content).toBe(CLOSING_RESPONSE);
  });

  it("throws when no host panelist exists", async () => {
    const discussion = await createDiscussion(discussionRepo);
    // Only experts, no host
    await createExpert(panelistRepo, discussion.id, "张明远");

    await expect(
      strategy.closeDiscussion(discussion.id),
    ).rejects.toThrow("No moderator found");
  });
});
