import { describe, it, expect } from "vitest";
import { RoundController } from "../controllers/RoundController.js";
import { InMemoryDiscussionRepository } from "../repositories/InMemoryDiscussionRepository.js";
import { InMemoryMessageRepository } from "../repositories/InMemoryMessageRepository.js";
import { InMemoryPanelistRepository } from "../repositories/InMemoryPanelistRepository.js";
import { MockAIService } from "../ai/MockAIService.js";
import { AIService } from "../ai/AIService.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { GenerateAIRequest, GenerateAIResponse } from "../ai/types.js";
import { Discussion } from "../domain/discussion.js";
import { Panelist, CreatePanelistInput } from "../domain/panelist.js";
import { Message, CreateMessageInput } from "../domain/message.js";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Create a discussion in the repository and return it. */
async function seedDiscussion(
  repo: InMemoryDiscussionRepository,
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

/** Create a message in the repository and return it. */
async function seedMessage(
  repo: InMemoryMessageRepository,
  overrides: Partial<CreateMessageInput> = {},
): Promise<Message> {
  return repo.create({
    discussionId: "default",
    role: "user",
    content: "Default message",
    ...overrides,
  });
}

interface ControllerKit {
  controller: RoundController;
  discussionRepo: InMemoryDiscussionRepository;
  messageRepo: InMemoryMessageRepository;
  panelistRepo: PanelistRepository;
  aiService: MockAIService;
}

/** Build a fresh controller with isolated in-memory deps and a MockAIService. */
function buildController(aiOverrides: { content?: string; model?: string } = {}): ControllerKit {
  const discussionRepo = new InMemoryDiscussionRepository();
  const messageRepo = new InMemoryMessageRepository();
  const panelistRepo = new InMemoryPanelistRepository();
  const aiService = new MockAIService(aiOverrides);

  const controller = new RoundController({
    discussionRepository: discussionRepo,
    messageRepository: messageRepo,
    panelistRepository: panelistRepo,
    aiService,
  });

  return { controller, discussionRepo, messageRepo, panelistRepo, aiService };
}

/**
 * Build a controller with an overridden panelist repository.
 * Useful for injecting a panelist that the stock InMemoryPanelistRepository
 * cannot produce (e.g. one with status "finished").
 */
function buildControllerWithPanelistRepo(panelistRepo: PanelistRepository): ControllerKit {
  const discussionRepo = new InMemoryDiscussionRepository();
  const messageRepo = new InMemoryMessageRepository();
  const aiService = new MockAIService();

  const controller = new RoundController({
    discussionRepository: discussionRepo,
    messageRepository: messageRepo,
    panelistRepository: panelistRepo,
    aiService,
  });

  return { controller, discussionRepo, messageRepo, panelistRepo, aiService };
}

// ------------------------------------------------------------------
// Failing test doubles (test-only, not for production use)
// ------------------------------------------------------------------

/** An AIService that always throws — used to verify error propagation. */
class FailingAIService implements AIService {
  async generate(_request: GenerateAIRequest): Promise<GenerateAIResponse> {
    throw new Error("AI service failure");
  }
}

/**
 * A MessageRepository that delegates everything to a real repository
 * except create(), which throws. Used to verify error propagation.
 */
class FailingCreateMessageRepository implements MessageRepository {
  constructor(private readonly delegate: MessageRepository) {}

  async create(_input: CreateMessageInput): Promise<Message> {
    throw new Error("Repository failure");
  }

  async findByDiscussionId(discussionId: string): Promise<Message[]> {
    return this.delegate.findByDiscussionId(discussionId);
  }
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("RoundController", () => {
  // ----------------------------------------------------------------
  // Normal flow
  // ----------------------------------------------------------------
  describe("executeTurn (happy path)", () => {
    it("returns a created assistant Message with panelistId and kind populated", async () => {
      const { controller, discussionRepo, panelistRepo } = buildController();
      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      const message = await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      expect(message).toHaveProperty("id");
      expect(message.role).toBe("assistant");
      expect(message.panelistId).toBe(panelist.id);
      expect(message.kind).toBe("expert_statement");
      expect(message.replyToMessageId).toBeNull();
    });

    it("persists the generated AI content", async () => {
      const { controller, discussionRepo, panelistRepo } = buildController({
        content: "From my perspective as an energy economist, carbon pricing creates...",
      });
      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      const message = await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      expect(message.content).toBe(
        "From my perspective as an energy economist, carbon pricing creates...",
      );
    });

    it("associates the message with the correct discussion", async () => {
      const { controller, discussionRepo, panelistRepo } = buildController();
      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      const message = await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      expect(message.discussionId).toBe(discussion.id);
    });

    it("loads and includes existing discussion messages in the AI request", async () => {
      const { controller, discussionRepo, panelistRepo, messageRepo, aiService } =
        buildController();
      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      await seedMessage(messageRepo, {
        discussionId: discussion.id,
        role: "user",
        content: "First question",
      });
      await seedMessage(messageRepo, {
        discussionId: discussion.id,
        role: "assistant",
        content: "First answer",
      });

      await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      const requests = aiService.getRequests();
      expect(requests).toHaveLength(1);

      // The AI messages should include the conversation messages (after system + topic)
      const conversationMessages = requests[0].messages.slice(2);
      expect(conversationMessages).toHaveLength(2);
      expect(conversationMessages[0].content).toBe("First question");
      expect(conversationMessages[1].content).toBe("First answer");
    });

    it("preserves existing message order in the generated AI request", async () => {
      const { controller, discussionRepo, panelistRepo, messageRepo, aiService } =
        buildController();
      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      await seedMessage(messageRepo, { discussionId: discussion.id, role: "user", content: "A" });
      await seedMessage(messageRepo, {
        discussionId: discussion.id,
        role: "assistant",
        content: "B",
      });
      await seedMessage(messageRepo, { discussionId: discussion.id, role: "user", content: "C" });

      await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      const requests = aiService.getRequests();
      const conversationMessages = requests[0].messages.slice(2);
      expect(conversationMessages).toHaveLength(3);
      expect(conversationMessages[0].role).toBe("user");
      expect(conversationMessages[0].content).toBe("A");
      expect(conversationMessages[1].role).toBe("assistant");
      expect(conversationMessages[1].content).toBe("B");
      expect(conversationMessages[2].role).toBe("user");
      expect(conversationMessages[2].content).toBe("C");
    });

    it("includes the discussion topic in the AI request", async () => {
      const { controller, discussionRepo, panelistRepo, aiService } = buildController();
      const discussion = await seedDiscussion(discussionRepo, "The future of renewable energy");
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      const requests = aiService.getRequests();
      expect(requests).toHaveLength(1);

      // The second message (after system) should be the topic
      const topicMessage = requests[0].messages.find(
        (m) => m.role === "user" && m.content.includes("Discussion topic:"),
      );
      expect(topicMessage).toBeDefined();
      expect(topicMessage!.content).toContain("The future of renewable energy");
    });

    it("includes the selected panelist system prompt", async () => {
      const { controller, discussionRepo, panelistRepo, aiService } = buildController();
      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        name: "Dr. Li Wei",
        occupation: "Energy Economist",
        stance: "Market-based carbon pricing is the most efficient path to net-zero",
      });

      await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      const requests = aiService.getRequests();
      const systemMessage = requests[0].messages[0];
      expect(systemMessage.role).toBe("system");
      expect(systemMessage.content).toContain("Dr. Li Wei");
      expect(systemMessage.content).toContain("Energy Economist");
      expect(systemMessage.content).toContain("Market-based carbon pricing");
    });

    it("calls AIService exactly once", async () => {
      const { controller, discussionRepo, panelistRepo, aiService } = buildController();
      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      expect(aiService.getRequests()).toHaveLength(1);
    });

    it("creates exactly one new Message", async () => {
      const { controller, discussionRepo, panelistRepo, messageRepo } = buildController();
      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      // One pre-existing message
      await seedMessage(messageRepo, {
        discussionId: discussion.id,
        role: "user",
        content: "Existing",
      });

      const beforeCount = (await messageRepo.findByDiscussionId(discussion.id)).length;

      await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      const afterCount = (await messageRepo.findByDiscussionId(discussion.id)).length;
      expect(afterCount).toBe(beforeCount + 1);
    });

    it("does not mutate previously stored discussion messages", async () => {
      const { controller, discussionRepo, panelistRepo, messageRepo } = buildController();
      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      const existing = await seedMessage(messageRepo, {
        discussionId: discussion.id,
        role: "user",
        content: "Original content",
      });

      // Deep-clone the existing message before the turn
      const snapshot = JSON.parse(JSON.stringify(existing));

      await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      // Re-fetch the existing message
      const messages = await messageRepo.findByDiscussionId(discussion.id);
      const reloaded = messages.find((m) => m.id === existing.id);

      expect(reloaded).toBeDefined();
      expect(reloaded).toEqual(snapshot);
    });

    it("sets panelistId for host panelists and leaves kind null", async () => {
      const { controller, discussionRepo, panelistRepo } = buildController({
        content: "Welcome everyone to today's discussion.",
      });
      const discussion = await seedDiscussion(discussionRepo);
      const host = await seedPanelist(panelistRepo, {
        discussionId: discussion.id,
        role: "host",
        name: "Moderator Zhang",
        occupation: "Professional Moderator",
        title: "Session Moderator",
        stance: "Neutral facilitator",
      });

      const message = await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: host.id,
      });

      expect(message.panelistId).toBe(host.id);
      expect(message.kind).toBeNull();
    });

    it("returns the exact Message produced by MessageRepository.create()", async () => {
      const { controller, discussionRepo, panelistRepo, messageRepo } = buildController({
        content: "Exact match test",
      });
      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      const returned = await controller.executeTurn({
        discussionId: discussion.id,
        panelistId: panelist.id,
      });

      const messages = await messageRepo.findByDiscussionId(discussion.id);
      const stored = messages.find((m) => m.id === returned.id);

      expect(stored).toBeDefined();
      expect(returned).toEqual(stored);
    });
  });

  // ----------------------------------------------------------------
  // Discussion not found
  // ----------------------------------------------------------------
  describe("discussion not found", () => {
    it("throws 'Discussion not found' when discussion does not exist", async () => {
      const { controller } = buildController();

      await expect(
        controller.executeTurn({
          discussionId: "non-existent-discussion",
          panelistId: "any-panelist",
        }),
      ).rejects.toThrow("Discussion not found");
    });

    it("does not call AIService when discussion does not exist", async () => {
      const { controller, aiService } = buildController();

      await expect(
        controller.executeTurn({
          discussionId: "non-existent-discussion",
          panelistId: "any-panelist",
        }),
      ).rejects.toThrow();

      expect(aiService.getRequests()).toHaveLength(0);
    });

    it("does not create a message when discussion does not exist", async () => {
      const { controller, messageRepo } = buildController();

      const beforeCount = (
        await messageRepo.findByDiscussionId("non-existent-discussion")
      ).length;

      await expect(
        controller.executeTurn({
          discussionId: "non-existent-discussion",
          panelistId: "any-panelist",
        }),
      ).rejects.toThrow();

      const afterCount = (
        await messageRepo.findByDiscussionId("non-existent-discussion")
      ).length;
      expect(afterCount).toBe(beforeCount);
    });
  });

  // ----------------------------------------------------------------
  // Panelist not found
  // ----------------------------------------------------------------
  describe("panelist not found", () => {
    it("throws 'Panelist not found' when panelist does not exist", async () => {
      const { controller, discussionRepo } = buildController();
      const discussion = await seedDiscussion(discussionRepo);

      await expect(
        controller.executeTurn({
          discussionId: discussion.id,
          panelistId: "non-existent-panelist",
        }),
      ).rejects.toThrow("Panelist not found");
    });

    it("does not call AIService when panelist does not exist", async () => {
      const { controller, discussionRepo, aiService } = buildController();
      const discussion = await seedDiscussion(discussionRepo);

      await expect(
        controller.executeTurn({
          discussionId: discussion.id,
          panelistId: "non-existent-panelist",
        }),
      ).rejects.toThrow();

      expect(aiService.getRequests()).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // Panelist-discussion ownership mismatch
  // ----------------------------------------------------------------
  describe("panelist ownership mismatch", () => {
    it("throws 'Panelist does not belong to discussion' for mismatched ownership", async () => {
      const { controller, discussionRepo, panelistRepo } = buildController();
      const discussionA = await seedDiscussion(discussionRepo, "Discussion A");
      const discussionB = await seedDiscussion(discussionRepo, "Discussion B");
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussionA.id });

      await expect(
        controller.executeTurn({
          discussionId: discussionB.id,
          panelistId: panelist.id,
        }),
      ).rejects.toThrow("Panelist does not belong to discussion");
    });

    it("does not call AIService for a mismatched panelist", async () => {
      const { controller, discussionRepo, panelistRepo, aiService } = buildController();
      const discussionA = await seedDiscussion(discussionRepo, "Discussion A");
      const discussionB = await seedDiscussion(discussionRepo, "Discussion B");
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussionA.id });

      await expect(
        controller.executeTurn({
          discussionId: discussionB.id,
          panelistId: panelist.id,
        }),
      ).rejects.toThrow();

      expect(aiService.getRequests()).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // Inactive panelist (status === "finished")
  // ----------------------------------------------------------------
  describe("inactive panelist", () => {
    /**
     * Minimal stub that returns a single pre-configured panelist from findById.
     * Other methods delegate to the real InMemoryPanelistRepository so that
     * seedPanelist etc. still work for setup.
     */
    class FinishedPanelistStubRepository implements PanelistRepository {
      constructor(
        private readonly delegate: InMemoryPanelistRepository,
        private readonly injectedPanelist: Panelist,
      ) {}

      async create(input: CreatePanelistInput): Promise<Panelist> {
        return this.delegate.create(input);
      }

      async findById(id: string): Promise<Panelist | null> {
        if (id === this.injectedPanelist.id) {
          return { ...this.injectedPanelist };
        }
        return this.delegate.findById(id);
      }

      async findByDiscussionId(discussionId: string): Promise<Panelist[]> {
        return this.delegate.findByDiscussionId(discussionId);
      }

      async update(_id: string, _changes: Partial<Pick<Panelist, "status" | "currentFocus" | "publicSummary" | "lastSpokeAt" | "speakCount">>): Promise<Panelist> {
        throw new Error("update not implemented in stub");
      }
    }

    it("throws 'Panelist is not active' for a finished panelist", async () => {
      // Build the controller first so we can use its discussion repo
      const realPanelistRepo = new InMemoryPanelistRepository();

      // We need the discussionRepo to create the discussion before we can
      // build the stub (since the stub needs a real discussion id).
      const discussionRepo = new InMemoryDiscussionRepository();
      const discussion = await seedDiscussion(discussionRepo);

      // Build a finished panelist object directly
      const finishedPanelist: Panelist = {
        id: "panelist-finished-1",
        discussionId: discussion.id,
        role: "expert",
        name: "Dr. Finished",
        occupation: "Economist",
        title: "Retired Economist",
        stance: "Was once optimistic",
        beliefs: null,
        concerns: null,
        argumentStyle: null,
        color: "#999999",
        status: "finished",
        currentFocus: null,
        publicSummary: null,
        createdAt: new Date().toISOString(),
        lastSpokeAt: null,
        speakCount: 0,
      };

      const stubRepo = new FinishedPanelistStubRepository(realPanelistRepo, finishedPanelist);

      // Build controller manually using the same discussionRepo
      const messageRepo = new InMemoryMessageRepository();
      const aiService = new MockAIService();

      const controller = new RoundController({
        discussionRepository: discussionRepo,
        messageRepository: messageRepo,
        panelistRepository: stubRepo,
        aiService,
      });

      await expect(
        controller.executeTurn({
          discussionId: discussion.id,
          panelistId: finishedPanelist.id,
        }),
      ).rejects.toThrow("Panelist is not active");

      // Verify AIService was not called
      expect(aiService.getRequests()).toHaveLength(0);

      // Verify no message was created
      const messages = await messageRepo.findByDiscussionId(discussion.id);
      expect(messages).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // AIService error propagation
  // ----------------------------------------------------------------
  describe("AIService error", () => {
    it("propagates AIService errors unchanged", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const messageRepo = new InMemoryMessageRepository();
      const panelistRepo = new InMemoryPanelistRepository();
      const aiService = new FailingAIService();

      const controller = new RoundController({
        discussionRepository: discussionRepo,
        messageRepository: messageRepo,
        panelistRepository: panelistRepo,
        aiService,
      });

      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      await expect(
        controller.executeTurn({
          discussionId: discussion.id,
          panelistId: panelist.id,
        }),
      ).rejects.toThrow("AI service failure");
    });

    it("does not persist a message when AIService fails", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const messageRepo = new InMemoryMessageRepository();
      const panelistRepo = new InMemoryPanelistRepository();
      const aiService = new FailingAIService();

      const controller = new RoundController({
        discussionRepository: discussionRepo,
        messageRepository: messageRepo,
        panelistRepository: panelistRepo,
        aiService,
      });

      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      const beforeCount = (await messageRepo.findByDiscussionId(discussion.id)).length;

      await expect(
        controller.executeTurn({
          discussionId: discussion.id,
          panelistId: panelist.id,
        }),
      ).rejects.toThrow();

      const afterCount = (await messageRepo.findByDiscussionId(discussion.id)).length;
      expect(afterCount).toBe(beforeCount);
    });
  });

  // ----------------------------------------------------------------
  // MessageRepository error propagation
  // ----------------------------------------------------------------
  describe("MessageRepository error", () => {
    it("propagates MessageRepository errors unchanged", async () => {
      const discussionRepo = new InMemoryDiscussionRepository();
      const realMessageRepo = new InMemoryMessageRepository();
      const messageRepo = new FailingCreateMessageRepository(realMessageRepo);
      const panelistRepo = new InMemoryPanelistRepository();
      const aiService = new MockAIService({ content: "Content that will never be persisted" });

      const controller = new RoundController({
        discussionRepository: discussionRepo,
        messageRepository: messageRepo,
        panelistRepository: panelistRepo,
        aiService,
      });

      const discussion = await seedDiscussion(discussionRepo);
      const panelist = await seedPanelist(panelistRepo, { discussionId: discussion.id });

      await expect(
        controller.executeTurn({
          discussionId: discussion.id,
          panelistId: panelist.id,
        }),
      ).rejects.toThrow("Repository failure");
    });
  });
});
