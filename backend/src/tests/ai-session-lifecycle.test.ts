import { describe, it, expect, beforeEach } from "vitest";
import { AISessionLifecycle } from "../lifecycle/AISessionLifecycle.js";
import { ModeratorStrategy, ModeratorMessage } from "../moderator/ModeratorStrategy.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { InMemoryMessageRepository } from "../repositories/InMemoryMessageRepository.js";
import { SessionLifecycle } from "../lifecycle/SessionLifecycle.js";
import { Message } from "../domain/message.js";

// ═══════════════════════════════════════════════════════════════
// Test doubles
// ═══════════════════════════════════════════════════════════════

class StubModeratorStrategy implements ModeratorStrategy {
  openCalled = false;
  closeCalled = false;
  openDiscussionId = "";
  closeDiscussionId = "";
  openingMessage: ModeratorMessage = {
    content: "欢迎各位专家。",
    panelistId: "host-1",
    kind: "moderator_opening",
  };
  closingMessage: ModeratorMessage = {
    content: "讨论到此结束。",
    panelistId: "host-1",
    kind: "moderator_closing",
  };

  async openDiscussion(discussionId: string): Promise<ModeratorMessage> {
    this.openCalled = true;
    this.openDiscussionId = discussionId;
    return this.openingMessage;
  }

  async closeDiscussion(discussionId: string): Promise<ModeratorMessage> {
    this.closeCalled = true;
    this.closeDiscussionId = discussionId;
    return this.closingMessage;
  }
}

class FailingModeratorStrategy implements ModeratorStrategy {
  async openDiscussion(_discussionId: string): Promise<ModeratorMessage> {
    throw new Error("AI service unavailable");
  }

  async closeDiscussion(_discussionId: string): Promise<ModeratorMessage> {
    throw new Error("AI service unavailable");
  }
}

// ═══════════════════════════════════════════════════════════════
// AISessionLifecycle
// ═══════════════════════════════════════════════════════════════

describe("AISessionLifecycle", () => {
  let lifecycle: SessionLifecycle;
  let moderator: StubModeratorStrategy;
  let messageRepo: MessageRepository;

  beforeEach(() => {
    moderator = new StubModeratorStrategy();
    messageRepo = new InMemoryMessageRepository();
    lifecycle = new AISessionLifecycle({
      moderator,
      messageRepository: messageRepo,
    });
  });

  // ── onSessionStart ──────────────────────────────────────────

  describe("onSessionStart", () => {
    it("delegates to moderator.openDiscussion()", async () => {
      await lifecycle.onSessionStart({ discussionId: "disc-1" });

      expect(moderator.openCalled).toBe(true);
      expect(moderator.openDiscussionId).toBe("disc-1");
    });

    it("persists the generated message via MessageRepository", async () => {
      await lifecycle.onSessionStart({ discussionId: "disc-1" });

      const messages = await messageRepo.findByDiscussionId("disc-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("欢迎各位专家。");
      expect(messages[0].kind).toBe("moderator_opening");
      expect(messages[0].panelistId).toBe("host-1");
    });

    it("returns the persisted Message wrapped in an array", async () => {
      const result = await lifecycle.onSessionStart({ discussionId: "disc-1" });

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty("id");
      expect(result[0].content).toBe("欢迎各位专家。");
      expect(result[0].kind).toBe("moderator_opening");
      expect(result[0].panelistId).toBe("host-1");
      expect(result[0].discussionId).toBe("disc-1");
    });

    it("does NOT call moderator.closeDiscussion()", async () => {
      await lifecycle.onSessionStart({ discussionId: "disc-1" });

      expect(moderator.closeCalled).toBe(false);
    });
  });

  // ── onSessionEnd ────────────────────────────────────────────

  describe("onSessionEnd", () => {
    it("delegates to moderator.closeDiscussion()", async () => {
      await lifecycle.onSessionEnd({ discussionId: "disc-1" });

      expect(moderator.closeCalled).toBe(true);
      expect(moderator.closeDiscussionId).toBe("disc-1");
    });

    it("persists the generated message via MessageRepository", async () => {
      await lifecycle.onSessionEnd({ discussionId: "disc-1" });

      const messages = await messageRepo.findByDiscussionId("disc-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("讨论到此结束。");
      expect(messages[0].kind).toBe("moderator_closing");
    });

    it("returns the persisted Message wrapped in an array", async () => {
      const result = await lifecycle.onSessionEnd({ discussionId: "disc-1" });

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("讨论到此结束。");
      expect(result[0].kind).toBe("moderator_closing");
    });

    it("does NOT call moderator.openDiscussion()", async () => {
      await lifecycle.onSessionEnd({ discussionId: "disc-1" });

      expect(moderator.openCalled).toBe(false);
    });
  });

  // ── Error propagation ───────────────────────────────────────

  describe("error propagation", () => {
    it("propagates error from moderator.openDiscussion()", async () => {
      const failing = new AISessionLifecycle({
        moderator: new FailingModeratorStrategy(),
        messageRepository: new InMemoryMessageRepository(),
      });

      await expect(
        failing.onSessionStart({ discussionId: "disc-1" }),
      ).rejects.toThrow("AI service unavailable");
    });

    it("propagates error from moderator.closeDiscussion()", async () => {
      const failing = new AISessionLifecycle({
        moderator: new FailingModeratorStrategy(),
        messageRepository: new InMemoryMessageRepository(),
      });

      await expect(
        failing.onSessionEnd({ discussionId: "disc-1" }),
      ).rejects.toThrow("AI service unavailable");
    });
  });

  // ── Dependency isolation ────────────────────────────────────

  describe("dependency isolation", () => {
    it("does not directly depend on AIService", () => {
      // AISessionLifecycle constructor only takes moderator + messageRepository.
      // There is no AIService parameter.
      const instance = new AISessionLifecycle({
        moderator: new StubModeratorStrategy(),
        messageRepository: new InMemoryMessageRepository(),
      });
      // TypeScript validates this — if AISessionLifecycle required AIService,
      // this test file wouldn't compile.
      expect(instance).toBeDefined();
    });
  });
});
