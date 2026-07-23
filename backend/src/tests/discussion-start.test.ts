import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { InMemoryDiscussionRepository } from "../repositories/InMemoryDiscussionRepository.js";
import { InMemoryPanelistRepository } from "../repositories/InMemoryPanelistRepository.js";
import { InMemoryMessageRepository } from "../repositories/InMemoryMessageRepository.js";
import { MockAIService } from "../ai/MockAIService.js";
import { AISessionLifecycle } from "../lifecycle/AISessionLifecycle.js";
import { AIModeratorStrategy } from "../moderator/AIModeratorStrategy.js";
import { Discussion } from "../domain/discussion.js";
import { DiscussionSessionController } from "../controllers/DiscussionSessionController.js";
import { DiscussionEngine } from "../services/DiscussionEngine.js";
import { DiscussionController } from "../controllers/DiscussionController.js";
import { RoundController } from "../controllers/RoundController.js";

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const MODERATOR_RESPONSE = "欢迎各位专家参加今天的圆桌讨论。";
const EXPERT_RESPONSE = "我认为新能源汽车的发展需要政策支持。";
const CLOSING_RESPONSE = "感谢各位专家的精彩发言。";

async function createDiscussion(
  repo: InMemoryDiscussionRepository,
  title = "新能源汽车的未来发展",
): Promise<Discussion> {
  return repo.create({ title });
}

async function createPanelists(
  repo: InMemoryPanelistRepository,
  discussionId: string,
): Promise<void> {
  await repo.create({
    discussionId,
    role: "host",
    name: "林澜",
    occupation: "主持人",
    title: "圆桌讨论主持人",
    stance: "中立，引导讨论深入",
    color: "#e0556a",
  });
  await repo.create({
    discussionId,
    role: "expert",
    name: "张明远",
    occupation: "经济学家",
    title: "宏观经济学家",
    stance: "支持市场化解决方案",
    color: "#5b9bd5",
  });
  await repo.create({
    discussionId,
    role: "expert",
    name: "李思涵",
    occupation: "技术专家",
    title: "AI 研究员",
    stance: "强调技术创新驱动",
    color: "#4caf88",
  });
}

/**
 * Create a test app with all M16 dependencies wired and mock AI
 * that returns configurable responses.  Uses MockAIService so no
 * real API calls happen.
 */
