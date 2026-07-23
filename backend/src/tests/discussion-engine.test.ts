import { describe, it, expect, vi } from "vitest";
import { DiscussionEngine } from "../services/DiscussionEngine.js";
import { DiscussionController } from "../controllers/DiscussionController.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { Discussion, DiscussionStatus, CreateDiscussionInput } from "../domain/discussion.js";
import { Panelist, CreatePanelistInput } from "../domain/panelist.js";
import { Message } from "../domain/message.js";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Create a Discussion object (not persisted). */
function makeDiscussion(
  overrides: Partial<Discussion> = {},
): Discussion {
  return {
    id: "disc-1",
    title: "The future of renewable energy",
    status: "active",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a Panelist object (not persisted). */
function makePanelist(
  overrides: Partial<Panelist> = {},
): Panelist {
  return {
    id: "panelist-1",
    discussionId: "disc-1",
    role: "expert",
    name: "Dr. Li Wei",
    occupation: "Energy Economist",
    title: "Chief Economist at GreenFuture Institute",
    stance: "Market-based carbon pricing is the most efficient path to net-zero",
    color: "#4A90D9",
    status: "waiting",
    currentFocus: null,
    publicSummary: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a synthetic assistant Message. */
function makeMessage(
  overrides: Partial<Message> = {},
): Message {
  return {
    id: "msg-1",
    discussionId: "disc-1",
    panelistId: null,
    role: "assistant",
    kind: null,
    content: "Default response",
    replyToMessageId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Message;
}

// ------------------------------------------------------------------
// Test doubles
// ------------------------------------------------------------------

/**
 * A DiscussionController stub that returns configurable messages per call.
 * Tracks every call for assertion.
 */
class StubDiscussionController {
  private callCount = 0;
  private readonly callArgs: Array<{ discussionId: string }> = [];
  private readonly messageBatches: Message[][];

  /**
   * @param messageBatches Each entry is the Message[] returned for one
   *   executeDiscussion call. The N-th call returns messageBatches[N].
   *   If more calls are made than batches, the last batch is reused.
   */
  constructor(...messageBatches: Message[][]) {
    this.messageBatches = messageBatches;
  }

  async executeDiscussion(input: {
    discussionId: string;
  }): Promise<Message[]> {
    this.callCount++;
    this.callArgs.push({ discussionId: input.discussionId });

    const index = Math.min(this.callCount - 1, this.messageBatches.length - 1);
    const batch = this.messageBatches[index];
    if (batch === undefined) {
      return [];
    }
    // Return shallow copies so callers can't mutate internal state
    return [...batch];
  }

  getCallCount(): number {
    return this.callCount;
  }

  getCallArgs(): readonly { discussionId: string }[] {
    return this.callArgs;
  }
}

/**
 * A DiscussionController stub that always throws.
 */
class FailingDiscussionController {
  private readonly errorMessage: string;
  callCount = 0;

  constructor(errorMessage = "DiscussionController failure") {
    this.errorMessage = errorMessage;
  }

  async executeDiscussion(_input: {
    discussionId: string;
  }): Promise<Message[]> {
    this.callCount++;
    throw new Error(this.errorMessage);
  }
}

/**
 * A DiscussionController stub that throws on the N-th call (1-indexed).
 * Earlier calls return the provided Message batch.
 */
class FailingOnNthCallController {
  private callCount = 0;

  constructor(
    private readonly failOnCall: number,
    private readonly messagesPerRound: Message[],
    private readonly errorMessage = "Controller failure on Nth call",
  ) {}

  async executeDiscussion(input: {
    discussionId: string;
  }): Promise<Message[]> {
    this.callCount++;
    if (this.callCount >= this.failOnCall) {
      throw new Error(this.errorMessage);
    }
    return [...this.messagesPerRound];
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// ------------------------------------------------------------------
// Repository stubs
// ------------------------------------------------------------------

/**
 * A DiscussionRepository stub backed by a configurable Discussion.
 * Supports changing the discussion between calls (to simulate "becoming finished").
 */
class StubDiscussionRepository implements DiscussionRepository {
  private current: Discussion;

  constructor(discussion: Discussion) {
    this.current = discussion;
  }

  /** Replace the discussion returned by subsequent findById calls. */
  setDiscussion(discussion: Discussion): void {
    this.current = discussion;
  }

  async create(_input: CreateDiscussionInput): Promise<Discussion> {
    throw new Error("StubDiscussionRepository.create() not implemented");
  }

  async findAll(): Promise<Discussion[]> {
    throw new Error("StubDiscussionRepository.findAll() not implemented");
  }

  async findById(_id: string): Promise<Discussion | null> {
    return { ...this.current };
  }

  async updateStatus(_id: string, _status: DiscussionStatus): Promise<Discussion> {
    throw new Error("StubDiscussionRepository.updateStatus() not implemented");
  }
}

/**
 * A DiscussionRepository stub whose findById() always throws.
 */
class FailingDiscussionRepository implements DiscussionRepository {
  private readonly errorMessage: string;

  constructor(errorMessage = "DiscussionRepository failure") {
    this.errorMessage = errorMessage;
  }

  async create(_input: CreateDiscussionInput): Promise<Discussion> {
    throw new Error(this.errorMessage);
  }

  async findAll(): Promise<Discussion[]> {
    throw new Error(this.errorMessage);
  }

  async findById(_id: string): Promise<Discussion | null> {
    throw new Error(this.errorMessage);
  }

  async updateStatus(_id: string, _status: DiscussionStatus): Promise<Discussion> {
    throw new Error(this.errorMessage);
  }
}

/**
 * A PanelistRepository stub backed by a configurable panelist list.
 * Supports changing the list between calls (to simulate panelists becoming finished).
 */
class StubPanelistRepository implements PanelistRepository {
  private current: Panelist[];

  constructor(panelists: Panelist[]) {
    this.current = panelists;
  }

  /** Replace the panelist list returned by subsequent calls. */
  setPanelists(panelists: Panelist[]): void {
    this.current = panelists;
  }

  async create(_input: CreatePanelistInput): Promise<Panelist> {
    throw new Error("StubPanelistRepository.create() not implemented");
  }

  async findById(_id: string): Promise<Panelist | null> {
    throw new Error("StubPanelistRepository.findById() not implemented");
  }

  async findByDiscussionId(_discussionId: string): Promise<Panelist[]> {
    // Return shallow copies so callers can't mutate internal state
    return this.current.map((p) => ({ ...p }));
  }
}

/**
 * A PanelistRepository stub whose findByDiscussionId() always throws.
 */
class FailingPanelistRepository implements PanelistRepository {
  private readonly errorMessage: string;

  constructor(errorMessage = "PanelistRepository failure") {
    this.errorMessage = errorMessage;
  }

  async create(_input: CreatePanelistInput): Promise<Panelist> {
    throw new Error(this.errorMessage);
  }

  async findById(_id: string): Promise<Panelist | null> {
    throw new Error(this.errorMessage);
  }

  async findByDiscussionId(_discussionId: string): Promise<Panelist[]> {
    throw new Error(this.errorMessage);
  }
}

// ------------------------------------------------------------------
// Builder
// ------------------------------------------------------------------

interface EngineKit {
  engine: DiscussionEngine;
  discussionRepo: StubDiscussionRepository;
  panelistRepo: StubPanelistRepository;
  controller: StubDiscussionController;
}

function buildEngine(
  controller?: StubDiscussionController,
  discussionRepo?: StubDiscussionRepository,
  panelistRepo?: StubPanelistRepository,
): EngineKit {
  const ctrl = controller ?? new StubDiscussionController();
  const discRepo = discussionRepo ?? new StubDiscussionRepository(makeDiscussion());
  const pnlRepo = panelistRepo ?? new StubPanelistRepository([makePanelist()]);

  const engine = new DiscussionEngine({
    discussionController: ctrl as unknown as DiscussionController,
    discussionRepository: discRepo as unknown as DiscussionRepository,
    panelistRepository: pnlRepo as unknown as PanelistRepository,
  });

  return { engine, discussionRepo: discRepo, panelistRepo: pnlRepo, controller: ctrl };
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("DiscussionEngine", () => {
  // ================================================================
  // Validation
  // ================================================================
  describe("maxRounds validation", () => {
    it("throws when maxRounds is 0", async () => {
      const { engine } = buildEngine();

      await expect(
        engine.runDiscussion({ discussionId: "disc-1", maxRounds: 0 }),
      ).rejects.toThrow("maxRounds must be greater than zero");
    });

    it("throws when maxRounds is negative", async () => {
      const { engine } = buildEngine();

      await expect(
        engine.runDiscussion({ discussionId: "disc-1", maxRounds: -1 }),
      ).rejects.toThrow("maxRounds must be greater than zero");
    });

    it("throws when maxRounds is fractional", async () => {
      const { engine } = buildEngine();

      await expect(
        engine.runDiscussion({ discussionId: "disc-1", maxRounds: 2.5 }),
      ).rejects.toThrow("maxRounds must be an integer");
    });

    it("throws when maxRounds is NaN", async () => {
      const { engine } = buildEngine();

      await expect(
        engine.runDiscussion({ discussionId: "disc-1", maxRounds: NaN }),
      ).rejects.toThrow("maxRounds must be finite");
    });

    it("throws when maxRounds is Infinity", async () => {
      const { engine } = buildEngine();

      await expect(
        engine.runDiscussion({ discussionId: "disc-1", maxRounds: Infinity }),
      ).rejects.toThrow("maxRounds must be finite");
    });

    it("throws when maxRounds is not a number (string)", async () => {
      const { engine } = buildEngine();

      await expect(
        engine.runDiscussion({
          discussionId: "disc-1",
          maxRounds: "3" as unknown as number,
        }),
      ).rejects.toThrow("maxRounds must be a number");
    });

    it("does not call any dependency before validation fails", async () => {
      // Use a DiscussionRepository that throws — it should NOT be called
      const discRepo = new FailingDiscussionRepository("should not be called");
      const panelistRepo = new StubPanelistRepository([makePanelist()]);
      const controller = new StubDiscussionController();

      const engine = new DiscussionEngine({
        discussionController: controller as unknown as DiscussionController,
        discussionRepository: discRepo as unknown as DiscussionRepository,
        panelistRepository: panelistRepo as unknown as PanelistRepository,
      });

      // maxRounds = 0 should throw before touching any repository
      await expect(
        engine.runDiscussion({ discussionId: "disc-1", maxRounds: 0 }),
      ).rejects.toThrow("maxRounds must be greater than zero");

      expect(controller.getCallCount()).toBe(0);
    });
  });

  // ================================================================
  // Single round
  // ================================================================
  describe("single round execution", () => {
    it("executes one round and returns its messages when maxRounds = 1", async () => {
      const messages = [makeMessage({ id: "msg-a", content: "Hello" })];
      const controller = new StubDiscussionController(messages);
      const { engine } = buildEngine(controller);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 1,
      });

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Hello");
      expect(controller.getCallCount()).toBe(1);
    });

    it("returns a Message array with valid structure", async () => {
      const messages = [makeMessage({ id: "msg-xyz", content: "Test" })];
      const controller = new StubDiscussionController(messages);
      const { engine } = buildEngine(controller);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 1,
      });

      expect(result[0]).toHaveProperty("id", "msg-xyz");
      expect(result[0]).toHaveProperty("discussionId", "disc-1");
      expect(result[0]).toHaveProperty("role", "assistant");
      expect(result[0]).toHaveProperty("content", "Test");
      expect(result[0]).toHaveProperty("createdAt");
    });
  });

  // ================================================================
  // Multiple rounds
  // ================================================================
  describe("multiple round execution", () => {
    it("executes multiple rounds sequentially", async () => {
      const round1 = [makeMessage({ id: "r1", content: "Round 1" })];
      const round2 = [makeMessage({ id: "r2", content: "Round 2" })];
      const round3 = [makeMessage({ id: "r3", content: "Round 3" })];
      const controller = new StubDiscussionController(round1, round2, round3);
      const { engine } = buildEngine(controller);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 3,
      });

      expect(controller.getCallCount()).toBe(3);
      expect(result).toHaveLength(3);
    });

    it("preserves message order: round 1, then round 2, then round 3", async () => {
      const round1 = [
        makeMessage({ id: "r1a", content: "R1-M1" }),
        makeMessage({ id: "r1b", content: "R1-M2" }),
      ];
      const round2 = [makeMessage({ id: "r2a", content: "R2-M1" })];
      const round3 = [
        makeMessage({ id: "r3a", content: "R3-M1" }),
        makeMessage({ id: "r3b", content: "R3-M2" }),
        makeMessage({ id: "r3c", content: "R3-M3" }),
      ];
      const controller = new StubDiscussionController(round1, round2, round3);
      const { engine } = buildEngine(controller);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 3,
      });

      expect(result).toHaveLength(6);
      expect(result[0].id).toBe("r1a");
      expect(result[1].id).toBe("r1b");
      expect(result[2].id).toBe("r2a");
      expect(result[3].id).toBe("r3a");
      expect(result[4].id).toBe("r3b");
      expect(result[5].id).toBe("r3c");
    });

    it("respects maxRounds — stops after reaching the limit", async () => {
      const roundMessages = [makeMessage({ content: "Round message" })];
      const controller = new StubDiscussionController(roundMessages);
      const { engine } = buildEngine(controller);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 2,
      });

      expect(controller.getCallCount()).toBe(2);
      expect(result).toHaveLength(2);
    });
  });

  // ================================================================
  // DiscussionController receives correct discussionId
  // ================================================================
  describe("discussionId forwarding", () => {
    it("passes the correct discussionId to DiscussionController", async () => {
      const controller = new StubDiscussionController([makeMessage()]);
      const { engine } = buildEngine(controller);

      await engine.runDiscussion({
        discussionId: "my-discussion-42",
        maxRounds: 2,
      });

      const args = controller.getCallArgs();
      expect(args).toHaveLength(2);
      for (const call of args) {
        expect(call.discussionId).toBe("my-discussion-42");
      }
    });
  });

  // ================================================================
  // DiscussionController called once per executed round
  // ================================================================
  describe("call count per round", () => {
    it("calls DiscussionController.executeDiscussion exactly once per executed round", async () => {
      const controller = new StubDiscussionController(
        [makeMessage()],
        [makeMessage()],
        [makeMessage()],
        [makeMessage()],
        [makeMessage()],
      );
      const { engine } = buildEngine(controller);

      await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 5,
      });

      expect(controller.getCallCount()).toBe(5);
    });
  });

  // ================================================================
  // Finished discussion stop condition
  // ================================================================
  describe("finished discussion stop condition", () => {
    it("executes zero rounds when the discussion is already finished", async () => {
      const finishedDiscussion = makeDiscussion({ status: "finished" });
      const discRepo = new StubDiscussionRepository(finishedDiscussion);
      const controller = new StubDiscussionController([makeMessage()]);
      const { engine } = buildEngine(controller, discRepo);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 5,
      });

      expect(controller.getCallCount()).toBe(0);
      expect(result).toEqual([]);
    });

    it("stops before the next round when discussion becomes finished between rounds", async () => {
      const activeDiscussion = makeDiscussion({ status: "active" });
      const finishedDiscussion = makeDiscussion({ status: "finished" });

      const controller = new StubDiscussionController(
        [makeMessage({ id: "r1", content: "Round 1" })],
        [makeMessage({ id: "r2", content: "Round 2" })],
      );
      // Schedule the discussion to become finished after the first round
      let findByIdCallCount = 0;

      const smartDiscRepo: DiscussionRepository = {
        create: async () => {
          throw new Error("not implemented");
        },
        findAll: async () => {
          throw new Error("not implemented");
        },
        findById: async (id: string) => {
          findByIdCallCount++;
          if (findByIdCallCount === 1) {
            // First call (before round 1): discussion is active
            return { ...activeDiscussion };
          }
          // Subsequent calls: discussion is finished
          return { ...finishedDiscussion };
        },
        updateStatus: async (_id: string, _status: DiscussionStatus) => {
          throw new Error("not implemented");
        },
      };

      const engine = new DiscussionEngine({
        discussionController: controller as unknown as DiscussionController,
        discussionRepository: smartDiscRepo,
        panelistRepository: new StubPanelistRepository([makePanelist()]) as unknown as PanelistRepository,
      });

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 5,
      });

      expect(controller.getCallCount()).toBe(1);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Round 1");
    });

    it("reloads discussion state before every round", async () => {
      // Use a repository that records every findById call
      const callLog: string[] = [];
      const discRepo: DiscussionRepository = {
        create: async () => {
          throw new Error("not implemented");
        },
        findAll: async () => {
          throw new Error("not implemented");
        },
        findById: async (id: string) => {
          callLog.push(id);
          return makeDiscussion({ status: "active" });
        },
        updateStatus: async (_id: string, _status: DiscussionStatus) => {
          throw new Error("not implemented");
        },
      };

      const controller = new StubDiscussionController(
        [makeMessage()],
        [makeMessage()],
        [makeMessage()],
      );
      const engine = new DiscussionEngine({
        discussionController: controller as unknown as DiscussionController,
        discussionRepository: discRepo,
        panelistRepository: new StubPanelistRepository([makePanelist()]) as unknown as PanelistRepository,
      });

      await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 3,
      });

      // findById should be called before each of the 3 rounds
      expect(callLog).toHaveLength(3);
      expect(callLog.every((id) => id === "disc-1")).toBe(true);
    });
  });

  // ================================================================
  // No active panelists stop condition
  // ================================================================
  describe("no active panelists stop condition", () => {
    it("executes zero rounds when there are no panelists at all", async () => {
      const panelistRepo = new StubPanelistRepository([]);
      const controller = new StubDiscussionController([makeMessage()]);
      const { engine } = buildEngine(controller, undefined, panelistRepo);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 5,
      });

      expect(controller.getCallCount()).toBe(0);
      expect(result).toEqual([]);
    });

    it("executes zero rounds when all panelists are finished", async () => {
      const finishedPanelists = [
        makePanelist({ id: "p1", status: "finished" }),
        makePanelist({ id: "p2", status: "finished" }),
      ];
      const panelistRepo = new StubPanelistRepository(finishedPanelists);
      const controller = new StubDiscussionController([makeMessage()]);
      const { engine } = buildEngine(controller, undefined, panelistRepo);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 5,
      });

      expect(controller.getCallCount()).toBe(0);
      expect(result).toEqual([]);
    });

    it("stops when all panelists become finished between rounds", async () => {
      const activePanelists = [makePanelist({ id: "p1", status: "waiting" })];
      const allFinished = [makePanelist({ id: "p1", status: "finished" })];

      let findByDiscussionIdCallCount = 0;
      const panelistRepo: PanelistRepository = {
        create: async () => {
          throw new Error("not implemented");
        },
        findById: async () => {
          throw new Error("not implemented");
        },
        findByDiscussionId: async (_discussionId: string) => {
          findByDiscussionIdCallCount++;
          if (findByDiscussionIdCallCount === 1) {
            return activePanelists.map((p) => ({ ...p }));
          }
          return allFinished.map((p) => ({ ...p }));
        },
      };

      const controller = new StubDiscussionController(
        [makeMessage({ id: "r1", content: "Round 1" })],
        [makeMessage({ id: "r2", content: "Should not execute" })],
      );
      const engine = new DiscussionEngine({
        discussionController: controller as unknown as DiscussionController,
        discussionRepository: new StubDiscussionRepository(makeDiscussion()) as unknown as DiscussionRepository,
        panelistRepository: panelistRepo,
      });

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 5,
      });

      expect(controller.getCallCount()).toBe(1);
      expect(result).toHaveLength(1);
    });

    it("reloads panelist state before every round", async () => {
      const callLog: string[] = [];
      const panelistRepo: PanelistRepository = {
        create: async () => {
          throw new Error("not implemented");
        },
        findById: async () => {
          throw new Error("not implemented");
        },
        findByDiscussionId: async (discussionId: string) => {
          callLog.push(discussionId);
          return [makePanelist()];
        },
      };

      const controller = new StubDiscussionController(
        [makeMessage()],
        [makeMessage()],
        [makeMessage()],
      );
      const engine = new DiscussionEngine({
        discussionController: controller as unknown as DiscussionController,
        discussionRepository: new StubDiscussionRepository(makeDiscussion()) as unknown as DiscussionRepository,
        panelistRepository: panelistRepo,
      });

      await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 3,
      });

      // findByDiscussionId should be called before each of the 3 rounds
      expect(callLog).toHaveLength(3);
    });
  });

  // ================================================================
  // Error propagation
  // ================================================================
  describe("error propagation", () => {
    it("propagates an error from DiscussionRepository", async () => {
      const discRepo = new FailingDiscussionRepository("DB connection lost");
      const engine = new DiscussionEngine({
        discussionController: new StubDiscussionController() as unknown as DiscussionController,
        discussionRepository: discRepo as unknown as DiscussionRepository,
        panelistRepository: new StubPanelistRepository([makePanelist()]) as unknown as PanelistRepository,
      });

      await expect(
        engine.runDiscussion({ discussionId: "disc-1", maxRounds: 3 }),
      ).rejects.toThrow("DB connection lost");
    });

    it("propagates an error from PanelistRepository", async () => {
      const panelistRepo = new FailingPanelistRepository("Panelist query failed");
      const engine = new DiscussionEngine({
        discussionController: new StubDiscussionController() as unknown as DiscussionController,
        discussionRepository: new StubDiscussionRepository(makeDiscussion()) as unknown as DiscussionRepository,
        panelistRepository: panelistRepo as unknown as PanelistRepository,
      });

      await expect(
        engine.runDiscussion({ discussionId: "disc-1", maxRounds: 3 }),
      ).rejects.toThrow("Panelist query failed");
    });

    it("propagates an error from DiscussionController", async () => {
      const controller = new FailingDiscussionController("AI generation failed");
      const engine = new DiscussionEngine({
        discussionController: controller as unknown as DiscussionController,
        discussionRepository: new StubDiscussionRepository(makeDiscussion()) as unknown as DiscussionRepository,
        panelistRepository: new StubPanelistRepository([makePanelist()]) as unknown as PanelistRepository,
      });

      await expect(
        engine.runDiscussion({ discussionId: "disc-1", maxRounds: 3 }),
      ).rejects.toThrow("AI generation failed");
    });

    it("does not execute later rounds after an error", async () => {
      const controller = new FailingOnNthCallController(
        2,
        [makeMessage({ id: "r1", content: "Round 1" })],
        "Controller failure on round 2",
      );
      const engine = new DiscussionEngine({
        discussionController: controller as unknown as DiscussionController,
        discussionRepository: new StubDiscussionRepository(makeDiscussion()) as unknown as DiscussionRepository,
        panelistRepository: new StubPanelistRepository([makePanelist()]) as unknown as PanelistRepository,
      });

      await expect(
        engine.runDiscussion({ discussionId: "disc-1", maxRounds: 5 }),
      ).rejects.toThrow("Controller failure on round 2");

      // The controller should have been called at most 2 times (round 1 succeeded, round 2 failed)
      expect(controller.getCallCount()).toBe(2);
    });
  });

  // ================================================================
  // Sequential execution (no parallelism)
  // ================================================================
  describe("sequential execution", () => {
    it("executes rounds sequentially (not in parallel)", async () => {
      const executionOrder: number[] = [];

      const controller = {
        async executeDiscussion(_input: { discussionId: string }): Promise<Message[]> {
          const roundNumber = executionOrder.length + 1;
          executionOrder.push(roundNumber);
          // Small delay to ensure parallelism would be detectable
          await new Promise((resolve) => setTimeout(resolve, 10));
          return [makeMessage({ id: `msg-${roundNumber}`, content: `Round ${roundNumber}` })];
        },
      };

      const engine = new DiscussionEngine({
        discussionController: controller as unknown as DiscussionController,
        discussionRepository: new StubDiscussionRepository(makeDiscussion()) as unknown as DiscussionRepository,
        panelistRepository: new StubPanelistRepository([makePanelist()]) as unknown as PanelistRepository,
      });

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 3,
      });

      // Rounds should execute in order: 1, 2, 3
      expect(executionOrder).toEqual([1, 2, 3]);
      expect(result).toHaveLength(3);
      expect(result[0].content).toBe("Round 1");
      expect(result[1].content).toBe("Round 2");
      expect(result[2].content).toBe("Round 3");
    });
  });

  // ================================================================
  // Empty message array from a round
  // ================================================================
  describe("empty message round", () => {
    it("allows later rounds to proceed after an empty message array", async () => {
      // Round 1 returns empty, Rounds 2 and 3 return messages
      const controller = new StubDiscussionController(
        [], // empty round
        [makeMessage({ id: "r2", content: "Round 2" })],
        [makeMessage({ id: "r3", content: "Round 3" })],
      );
      const { engine } = buildEngine(controller);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 3,
      });

      expect(controller.getCallCount()).toBe(3);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("Round 2");
      expect(result[1].content).toBe("Round 3");
    });

    it("does not stop execution when a round returns zero messages", async () => {
      const controller = new StubDiscussionController(
        [], // Round 1: empty
        [makeMessage({ id: "r2a", content: "Only round 2" })],
      );
      const { engine } = buildEngine(controller);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 2,
      });

      expect(controller.getCallCount()).toBe(2);
      expect(result).toHaveLength(1);
    });
  });

  // ================================================================
  // Discussion not found
  // ================================================================
  describe("discussion not found", () => {
    it("throws when the discussion does not exist", async () => {
      const discRepo: DiscussionRepository = {
        create: async () => {
          throw new Error("not implemented");
        },
        findAll: async () => {
          throw new Error("not implemented");
        },
        findById: async (_id: string) => null,
        updateStatus: async (_id: string, _status: DiscussionStatus) => {
          throw new Error("not implemented");
        },
      };

      const engine = new DiscussionEngine({
        discussionController: new StubDiscussionController() as unknown as DiscussionController,
        discussionRepository: discRepo,
        panelistRepository: new StubPanelistRepository([makePanelist()]) as unknown as PanelistRepository,
      });

      await expect(
        engine.runDiscussion({ discussionId: "missing-disc", maxRounds: 3 }),
      ).rejects.toThrow("Discussion not found");
    });
  });

  // ================================================================
  // Reaching maxRounds does not mutate discussion status
  // ================================================================
  describe("maxRounds is not a status transition", () => {
    it("does not mutate the discussion when maxRounds is reached", async () => {
      const discussion = makeDiscussion({ status: "active" });
      const discRepo = new StubDiscussionRepository(discussion);
      const controller = new StubDiscussionController(
        [makeMessage()],
        [makeMessage()],
        [makeMessage()],
      );
      const { engine } = buildEngine(controller, discRepo);

      const result = await engine.runDiscussion({
        discussionId: "disc-1",
        maxRounds: 3,
      });

      // The discussion returned by findById after execution should still be "active"
      const afterDiscussion = await discRepo.findById("disc-1");
      expect(afterDiscussion?.status).toBe("active");
      expect(result).toHaveLength(3);
    });
  });
});
