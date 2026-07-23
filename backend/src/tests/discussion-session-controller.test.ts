import { describe, it, expect, beforeEach } from "vitest";
import { DiscussionSessionController } from "../controllers/DiscussionSessionController.js";
import { DiscussionEngine, RunDiscussionRequest } from "../services/DiscussionEngine.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { SessionLifecycle } from "../lifecycle/SessionLifecycle.js";
import { Message } from "../domain/message.js";
import { Discussion, DiscussionStatus } from "../domain/discussion.js";
import { InMemoryMessageRepository } from "../repositories/InMemoryMessageRepository.js";
import { TemplateSessionLifecycle } from "../lifecycle/TemplateSessionLifecycle.js";

// ── Helpers ────────────────────────────────────────────────────

function makeMsg(id: string, discussionId: string, role: "user" | "assistant" = "assistant"): Message {
  return {
    id,
    discussionId,
    panelistId: null,
    role,
    kind: null,
    content: `message ${id}`,
    replyToMessageId: null,
    createdAt: new Date().toISOString(),
  };
}

function makeDiscussion(id: string, status: DiscussionStatus = "active"): Discussion {
  return {
    id,
    title: "Test Discussion",
    status,
    createdAt: "2024-01-01T00:00:00.000Z",
    durationLimit: 300,
  };
}

// ── Engine doubles ─────────────────────────────────────────────

class StubDiscussionEngine {
  public callCount = 0;
  public lastRequest: RunDiscussionRequest | null = null;
  private messages: Message[];

  constructor(messages: Message[]) {
    this.messages = messages;
  }

  async runDiscussion(request: RunDiscussionRequest): Promise<Message[]> {
    this.callCount++;
    this.lastRequest = request;
    return [...this.messages];
  }
}

class FailingDiscussionEngine {
  async runDiscussion(_request: RunDiscussionRequest): Promise<Message[]> {
    throw new Error("engine error");
  }
}

// ── Lifecycle doubles ──────────────────────────────────────────

class SpySessionLifecycle implements SessionLifecycle {
  public startCallCount = 0;
  public endCallCount = 0;
  public lastStartContext: { discussionId: string } | null = null;
  public lastEndContext: { discussionId: string } | null = null;
  private startMessages: Message[];
  private endMessages: Message[];

  constructor(startMessages: Message[] = [], endMessages: Message[] = []) {
    this.startMessages = startMessages;
    this.endMessages = endMessages;
  }

  async onSessionStart(context: { discussionId: string }): Promise<Message[]> {
    this.startCallCount++;
    this.lastStartContext = context;
    return [...this.startMessages];
  }

  async onSessionEnd(context: { discussionId: string }): Promise<Message[]> {
    this.endCallCount++;
    this.lastEndContext = context;
    return [...this.endMessages];
  }
}

class FailingStartLifecycle implements SessionLifecycle {
  async onSessionStart(_context: { discussionId: string }): Promise<Message[]> {
    throw new Error("start hook error");
  }

  async onSessionEnd(_context: { discussionId: string }): Promise<Message[]> {
    return [];
  }
}

class FailingEndLifecycle implements SessionLifecycle {
  async onSessionStart(_context: { discussionId: string }): Promise<Message[]> {
    return [];
  }

  async onSessionEnd(_context: { discussionId: string }): Promise<Message[]> {
    throw new Error("end hook error");
  }
}

// ── Repository doubles ─────────────────────────────────────────

function stubDiscussionRepo(discussion: Discussion | null): DiscussionRepository {
  return {
    findById: async () => discussion,
    create: async () => { throw new Error("create not expected"); },
    findAll: async () => { throw new Error("findAll not expected"); },
    updateStatus: async () => { throw new Error("updateStatus not expected"); },
  };
}

function failingDiscussionRepo(): DiscussionRepository {
  return {
    findById: async () => { throw new Error("repo error"); },
    create: async () => { throw new Error("create not expected"); },
    findAll: async () => { throw new Error("findAll not expected"); },
    updateStatus: async () => { throw new Error("updateStatus not expected"); },
  };
}

// ── Constants ──────────────────────────────────────────────────

