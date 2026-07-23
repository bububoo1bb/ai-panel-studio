import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { InMemoryDiscussionRepository } from "../repositories/InMemoryDiscussionRepository.js";
import { InMemoryPanelistRepository } from "../repositories/InMemoryPanelistRepository.js";
import { MockAIService } from "../ai/MockAIService.js";
import { PanelistGenerator } from "../services/PanelistGenerator.js";
import { Discussion } from "../domain/discussion.js";

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/** A valid panel of 1 host + 2 experts in JSON with all required fields. */
const VALID_PANEL_JSON = JSON.stringify([
  {
    role: "host",
    name: "林澜",
    occupation: "主持人",
    title: "圆桌讨论主持人",
    stance: "中立，引导讨论深入",
  },
  {
    role: "expert",
    name: "张明远",
    occupation: "经济学家",
    title: "宏观经济学家",
    stance: "支持市场化解决方案推动产业升级",
    beliefs: "市场机制是最有效的资源配置方式",
    concerns: "政府过度干预可能导致效率下降和创新不足",
    argumentStyle: "数据驱动",
  },
  {
    role: "expert",
    name: "李思涵",
    occupation: "技术专家",
    title: "AI 研究员",
    stance: "强调技术创新驱动产业发展",
    beliefs: "技术进步是解决社会问题的根本途径",
    concerns: "技术发展速度可能超过社会适应能力",
    argumentStyle: "温和建设",
  },
]);

/** Create an isolated app with MockAIService that returns the given content. */
function createTestApp(mockContent?: string) {
  const discussionRepo = new InMemoryDiscussionRepository();
  const panelistRepo = new InMemoryPanelistRepository();
  const aiService = new MockAIService({ content: mockContent ?? VALID_PANEL_JSON });
  const panelistGenerator = new PanelistGenerator({
    aiService,
    discussionRepository: discussionRepo,
    panelistRepository: panelistRepo,
  });

  const app = createApp({
    discussionRepository: discussionRepo,
    panelistRepository: panelistRepo,
    aiService,
    panelistGenerator,
  });

  return { app, discussionRepo, panelistRepo, aiService, panelistGenerator };
}

/** Create a discussion via the API and return the parsed entity. */
async function createDiscussion(
  app: ReturnType<typeof createTestApp>["app"],
  title = "新能源汽车的未来发展趋势",
): Promise<Discussion> {
  const res = await request(app)
    .post("/api/discussions")
    .send({ title });
  return res.body as Discussion;
}

// ═══════════════════════════════════════════════════════════════
// Unit tests — PanelistGenerator.generate()
// ═══════════════════════════════════════════════════════════════

