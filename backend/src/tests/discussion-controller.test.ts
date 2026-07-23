import { describe, it, expect, vi } from "vitest";
import { DiscussionController } from "../controllers/DiscussionController.js";
import { RoundController } from "../controllers/RoundController.js";
import { InMemoryDiscussionRepository } from "../repositories/InMemoryDiscussionRepository.js";
import { InMemoryMessageRepository } from "../repositories/InMemoryMessageRepository.js";
import { InMemoryPanelistRepository } from "../repositories/InMemoryPanelistRepository.js";
import { MockAIService } from "../ai/MockAIService.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { AIService } from "../ai/AIService.js";
import { Discussion } from "../domain/discussion.js";
import { Panelist, CreatePanelistInput } from "../domain/panelist.js";
import { Message } from "../domain/message.js";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Create a discussion in the repository and return it. */
async function seedDiscussion(
  repo: DiscussionRepository,
  title = "The future of renewable energy",
): Promise<Discussion> {
  return repo.create({ title });
}

/** Create a panelist in the repository and return it. */
async function seedPanelist(
  repo: PanelistRepository,
  overrides: Partial<CreatePanelistInput> = {},
): Promise<Panelist> {
  return repo.create({
    discussionId: "will-be-overridden",
    role: "expert",
    name: "Dr. Li Wei",
    occupation: "Energy Economist",
    title: "Chief Economist at GreenFuture Institute",
    stance: "Market-based carbon pricing is the most efficient path to net-zero",
    color: "#4A90D9",
    ...overrides,
  });
}

interface DiscussionControllerKit {
  discussionController: DiscussionController;
  discussionRepo: InMemoryDiscussionRepository;
  messageRepo: InMemoryMessageRepository;
  panelistRepo: InMemoryPanelistRepository;
  aiService: MockAIService;
  roundController: RoundController;
}

/** Build a DiscussionController with a real RoundController and in-memory deps. */
function buildDiscussionController(
  aiContent?: string,
): DiscussionControllerKit {
  const discussionRepo = new InMemoryDiscussionRepository();
  const messageRepo = new InMemoryMessageRepository();
  const panelistRepo = new InMemoryPanelistRepository();
  const aiService = new MockAIService(
    aiContent !== undefined ? { content: aiContent } : {},
  );

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

  return {
    discussionController,
    discussionRepo,
    messageRepo,
    panelistRepo,
    aiService,
    roundController,
  };
}

// ------------------------------------------------------------------
// Test doubles
// ------------------------------------------------------------------

/** Input captured by SpyRoundController for each executeTurn call. */
interface SpyCall {
  discussionId: string;
  panelistId: string;
}

/**
 * A RoundController that records every executeTurn call and delegates
 * to a real RoundController for actual execution.
 */
class SpyRoundController {
  private readonly real: RoundController;
  private readonly calls: SpyCall[] = [];

  constructor(real: RoundController) {
    this.real = real;
  }

  async executeTurn(input: {
    discussionId: string;
    panelistId: string;
  }): Promise<Message> {
    this.calls.push({ ...input });
    return this.real.executeTurn(input);
  }

  getCalls(): readonly SpyCall[] {
    return this.calls;
  }

  /** Return the underlying real RoundController. */
  getReal(): RoundController {
    return this.real;
  }
}

/**
 * A RoundController stub whose executeTurn() always throws.
 */
class FailingRoundController {
  private readonly errorMessage: string;
  callCount = 0;

  constructor(errorMessage = "RoundController failure") {
    this.errorMessage = errorMessage;
  }

  async executeTurn(_input: {
    discussionId: string;
    panelistId: string;
  }): Promise<Message> {
    this.callCount++;
    throw new Error(this.errorMessage);
  }
}

/**
 * A RoundController stub that throws on the N-th call (1-indexed).
 * Earlier calls return a synthetic Message.
 */
class FailingOnNthCallRoundController {
  private callCount = 0;

  constructor(
    private readonly failOnCall: number,
    private readonly errorMessage = "RoundController failure on Nth call",
  ) {}