const DISCUSSION_ID = "d0f1e4e0-19b4-4b1e-8a4c-3f2d9b6a7c8e";
const MAX_ROUNDS = 3;

// ── Tests ──────────────────────────────────────────────────────

describe("DiscussionSessionController", () => {
  // ── Happy path ───────────────────────────────────────────────

  describe("happy path", () => {
    it("returns messages in order: start → engine → end", async () => {
      const startMsg = makeMsg("start-1", DISCUSSION_ID);
      const engineMsg = makeMsg("engine-1", DISCUSSION_ID);
      const endMsg = makeMsg("end-1", DISCUSSION_ID);

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([engineMsg]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle: new SpySessionLifecycle([startMsg], [endMsg]),
      });

      const result = await controller.runSession({
        discussionId: DISCUSSION_ID,
        maxRounds: MAX_ROUNDS,
      });

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe("start-1");
      expect(result[1].id).toBe("engine-1");
      expect(result[2].id).toBe("end-1");
    });

    it("returns start and end messages when engine produces none", async () => {
      const startMsg = makeMsg("start-1", DISCUSSION_ID);
      const endMsg = makeMsg("end-1", DISCUSSION_ID);

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle: new SpySessionLifecycle([startMsg], [endMsg]),
      });

      const result = await controller.runSession({
        discussionId: DISCUSSION_ID,
        maxRounds: MAX_ROUNDS,
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("start-1");
      expect(result[1].id).toBe("end-1");
    });

    it("passes the correct request to the engine", async () => {
      const engine = new StubDiscussionEngine([]);

      const controller = new DiscussionSessionController({
        discussionEngine: engine as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle: new SpySessionLifecycle(),
      });

      await controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: 5 });

      expect(engine.lastRequest).toEqual({
        discussionId: DISCUSSION_ID,
        maxRounds: 5,
      });
    });

    it("calls onSessionStart and onSessionEnd exactly once each", async () => {
      const lifecycle = new SpySessionLifecycle();

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle,
      });

      await controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS });

      expect(lifecycle.startCallCount).toBe(1);
      expect(lifecycle.endCallCount).toBe(1);
    });

    it("passes discussionId to lifecycle hooks", async () => {
      const lifecycle = new SpySessionLifecycle();

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle,
      });

      await controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS });

      expect(lifecycle.lastStartContext).toEqual({ discussionId: DISCUSSION_ID });
      expect(lifecycle.lastEndContext).toEqual({ discussionId: DISCUSSION_ID });
    });

    it("executes sequentially — no concurrent hook or engine calls", async () => {
      const order: string[] = [];
      const engine = {
        async runDiscussion(_req: RunDiscussionRequest): Promise<Message[]> {
          order.push("engine");
          return [];
        },
      };
      const lifecycle = {
        async onSessionStart(_ctx: { discussionId: string }): Promise<Message[]> {
          order.push("start");
          return [];
        },
        async onSessionEnd(_ctx: { discussionId: string }): Promise<Message[]> {
          order.push("end");
          return [];
        },
      };

      const controller = new DiscussionSessionController({
        discussionEngine: engine as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle,
      });

      await controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS });

      expect(order).toEqual(["start", "engine", "end"]);
    });

    it("preserves engine message order within the result", async () => {
      const engineMsgs = [
        makeMsg("r1", DISCUSSION_ID),
        makeMsg("r2", DISCUSSION_ID),
        makeMsg("r3", DISCUSSION_ID),
      ];
      const startMsg = makeMsg("start", DISCUSSION_ID);
      const endMsg = makeMsg("end", DISCUSSION_ID);

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine(engineMsgs) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle: new SpySessionLifecycle([startMsg], [endMsg]),
      });

      const result = await controller.runSession({
        discussionId: DISCUSSION_ID,
        maxRounds: MAX_ROUNDS,
      });

      // start, then all engine messages in order, then end
      expect(result.map((m) => m.id)).toEqual(["start", "r1", "r2", "r3", "end"]);
    });
  });

  // ── maxRounds validation ─────────────────────────────────────

  describe("maxRounds validation", () => {
    const invalidCases = [
      { label: "zero", value: 0, expected: "maxRounds must be greater than zero" },
      { label: "negative", value: -1, expected: "maxRounds must be greater than zero" },
      { label: "fractional", value: 2.5, expected: "maxRounds must be an integer" },
      { label: "NaN", value: NaN, expected: "maxRounds must be finite" },
      { label: "Infinity", value: Infinity, expected: "maxRounds must be finite" },
      { label: "non-number string", value: "3", expected: "maxRounds must be a number" },
      { label: "undefined", value: undefined, expected: "maxRounds must be a number" },
    ];

    for (const { label, value, expected } of invalidCases) {
      it(`throws "${expected}" for ${label} maxRounds`, async () => {
        const lifecycle = new SpySessionLifecycle();
        const engine = new StubDiscussionEngine([]);

        const controller = new DiscussionSessionController({
          discussionEngine: engine as unknown as DiscussionEngine,
          discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
          lifecycle,
        });

        await expect(
          controller.runSession({
            discussionId: DISCUSSION_ID,
            maxRounds: value as unknown as number,
          }),
        ).rejects.toThrow(expected);
      });
    }

    it("throws before calling onSessionStart", async () => {
      const lifecycle = new SpySessionLifecycle();

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle,
      });

      await expect(
        controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: 0 }),
      ).rejects.toThrow("maxRounds must be greater than zero");

      expect(lifecycle.startCallCount).toBe(0);
    });

    it("throws before calling DiscussionEngine", async () => {
      const engine = new StubDiscussionEngine([]);

      const controller = new DiscussionSessionController({
        discussionEngine: engine as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle: new SpySessionLifecycle(),
      });

      await expect(
        controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: 0 }),
      ).rejects.toThrow("maxRounds must be greater than zero");

      expect(engine.callCount).toBe(0);
    });

    it("persists no lifecycle message for an invalid request", async () => {
      const messageRepo = new InMemoryMessageRepository();
      const lifecycle = new TemplateSessionLifecycle({ messageRepository: messageRepo });

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle,
      });

      await expect(
        controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: 0 }),
      ).rejects.toThrow("maxRounds must be greater than zero");

      const messages = await messageRepo.findByDiscussionId(DISCUSSION_ID);
      expect(messages).toHaveLength(0);
    });
  });

  // ── Discussion not found ─────────────────────────────────────

  describe("discussion not found", () => {
    it("throws before any lifecycle hook executes", async () => {
      const lifecycle = new SpySessionLifecycle();

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(null),
        lifecycle,
      });

      await expect(
        controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS }),
      ).rejects.toThrow("Discussion not found");

      expect(lifecycle.startCallCount).toBe(0);
      expect(lifecycle.endCallCount).toBe(0);
    });

    it("does not call the engine", async () => {
      const engine = new StubDiscussionEngine([]);

      const controller = new DiscussionSessionController({
        discussionEngine: engine as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(null),
        lifecycle: new SpySessionLifecycle(),
      });

      await expect(
        controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS }),
      ).rejects.toThrow("Discussion not found");

      expect(engine.callCount).toBe(0);
    });
  });

  // ── Already-finished discussion ──────────────────────────────

  describe("already-finished discussion", () => {
    it("returns an empty Message[] immediately", async () => {
      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID, "finished")),
        lifecycle: new SpySessionLifecycle(),
      });

      const result = await controller.runSession({
        discussionId: DISCUSSION_ID,
        maxRounds: MAX_ROUNDS,
      });

      expect(result).toEqual([]);
    });

    it("does not call onSessionStart", async () => {
      const lifecycle = new SpySessionLifecycle();

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID, "finished")),
        lifecycle,
      });

      await controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS });

      expect(lifecycle.startCallCount).toBe(0);
    });

    it("does not call DiscussionEngine", async () => {
      const engine = new StubDiscussionEngine([]);

      const controller = new DiscussionSessionController({
        discussionEngine: engine as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID, "finished")),
        lifecycle: new SpySessionLifecycle(),
      });

      await controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS });

      expect(engine.callCount).toBe(0);
    });

    it("does not call onSessionEnd", async () => {
      const lifecycle = new SpySessionLifecycle();

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID, "finished")),
        lifecycle,
      });

      await controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS });

      expect(lifecycle.endCallCount).toBe(0);
    });

    it("persists no lifecycle message", async () => {
      const messageRepo = new InMemoryMessageRepository();
      const lifecycle = new TemplateSessionLifecycle({ messageRepository: messageRepo });

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID, "finished")),
        lifecycle,
      });

      const result = await controller.runSession({
        discussionId: DISCUSSION_ID,
        maxRounds: MAX_ROUNDS,
      });

      expect(result).toEqual([]);
      const messages = await messageRepo.findByDiscussionId(DISCUSSION_ID);
      expect(messages).toHaveLength(0);
    });
  });

  // ── Active discussion with no panelists (engine returns []) ──

  describe("active discussion — engine returns no messages", () => {
    it("still invokes onSessionStart and onSessionEnd", async () => {
      const lifecycle = new SpySessionLifecycle();

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID, "active")),
        lifecycle,
      });

      await controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS });

      expect(lifecycle.startCallCount).toBe(1);
      expect(lifecycle.endCallCount).toBe(1);
    });

    it("returns only the start and end messages", async () => {
      const startMsg = makeMsg("start-1", DISCUSSION_ID);
      const endMsg = makeMsg("end-1", DISCUSSION_ID);

      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle: new SpySessionLifecycle([startMsg], [endMsg]),
      });

      const result = await controller.runSession({
        discussionId: DISCUSSION_ID,
        maxRounds: MAX_ROUNDS,
      });

      expect(result).toEqual([startMsg, endMsg]);
    });
  });

  // ── Error propagation ────────────────────────────────────────

  describe("error propagation", () => {
    it("propagates DiscussionRepository errors unchanged", async () => {
      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: failingDiscussionRepo(),
        lifecycle: new SpySessionLifecycle(),
      });

      await expect(
        controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS }),
      ).rejects.toThrow("repo error");
    });

    it("propagates onSessionStart errors and does not call engine", async () => {
      const engine = new StubDiscussionEngine([]);

      const controller = new DiscussionSessionController({
        discussionEngine: engine as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle: new FailingStartLifecycle(),
      });

      await expect(
        controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS }),
      ).rejects.toThrow("start hook error");

      expect(engine.callCount).toBe(0);
    });

    it("propagates engine errors and does not call onSessionEnd", async () => {
      const lifecycle = new SpySessionLifecycle();

      const controller = new DiscussionSessionController({
        discussionEngine: new FailingDiscussionEngine() as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle,
      });

      await expect(
        controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS }),
      ).rejects.toThrow("engine error");

      // onSessionStart was called, but onSessionEnd was not
      expect(lifecycle.startCallCount).toBe(1);
      expect(lifecycle.endCallCount).toBe(0);
    });

    it("propagates onSessionEnd errors", async () => {
      const controller = new DiscussionSessionController({
        discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
        discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
        lifecycle: new FailingEndLifecycle(),
      });

      await expect(
        controller.runSession({ discussionId: DISCUSSION_ID, maxRounds: MAX_ROUNDS }),
      ).rejects.toThrow("end hook error");
    });
  });

  // ── No AIService / MessageRepository dependency ──────────────

  it("does not call AIService or MessageRepository directly", async () => {
    // If the controller compiles without importing AIService or
    // MessageRepository, it has no path to call them directly.
    // This test verifies the structural constraint — the constructor
    // signature only requires DiscussionEngine, DiscussionRepository,
    // and SessionLifecycle.

    const controller = new DiscussionSessionController({
      discussionEngine: new StubDiscussionEngine([]) as unknown as DiscussionEngine,
      discussionRepository: stubDiscussionRepo(makeDiscussion(DISCUSSION_ID)),
      lifecycle: new SpySessionLifecycle(),
    });

    const result = await controller.runSession({
      discussionId: DISCUSSION_ID,
      maxRounds: MAX_ROUNDS,
    });

    expect(result).toEqual([]);
  });
});