describe("PanelistGenerator.generate()", () => {
  let generator: PanelistGenerator;
  let discussionRepo: InMemoryDiscussionRepository;
  let panelistRepo: InMemoryPanelistRepository;
  let aiService: MockAIService;

  beforeEach(async () => {
    discussionRepo = new InMemoryDiscussionRepository();
    panelistRepo = new InMemoryPanelistRepository();
    aiService = new MockAIService({ content: VALID_PANEL_JSON });
    generator = new PanelistGenerator({
      aiService,
      discussionRepository: discussionRepo,
      panelistRepository: panelistRepo,
    });
  });

  // ── Success cases ──────────────────────────────────────────

  it("generates 1 host + N experts from valid AI response", async () => {
    const discussion = await discussionRepo.create({ title: "Test Topic" });

    const panelists = await generator.generate({
      discussionId: discussion.id,
      topic: discussion.title,
      expertCount: 2,
    });

    expect(panelists).toHaveLength(3); // 1 host + 2 experts
    expect(panelists[0].role).toBe("host");
    expect(panelists[1].role).toBe("expert");
    expect(panelists[2].role).toBe("expert");
  });

  it("persists generated panelists to the repository", async () => {
    const discussion = await discussionRepo.create({ title: "Test Topic" });

    await generator.generate({
      discussionId: discussion.id,
      topic: discussion.title,
      expertCount: 2,
    });

    const stored = await panelistRepo.findByDiscussionId(discussion.id);
    expect(stored).toHaveLength(3);
    expect(stored[0].name).toBe("林澜");
    expect(stored[1].name).toBe("张明远");
  });

  it("assigns system colors in palette order", async () => {
    const discussion = await discussionRepo.create({ title: "Test Topic" });

    const panelists = await generator.generate({
      discussionId: discussion.id,
      topic: discussion.title,
      expertCount: 2,
    });

    // Each panelist should have a hex color
    for (const p of panelists) {
      expect(p.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }

    // All colors should be distinct
    const colors = panelists.map((p) => p.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("sets status to 'waiting' for all generated panelists", async () => {
    const discussion = await discussionRepo.create({ title: "Test Topic" });

    const panelists = await generator.generate({
      discussionId: discussion.id,
      topic: discussion.title,
      expertCount: 2,
    });

    for (const p of panelists) {
      expect(p.status).toBe("waiting");
    }
  });

  it("generates valid UUIDs for all panelists", async () => {
    const discussion = await discussionRepo.create({ title: "Test Topic" });

    const panelists = await generator.generate({
      discussionId: discussion.id,
      topic: discussion.title,
      expertCount: 2,
    });

    for (const p of panelists) {
      expect(p.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });

  it("isolates panelists per discussion", async () => {
    const discA = await discussionRepo.create({ title: "Topic A" });
    const discB = await discussionRepo.create({ title: "Topic B" });

    const aiForB = new MockAIService({ content: VALID_PANEL_JSON });
    const genB = new PanelistGenerator({
      aiService: aiForB,
      discussionRepository: discussionRepo,
      panelistRepository: panelistRepo,
    });

    await generator.generate({
      discussionId: discA.id,
      topic: discA.title,
      expertCount: 2,
    });

    await genB.generate({
      discussionId: discB.id,
      topic: discB.title,
      expertCount: 2,
    });

    const panelistsA = await panelistRepo.findByDiscussionId(discA.id);
    const panelistsB = await panelistRepo.findByDiscussionId(discB.id);

    expect(panelistsA).toHaveLength(3);
    expect(panelistsB).toHaveLength(3);
    // Different discussion IDs
    for (const p of panelistsA) {
      expect(p.discussionId).toBe(discA.id);
    }
    for (const p of panelistsB) {
      expect(p.discussionId).toBe(discB.id);
    }
  });

  // ── Validation cases ───────────────────────────────────────

  it("throws when discussion does not exist", async () => {
    await expect(
      generator.generate({
        discussionId: "non-existent-id",
        topic: "Test",
        expertCount: 2,
      }),
    ).rejects.toThrow("Discussion not found");
  });

  it("throws when expertCount is not a number", async () => {
    const discussion = await discussionRepo.create({ title: "Test" });

    await expect(
      generator.generate({
        discussionId: discussion.id,
        topic: discussion.title,
        expertCount: "three" as unknown as number,
      }),
    ).rejects.toThrow("expertCount must be a number");
  });

  it("throws when expertCount is not an integer", async () => {
    const discussion = await discussionRepo.create({ title: "Test" });

    await expect(
      generator.generate({
        discussionId: discussion.id,
        topic: discussion.title,
        expertCount: 2.5,
      }),
    ).rejects.toThrow("expertCount must be an integer");
  });

  it("throws when expertCount is less than 2", async () => {
    const discussion = await discussionRepo.create({ title: "Test" });

    await expect(
      generator.generate({
        discussionId: discussion.id,
        topic: discussion.title,
        expertCount: 1,
      }),
    ).rejects.toThrow("expertCount must be between 2 and 8");
  });

  it("throws when expertCount is greater than 8", async () => {
    const discussion = await discussionRepo.create({ title: "Test" });

    await expect(
      generator.generate({
        discussionId: discussion.id,
        topic: discussion.title,
        expertCount: 9,
      }),
    ).rejects.toThrow("expertCount must be between 2 and 8");
  });

  // ── AI response handling ────────────────────────────────────

  it("throws when AI returns unparseable text", async () => {
    const badAi = new MockAIService({ content: "Hello, I am an AI and I cannot do that." });
    const badGen = new PanelistGenerator({
      aiService: badAi,
      discussionRepository: discussionRepo,
      panelistRepository: panelistRepo,
    });
    const discussion = await discussionRepo.create({ title: "Test" });

    await expect(
      badGen.generate({
        discussionId: discussion.id,
        topic: discussion.title,
        expertCount: 2,
      }),
    ).rejects.toThrow("Failed to parse");
  });

  it("throws when AI returns JSON with missing fields", async () => {
    const incomplete = new MockAIService({
      content: JSON.stringify([
        { role: "host", name: "Test" }, // missing occupation, title, stance
      ]),
    });
    const badGen = new PanelistGenerator({
      aiService: incomplete,
      discussionRepository: discussionRepo,
      panelistRepository: panelistRepo,
    });
    const discussion = await discussionRepo.create({ title: "Test" });

    await expect(
      badGen.generate({
        discussionId: discussion.id,
        topic: discussion.title,
        expertCount: 2,
      }),
    ).rejects.toThrow("occupation must be a non-empty string");
  });

  it("throws when AI returns an invalid role", async () => {
    const badRole = new MockAIService({
      content: JSON.stringify([
        { role: "moderator", name: "Test", occupation: "测试", title: "测试员", stance: "测试立场" },
      ]),
    });
    const badGen = new PanelistGenerator({
      aiService: badRole,
      discussionRepository: discussionRepo,
      panelistRepository: panelistRepo,
    });
    const discussion = await discussionRepo.create({ title: "Test" });

    await expect(
      badGen.generate({
        discussionId: discussion.id,
        topic: discussion.title,
        expertCount: 2,
      }),
    ).rejects.toThrow('role must be "host" or "expert"');
  });

  it("accepts JSON wrapped in markdown code fences", async () => {
    const fenced = new MockAIService({
      content: "```json\n" + VALID_PANEL_JSON + "\n```",
    });
    const fencedGen = new PanelistGenerator({
      aiService: fenced,
      discussionRepository: discussionRepo,
      panelistRepository: panelistRepo,
    });
    const discussion = await discussionRepo.create({ title: "Test" });

    const panelists = await fencedGen.generate({
      discussionId: discussion.id,
      topic: discussion.title,
      expertCount: 2,
    });

    expect(panelists).toHaveLength(3);
  });

  it("trims whitespace from all string fields", async () => {
    const paddedAi = new MockAIService({
      content: JSON.stringify([
        {
          role: "host",
          name: "  林澜  ",
          occupation: "  主持人  ",
          title: "  圆桌讨论主持人  ",
          stance: "  中立，引导讨论深入  ",
        },
      ]),
    });
    const paddedGen = new PanelistGenerator({
      aiService: paddedAi,
      discussionRepository: discussionRepo,
      panelistRepository: panelistRepo,
    });
    const discussion = await discussionRepo.create({ title: "Test" });

    // expertCount validation expects >= 2 experts, but we only have 1 entry
    // in the mock — this tests trimming on the one entry we have.
    // Use a mock that returns 1 host + 2 experts to match expertCount=2
    const validPadded = new MockAIService({
      content: JSON.stringify([
        {
          role: "host",
          name: "  林澜  ",
          occupation: "  主持人  ",
          title: "  圆桌讨论主持人  ",
          stance: "  中立，引导讨论深入  ",
        },
        {
          role: "expert",
          name: "  张明远  ",
          occupation: "  经济学家  ",
          title: "  宏观经济学家  ",
          stance: "  支持市场化  ",
          beliefs: "  市场机制最优  ",
          concerns: "  干预导致低效  ",
          argumentStyle: "  数据驱动  ",
        },
        {
          role: "expert",
          name: "  李思涵  ",
          occupation: "  技术专家  ",
          title: "  AI 研究员  ",
          stance: "  技术创新驱动  ",
          beliefs: "  技术是根本  ",
          concerns: "  技术发展过快  ",
          argumentStyle: "  温和建设  ",
        },
      ]),
    });
    const gen = new PanelistGenerator({
      aiService: validPadded,
      discussionRepository: discussionRepo,
      panelistRepository: panelistRepo,
    });

    const panelists = await gen.generate({
      discussionId: discussion.id,
      topic: discussion.title,
      expertCount: 2,
    });

    expect(panelists[0].name).toBe("林澜");
    expect(panelists[0].occupation).toBe("主持人");
    expect(panelists[0].title).toBe("圆桌讨论主持人");
    expect(panelists[0].stance).toBe("中立，引导讨论深入");
    // Also verify second expert trimming
    expect(panelists[2].name).toBe("李思涵");
    expect(panelists[2].occupation).toBe("技术专家");
    expect(panelists[2].title).toBe("AI 研究员");
    expect(panelists[2].stance).toBe("技术创新驱动");
  });

  it("calls AIService.generate with correct messages", async () => {
    const discussion = await discussionRepo.create({ title: "新能源汽车的未来" });

    await generator.generate({
      discussionId: discussion.id,
      topic: discussion.title,
      expertCount: 2,
    });

    const requests = aiService.getRequests();
    expect(requests).toHaveLength(1);

    const req = requests[0];
    expect(req.messages).toHaveLength(2); // system + user
    expect(req.messages[0].role).toBe("system");
    expect(req.messages[1].role).toBe("user");
    expect(req.messages[1].content).toContain("新能源汽车的未来");
    expect(req.messages[1].content).toContain("Number of experts: 2");
  });
});

// ═══════════════════════════════════════════════════════════════
// API integration tests — POST /api/discussions/:id/panelists/generate
// ═══════════════════════════════════════════════════════════════

describe("POST /api/discussions/:discussionId/panelists/generate", () => {
  // ── Success ────────────────────────────────────────────────

  it("returns 201 with generated panelists", async () => {
    const { app } = createTestApp();
    const discussion = await createDiscussion(app);

    const res = await request(app)
      .post(`/api/discussions/${discussion.id}/panelists/generate`)
      .send({ expertCount: 2 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3); // 1 host + 2 experts (matches VALID_PANEL_JSON)
    expect(res.body[0].role).toBe("host");
    expect(res.body[1].role).toBe("expert");
  });

  it("makes generated panelists visible in GET /panelists", async () => {
    const { app } = createTestApp();
    const discussion = await createDiscussion(app);

    const genRes = await request(app)
      .post(`/api/discussions/${discussion.id}/panelists/generate`)
      .send({ expertCount: 2 });

    expect(genRes.status).toBe(201);

    const listRes = await request(app).get(
      `/api/discussions/${discussion.id}/panelists`,
    );

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(3);
  });

  it("isolates generated panelists between discussions", async () => {
    const { app } = createTestApp();
    const discA = await createDiscussion(app, "Topic A");
    const discB = await createDiscussion(app, "Topic B");

    await request(app)
      .post(`/api/discussions/${discA.id}/panelists/generate`)
      .send({ expertCount: 2 });

    await request(app)
      .post(`/api/discussions/${discB.id}/panelists/generate`)
      .send({ expertCount: 2 });

    const listA = await request(app).get(
      `/api/discussions/${discA.id}/panelists`,
    );
    const listB = await request(app).get(
      `/api/discussions/${discB.id}/panelists`,
    );

    // Each discussion gets 3 panelists (1 host + 2 experts from mock)
    expect(listA.body).toHaveLength(3);
    expect(listB.body).toHaveLength(3);

    // Panelists belong to their respective discussions
    for (const p of listA.body) {
      expect(p.discussionId).toBe(discA.id);
    }
    for (const p of listB.body) {
      expect(p.discussionId).toBe(discB.id);
    }
  });

  // ── Validation ─────────────────────────────────────────────

  it("returns 404 when discussion does not exist", async () => {
    const { app } = createTestApp();

    const res = await request(app)
      .post("/api/discussions/non-existent/panelists/generate")
      .send({ expertCount: 3 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Discussion not found" });
  });

  it("returns 400 when expertCount is missing", async () => {
    const { app } = createTestApp();
    const discussion = await createDiscussion(app);

    const res = await request(app)
      .post(`/api/discussions/${discussion.id}/panelists/generate`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "expertCount is required" });
  });

  it("returns 400 when expertCount is not a number", async () => {
    const { app } = createTestApp();
    const discussion = await createDiscussion(app);

    const res = await request(app)
      .post(`/api/discussions/${discussion.id}/panelists/generate`)
      .send({ expertCount: "three" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "expertCount must be a number" });
  });

  it("returns 400 when expertCount is not an integer", async () => {
    const { app } = createTestApp();
    const discussion = await createDiscussion(app);

    const res = await request(app)
      .post(`/api/discussions/${discussion.id}/panelists/generate`)
      .send({ expertCount: 2.5 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "expertCount must be an integer" });
  });

  it("returns 400 when expertCount < 2", async () => {
    const { app } = createTestApp();
    const discussion = await createDiscussion(app);

    const res = await request(app)
      .post(`/api/discussions/${discussion.id}/panelists/generate`)
      .send({ expertCount: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "expertCount must be between 2 and 8" });
  });

  it("returns 400 when expertCount > 8", async () => {
    const { app } = createTestApp();
    const discussion = await createDiscussion(app);

    const res = await request(app)
      .post(`/api/discussions/${discussion.id}/panelists/generate`)
      .send({ expertCount: 10 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "expertCount must be between 2 and 8" });
  });

  // ── Error handling ─────────────────────────────────────────

  it("returns 422 when AI response cannot be parsed", async () => {
    const { app } = createTestApp("not valid json at all");
    const discussion = await createDiscussion(app);

    const res = await request(app)
      .post(`/api/discussions/${discussion.id}/panelists/generate`)
      .send({ expertCount: 3 });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("Failed to parse");
  });
});