  async executeTurn(input: {
    discussionId: string;
    panelistId: string;
  }): Promise<Message> {
    this.callCount++;
    if (this.callCount >= this.failOnCall) {
      throw new Error(this.errorMessage);
    }
    return {
      id: `msg-${input.panelistId}`,
      discussionId: input.discussionId,
      panelistId: null,
      role: "assistant",
      kind: null,
      content: `Response from ${input.panelistId}`,
      replyToMessageId: null,
      createdAt: new Date().toISOString(),
    };
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("DiscussionController", () => {
  // ----------------------------------------------------------------
  // Single panelist
  // ----------------------------------------------------------------
  describe("single panelist", () => {
    it("returns one Message for a discussion with one active panelist", async () => {
      const { discussionController, discussionRepo, panelistRepo } =
        buildDiscussionController("Solar is the future.");
      const discussion = await seedDiscussion(discussionRepo);
      await seedPanelist(panelistRepo, { discussionId: discussion.id });

      const messages = await discussionController.executeDiscussion({
        discussionId: discussion.id,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].discussionId).toBe(discussion.id);
      expect(messages[0].content).toBe("Solar is the future.");
    });

    it("returns a Message with a valid id", async () => {
      const { discussionController, discussionRepo, panelistRepo } =
        buildDiscussionController();
      const discussion = await seedDiscussion(discussionRepo);
      await seedPanelist(panelistRepo, { discussionId: discussion.id });

      const messages = await discussionController.executeDiscussion({
        discussionId: discussion.id,
      });

      expect(messages[0]).toHaveProperty("id");
      expect(typeof messages[0].id).toBe("string");
      expect(messages[0].id.length).toBeGreaterThan(0);
    });
  });

  // ----------------------------------------------------------------
  // Multiple panelists
  // ----------------------------------------------------------------
  describe("multiple panelists", () => {
    it("returns one Message per active panelist", async () => {
      const { discussionController, discussionRepo, panelistRepo } =
        buildDiscussionController();
      const discussion = await seedDiscussion(discussionRepo);
      await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Expert A",
      });
      await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Expert B",
      });
      await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Expert C",
      });

      const messages = await discussionController.executeDiscussion({
        discussionId: discussion.id,
      });

      expect(messages).toHaveLength(3);
    });

    it("persists all generated messages", async () => {
      const { discussionController, discussionRepo, panelistRepo, messageRepo } =
        buildDiscussionController();
      const discussion = await seedDiscussion(discussionRepo);
      await seedPanelist(panelistRepo, { discussionId: discussion.id });
      await seedPanelist(panelistRepo, { discussionId: discussion.id });

      await discussionController.executeDiscussion({
        discussionId: discussion.id,
      });

      const saved = await messageRepo.findByDiscussionId(discussion.id);
      expect(saved).toHaveLength(2);
    });
  });

  // ----------------------------------------------------------------
  // Preserve repository insertion order
  // ----------------------------------------------------------------
  describe("preserve repository order", () => {
    it("executes panelists in the order returned by the repository", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const messageRepo = new InMemoryMessageRepository();
      const panelistRepo = new InMemoryPanelistRepository();
      const aiService = new MockAIService();

      const realRoundController = new RoundController({
        discussionRepository: discussionRepo,
        messageRepository: messageRepo,
        panelistRepository: panelistRepo,
        aiService,
      });

      const spy = new SpyRoundController(realRoundController);

      const discussionController = new DiscussionController({
        roundController: spy as unknown as RoundController,
        panelistRepository: panelistRepo,
      });

      const discussion = await seedDiscussion(discussionRepo);
      const panelistA = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "A",
      });
      const panelistB = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "B",
      });
      const panelistC = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "C",
      });

      await discussionController.executeDiscussion({
        discussionId: discussion.id,
      });

      const calls = spy.getCalls();
      expect(calls).toHaveLength(3);
      expect(calls[0].panelistId).toBe(panelistA.id);
      expect(calls[1].panelistId).toBe(panelistB.id);
      expect(calls[2].panelistId).toBe(panelistC.id);
    });
  });

  // ----------------------------------------------------------------
  // Skip finished panelists
  // ----------------------------------------------------------------
  describe("skip finished panelists", () => {
    it("does not call executeTurn for a finished panelist", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const messageRepo = new InMemoryMessageRepository();
      const panelistRepo = new InMemoryPanelistRepository();
      const aiService = new MockAIService();

      const realRoundController = new RoundController({
        discussionRepository: discussionRepo,
        messageRepository: messageRepo,
        panelistRepository: panelistRepo,
        aiService,
      });

      const spy = new SpyRoundController(realRoundController);

      const discussionController = new DiscussionController({
        roundController: spy as unknown as RoundController,
        panelistRepository: panelistRepo,
      });

      const discussion = await seedDiscussion(discussionRepo);

      // Create an active panelist
      const activePanelist = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Active Expert",
      });

      // Create a finished panelist — we need to manipulate the repo data
      // since InMemoryPanelistRepository always creates with status "waiting".
      // We create a panelist then find it and check… actually we can't mutate
      // the in-memory repo's internal array directly. Let's use a different
      // approach: create a custom repo that returns a finished panelist.
      const finishedPanelist = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Finished Expert",
      });

      // Replace the finished panelist's status by creating a stub repo
      const panelists = await panelistRepo.findByDiscussionId(discussion.id);

      // Create a stub that returns the finished panelist
      const stubRepo: PanelistRepository = {
        create: (input) => panelistRepo.create(input),
        findById: (id) => panelistRepo.findById(id),
        findByDiscussionId: async (_discussionId) => {
          // Return panelists with the second one marked as finished
          return panelists.map((p) =>
            p.id === finishedPanelist.id ? { ...p, status: "finished" as const } : p,
          );
        },
        update: async (_id, _changes) => {
          throw new Error("update not implemented in stub");
        },
      };

      const controllerWithStub = new DiscussionController({
        roundController: spy as unknown as RoundController,
        panelistRepository: stubRepo,
      });

      await controllerWithStub.executeDiscussion({
        discussionId: discussion.id,
      });

      const calls = spy.getCalls();
      // Only the active panelist should have been called
      expect(calls).toHaveLength(1);
      expect(calls[0].panelistId).toBe(activePanelist.id);

      // Verify the finished panelist was never called
      const finishedCall = calls.find(
        (c) => c.panelistId === finishedPanelist.id,
      );
      expect(finishedCall).toBeUndefined();
    });

    it("returns messages only from active panelists", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const messageRepo = new InMemoryMessageRepository();
      const panelistRepo = new InMemoryPanelistRepository();
      const aiService = new MockAIService({ content: "Active response" });

      const roundController = new RoundController({
        discussionRepository: discussionRepo,
        messageRepository: messageRepo,
        panelistRepository: panelistRepo,
        aiService,
      });

      const discussion = await seedDiscussion(discussionRepo);
      const activePanelist = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Active",
      });
      const finishedPanelist = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Finished",
      });

      const panelists = await panelistRepo.findByDiscussionId(discussion.id);
      const stubRepo: PanelistRepository = {
        create: (input) => panelistRepo.create(input),
        findById: (id) => panelistRepo.findById(id),
        findByDiscussionId: async () =>
          panelists.map((p) =>
            p.id === finishedPanelist.id
              ? { ...p, status: "finished" as const }
              : p,
          ),
        update: async () => { throw new Error("not implemented"); },
      };

      const discussionController = new DiscussionController({
        roundController,
        panelistRepository: stubRepo,
      });

      const messages = await discussionController.executeDiscussion({
        discussionId: discussion.id,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].discussionId).toBe(discussion.id);
      expect(messages[0].role).toBe("assistant");
    });
  });

  // ----------------------------------------------------------------
  // Returns created Messages in correct order
  // ----------------------------------------------------------------
  describe("message order", () => {
    it("returns Messages in the same order panelists were executed", async () => {
      const { discussionController, discussionRepo, panelistRepo } =
        buildDiscussionController();
      const discussion = await seedDiscussion(discussionRepo);

      // Create panelists with different content so we can track order
      // We need distinct AI responses per panelist — use a custom AIService
      const discussionRepo2 = new InMemoryDiscussionRepository();
      const messageRepo2 = new InMemoryMessageRepository();
      const panelistRepo2 = new InMemoryPanelistRepository();

      let callIndex = 0;
      const responses = ["First response", "Second response", "Third response"];

      const sequencedAI: AIService = {
        async generate(_request) {
          const content = responses[callIndex] ?? "default";
          callIndex++;
          return { content, model: "test" };
        },
      };

      const roundController = new RoundController({
        discussionRepository: discussionRepo2,
        messageRepository: messageRepo2,
        panelistRepository: panelistRepo2,
        aiService: sequencedAI,
      });

      const dc = new DiscussionController({
        roundController,
        panelistRepository: panelistRepo2,
      });

      const disc = await seedDiscussion(discussionRepo2);
      await seedPanelist(panelistRepo2, {
        discussionId: disc.id,
        name: "A",
      });
      await seedPanelist(panelistRepo2, {
        discussionId: disc.id,
        name: "B",
      });
      await seedPanelist(panelistRepo2, {
        discussionId: disc.id,
        name: "C",
      });

      const messages = await dc.executeDiscussion({ discussionId: disc.id });

      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe("First response");
      expect(messages[1].content).toBe("Second response");
      expect(messages[2].content).toBe("Third response");
    });
  });

  // ----------------------------------------------------------------
  // RoundController called exactly once per active panelist
  // ----------------------------------------------------------------
  describe("call count per active panelist", () => {
    it("calls RoundController.executeTurn exactly once per active panelist", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const messageRepo = new InMemoryMessageRepository();
      const panelistRepo = new InMemoryPanelistRepository();
      const aiService = new MockAIService();

      const realRoundController = new RoundController({
        discussionRepository: discussionRepo,
        messageRepository: messageRepo,
        panelistRepository: panelistRepo,
        aiService,
      });

      const spy = new SpyRoundController(realRoundController);

      const discussionController = new DiscussionController({
        roundController: spy as unknown as RoundController,
        panelistRepository: panelistRepo,
      });

      const discussion = await seedDiscussion(discussionRepo);
      const p1 = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "P1",
      });
      const p2 = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "P2",
      });
      const p3 = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "P3",
      });

      await discussionController.executeDiscussion({
        discussionId: discussion.id,
      });

      const calls = spy.getCalls();
      expect(calls).toHaveLength(3);

      // Each panelist was called exactly once
      const panelistIds = [p1.id, p2.id, p3.id];
      for (const pid of panelistIds) {
        const callsForPanelist = calls.filter((c) => c.panelistId === pid);
        expect(callsForPanelist).toHaveLength(1);
        expect(callsForPanelist[0].discussionId).toBe(discussion.id);
      }
    });
  });

  // ----------------------------------------------------------------
  // No call for finished panelists
  // ----------------------------------------------------------------
  describe("no call for finished panelists", () => {
    it("never calls executeTurn with a finished panelist id", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const messageRepo = new InMemoryMessageRepository();
      const panelistRepo = new InMemoryPanelistRepository();
      const aiService = new MockAIService();

      const realRoundController = new RoundController({
        discussionRepository: discussionRepo,
        messageRepository: messageRepo,
        panelistRepository: panelistRepo,
        aiService,
      });

      const spy = new SpyRoundController(realRoundController);

      const discussion = await seedDiscussion(discussionRepo);
      const pActive = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Active",
      });
      const pFinished = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "WillBeFinished",
      });

      const panelists = await panelistRepo.findByDiscussionId(discussion.id);
      const stubRepo: PanelistRepository = {
        create: (input) => panelistRepo.create(input),
        findById: (id) => panelistRepo.findById(id),
        findByDiscussionId: async () =>
          panelists.map((p) =>
            p.id === pFinished.id
              ? { ...p, status: "finished" as const }
              : p,
          ),
        update: async () => { throw new Error("not implemented"); },
      };

      const discussionController = new DiscussionController({
        roundController: spy as unknown as RoundController,
        panelistRepository: stubRepo,
      });

      await discussionController.executeDiscussion({
        discussionId: discussion.id,
      });

      const calls = spy.getCalls();
      const finishedCall = calls.find((c) => c.panelistId === pFinished.id);
      expect(finishedCall).toBeUndefined();

      // The active panelist was still called
      const activeCall = calls.find((c) => c.panelistId === pActive.id);
      expect(activeCall).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // Empty discussion returns []
  // ----------------------------------------------------------------
  describe("empty discussion", () => {
    it("returns an empty array when the discussion has no panelists", async () => {
      const { discussionController, discussionRepo } =
        buildDiscussionController();
      const discussion = await seedDiscussion(discussionRepo);

      const messages = await discussionController.executeDiscussion({
        discussionId: discussion.id,
      });

      expect(messages).toEqual([]);
    });

    it("returns an empty array when all panelists are finished", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const messageRepo = new InMemoryMessageRepository();
      const panelistRepo = new InMemoryPanelistRepository();
      const aiService = new MockAIService();

      const roundController = new RoundController({
        discussionRepository: discussionRepo,
        messageRepository: messageRepo,
        panelistRepository: panelistRepo,
        aiService,
      });

      const discussion = await seedDiscussion(discussionRepo);
      await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Finished A",
      });
      await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Finished B",
      });

      const panelists = await panelistRepo.findByDiscussionId(discussion.id);
      const stubRepo: PanelistRepository = {
        create: (input) => panelistRepo.create(input),
        findById: (id) => panelistRepo.findById(id),
        findByDiscussionId: async () =>
          panelists.map((p) => ({ ...p, status: "finished" as const })),
        update: async () => { throw new Error("not implemented"); },
      };

      const discussionController = new DiscussionController({
        roundController,
        panelistRepository: stubRepo,
      });

      const messages = await discussionController.executeDiscussion({
        discussionId: discussion.id,
      });

      expect(messages).toEqual([]);
    });
  });

  // ----------------------------------------------------------------
  // RoundController error propagates
  // ----------------------------------------------------------------
  describe("error propagation", () => {
    it("propagates RoundController errors unchanged", async () => {
      const panelistRepo = new InMemoryPanelistRepository();
      const failingRC = new FailingRoundController("AI service failure");

      const discussionController = new DiscussionController({
        roundController: failingRC as unknown as RoundController,
        panelistRepository: panelistRepo,
      });

      const discussionRepo = new InMemoryDiscussionRepository();
      const discussion = await seedDiscussion(discussionRepo);
      await seedPanelist(panelistRepo, { discussionId: discussion.id });

      await expect(
        discussionController.executeDiscussion({
          discussionId: discussion.id,
        }),
      ).rejects.toThrow("AI service failure");
    });

    it("does not catch or wrap the error", async () => {
      const panelistRepo = new InMemoryPanelistRepository();
      const failingRC = new FailingRoundController("Specific error text");

      const discussionController = new DiscussionController({
        roundController: failingRC as unknown as RoundController,
        panelistRepository: panelistRepo,
      });

      const discussionRepo = new InMemoryDiscussionRepository();
      const discussion = await seedDiscussion(discussionRepo);
      await seedPanelist(panelistRepo, { discussionId: discussion.id });

      let caught: Error | null = null;
      try {
        await discussionController.executeDiscussion({
          discussionId: discussion.id,
        });
      } catch (e) {
        caught = e as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toBe("Specific error text");
      // The error should not be wrapped — same message, no prefix added
      expect(caught!.message).not.toContain("DiscussionController");
    });
  });

  // ----------------------------------------------------------------
  // Execution stops after first failure
  // ----------------------------------------------------------------
  describe("stop on first failure", () => {
    it("stops executing after the first RoundController error", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const panelistRepo = new InMemoryPanelistRepository();

      const discussion = await seedDiscussion(discussionRepo);
      await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "First",
      });
      await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Second",
      });
      await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Third",
      });

      // Fails on the 2nd call (1-indexed)
      const failingRC = new FailingOnNthCallRoundController(
        2,
        "RoundController failure on Nth call",
      );

      const discussionController = new DiscussionController({
        roundController: failingRC as unknown as RoundController,
        panelistRepository: panelistRepo,
      });

      await expect(
        discussionController.executeDiscussion({
          discussionId: discussion.id,
        }),
      ).rejects.toThrow("RoundController failure on Nth call");

      // Only the first call succeeded, the second failed, and execution stopped
      expect(failingRC.getCallCount()).toBe(2);
    });

    it("does not call later panelists after a failure", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const panelistRepo = new InMemoryPanelistRepository();

      const discussion = await seedDiscussion(discussionRepo);
      const p1 = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "P1",
      });
      const p2 = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "P2",
      });
      const p3 = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "P3",
      });

      // This stub records panelistIds that were called before throwing
      const calledPanelistIds: string[] = [];
      const recordAndFailRC = {
        async executeTurn(input: { discussionId: string; panelistId: string }) {
          calledPanelistIds.push(input.panelistId);
          if (calledPanelistIds.length >= 2) {
            throw new Error("Failure on second call");
          }
          return {
            id: `msg-${input.panelistId}`,
            discussionId: input.discussionId,
            panelistId: null,
            role: "assistant" as const,
            kind: null,
            content: `Response from ${input.panelistId}`,
            replyToMessageId: null,
            createdAt: new Date().toISOString(),
          };
        },
      };

      const discussionController = new DiscussionController({
        roundController: recordAndFailRC as unknown as RoundController,
        panelistRepository: panelistRepo,
      });

      await expect(
        discussionController.executeDiscussion({
          discussionId: discussion.id,
        }),
      ).rejects.toThrow("Failure on second call");

      // P1 called, P2 called (and threw), P3 never called
      expect(calledPanelistIds).toHaveLength(2);
      expect(calledPanelistIds[0]).toBe(p1.id);
      expect(calledPanelistIds[1]).toBe(p2.id);
      // P3 was never reached
      expect(calledPanelistIds).not.toContain(p3.id);
    });
  });
});