function createTestApp(options?: {
  aiContent?: string;
}) {
  const discussionRepo = new InMemoryDiscussionRepository();
  const panelistRepo = new InMemoryPanelistRepository();
  const messageRepo = new InMemoryMessageRepository();
  const aiService = new MockAIService({
    content: options?.aiContent ?? MODERATOR_RESPONSE,
  });

  const moderatorStrategy = new AIModeratorStrategy({
    aiService,
    discussionRepository: discussionRepo,
    panelistRepository: panelistRepo,
  });

  const sessionLifecycle = new AISessionLifecycle({
    moderator: moderatorStrategy,
    messageRepository: messageRepo,
  });

  const roundController = new RoundController({
    discussionRepository: discussionRepo,
    messageRepository: messageRepo,
    panelistRepository: panelistRepo,
    aiService,
  });

  const discussionController = new DiscussionController({
    roundController,
    panelistRepository: panelistRepo,
  });

  const discussionEngine = new DiscussionEngine({
    discussionController,
    discussionRepository: discussionRepo,
    panelistRepository: panelistRepo,
  });

  const discussionSessionController = new DiscussionSessionController({
    discussionEngine,
    discussionRepository: discussionRepo,
    lifecycle: sessionLifecycle,
  });

  const app = createApp({
    discussionRepository: discussionRepo,
    messageRepository: messageRepo,
    panelistRepository: panelistRepo,
    aiService,
    moderatorStrategy,
    sessionLifecycle,
    discussionSessionController,
  });

  return {
    app,
    discussionRepo,
    panelistRepo,
    messageRepo,
    aiService,
    discussionSessionController,
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/discussions/:id/start
// ═══════════════════════════════════════════════════════════════

describe("POST /api/discussions/:id/start", () => {
  // ── Validation ──────────────────────────────────────────────

  describe("validation", () => {
    it("derives maxRounds from durationLimit when not provided", async () => {
      const { app, discussionRepo, panelistRepo } = createTestApp();
      const discussion = await createDiscussion(discussionRepo);
      await createPanelists(panelistRepo, discussion.id);

      const res = await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({});

      // maxRounds is now optional — derived from durationLimit (default 300s)
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ status: "started", discussionId: discussion.id });
    });

    it("returns 400 when maxRounds is not a number", async () => {
      const { app, discussionRepo, panelistRepo } = createTestApp();
      const discussion = await createDiscussion(discussionRepo);
      await createPanelists(panelistRepo, discussion.id);

      const res = await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({ maxRounds: "five" });

      expect(res.status).toBe(400);
    });

    it("returns 400 when maxRounds is not a positive integer", async () => {
      const { app, discussionRepo, panelistRepo } = createTestApp();
      const discussion = await createDiscussion(discussionRepo);
      await createPanelists(panelistRepo, discussion.id);

      const res = await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({ maxRounds: 0 });

      expect(res.status).toBe(400);
    });

    it("returns 400 when maxRounds is fractional", async () => {
      const { app, discussionRepo, panelistRepo } = createTestApp();
      const discussion = await createDiscussion(discussionRepo);
      await createPanelists(panelistRepo, discussion.id);

      const res = await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({ maxRounds: 2.5 });

      expect(res.status).toBe(400);
    });

    it("returns 404 when discussion does not exist", async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post("/api/discussions/nonexistent/start")
        .send({ maxRounds: 3 });

      expect(res.status).toBe(404);
    });

    it("returns 409 when discussion is already finished", async () => {
      const { app, discussionRepo, panelistRepo } = createTestApp();
      const discussion = await createDiscussion(discussionRepo);
      await createPanelists(panelistRepo, discussion.id);
      await discussionRepo.updateStatus(discussion.id, "finished");

      const res = await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({ maxRounds: 3 });

      expect(res.status).toBe(409);
    });

    it("returns 422 when discussion has no panelists", async () => {
      const { app, discussionRepo } = createTestApp();
      const discussion = await createDiscussion(discussionRepo);

      const res = await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({ maxRounds: 3 });

      expect(res.status).toBe(422);
    });

    it("returns 422 when discussion has no moderator", async () => {
      const { app, discussionRepo, panelistRepo } = createTestApp();
      const discussion = await createDiscussion(discussionRepo);
      // Only expert, no host
      await panelistRepo.create({
        discussionId: discussion.id,
        role: "expert",
        name: "张明远",
        occupation: "经济学家",
        title: "宏观经济学家",
        stance: "支持创新",
        color: "#5b9bd5",
      });

      const res = await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({ maxRounds: 3 });

      expect(res.status).toBe(422);
    });

    it("returns 422 when discussion has no experts", async () => {
      const { app, discussionRepo, panelistRepo } = createTestApp();
      const discussion = await createDiscussion(discussionRepo);
      // Only host, no experts
      await panelistRepo.create({
        discussionId: discussion.id,
        role: "host",
        name: "林澜",
        occupation: "主持人",
        title: "圆桌讨论主持人",
        stance: "中立",
        color: "#e0556a",
      });

      const res = await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({ maxRounds: 3 });

      expect(res.status).toBe(422);
    });
  });

  // ── Success ─────────────────────────────────────────────────

  describe("success", () => {
    it("returns 202 immediately without waiting for execution", async () => {
      const { app, discussionRepo, panelistRepo } = createTestApp();
      const discussion = await createDiscussion(discussionRepo);
      await createPanelists(panelistRepo, discussion.id);

      const res = await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({ maxRounds: 3 });

      // Should respond immediately (202 Accepted)
      expect(res.status).toBe(202);
      expect(res.body.status).toBe("started");
      expect(res.body.discussionId).toBe(discussion.id);
    });

    it("eventually transitions discussion status to finished", async () => {
      const { app, discussionRepo, panelistRepo } = createTestApp({
        aiContent: EXPERT_RESPONSE,
      });
      const discussion = await createDiscussion(discussionRepo);
      await createPanelists(panelistRepo, discussion.id);

      // Start the discussion
      await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({ maxRounds: 1 });

      // Wait for execution to complete (async fire-and-forget)
      // Poll a few times with small delays
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const disc = await discussionRepo.findById(discussion.id);
        if (disc?.status === "finished") break;
      }

      const finalDisc = await discussionRepo.findById(discussion.id);
      expect(finalDisc?.status).toBe("finished");
    });

    it("produces messages with correct metadata", async () => {
      const { app, discussionRepo, panelistRepo, messageRepo } = createTestApp({
        aiContent: EXPERT_RESPONSE,
      });
      const discussion = await createDiscussion(discussionRepo);
      await createPanelists(panelistRepo, discussion.id);

      // Start
      await request(app)
        .post(`/api/discussions/${discussion.id}/start`)
        .send({ maxRounds: 1 });

      // Wait for completion
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const disc = await discussionRepo.findById(discussion.id);
        if (disc?.status === "finished") break;
      }

      const messages = await messageRepo.findByDiscussionId(discussion.id);

      // Should have: opening + (2 experts × 1 round) + closing = 4 messages
      expect(messages.length).toBeGreaterThanOrEqual(3);

      // First message should be moderator opening
      expect(messages[0].kind).toBe("moderator_opening");

      // Last message should be moderator closing
      expect(messages[messages.length - 1].kind).toBe("moderator_closing");

      // Expert statements should have correct panelistId and kind
      const expertMsgs = messages.filter(
        (m) => m.kind === "expert_statement",
      );
      expect(expertMsgs.length).toBeGreaterThan(0);
      for (const msg of expertMsgs) {
        expect(msg.panelistId).toBeTruthy();
      }
    });

    it("isolates messages between different discussions", async () => {
      const { app, discussionRepo, panelistRepo, messageRepo } = createTestApp({
        aiContent: EXPERT_RESPONSE,
      });
      const discussion1 = await createDiscussion(discussionRepo, "Topic A");
      const discussion2 = await createDiscussion(discussionRepo, "Topic B");
      await createPanelists(panelistRepo, discussion1.id);
      // Create separate panelists for discussion2
      await panelistRepo.create({
        discussionId: discussion2.id,
        role: "host",
        name: "王磊",
        occupation: "主持人",
        title: "讨论主持人",
        stance: "中立",
        color: "#e0556a",
      });
      await panelistRepo.create({
        discussionId: discussion2.id,
        role: "expert",
        name: "赵强",
        occupation: "工程师",
        title: "高级工程师",
        stance: "技术创新",
        color: "#5b9bd5",
      });

      // Start discussion 1
      await request(app)
        .post(`/api/discussions/${discussion1.id}/start`)
        .send({ maxRounds: 1 });

      // Start discussion 2
      await request(app)
        .post(`/api/discussions/${discussion2.id}/start`)
        .send({ maxRounds: 1 });

      // Wait for both to complete
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const d1 = await discussionRepo.findById(discussion1.id);
        const d2 = await discussionRepo.findById(discussion2.id);
        if (d1?.status === "finished" && d2?.status === "finished") break;
      }

      const msgs1 = await messageRepo.findByDiscussionId(discussion1.id);
      const msgs2 = await messageRepo.findByDiscussionId(discussion2.id);

      // Messages should not leak between discussions
      for (const msg of msgs1) {
        expect(msg.discussionId).toBe(discussion1.id);
      }
      for (const msg of msgs2) {
        expect(msg.discussionId).toBe(discussion2.id);
      }
    });
  });
});
