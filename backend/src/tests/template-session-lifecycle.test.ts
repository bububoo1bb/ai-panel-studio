import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryMessageRepository } from "../repositories/InMemoryMessageRepository.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { TemplateSessionLifecycle } from "../lifecycle/TemplateSessionLifecycle.js";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

describe("TemplateSessionLifecycle", () => {
  let messageRepo: MessageRepository;
  let lifecycle: TemplateSessionLifecycle;

  const discussionId = "d0f1e4e0-19b4-4b1e-8a4c-3f2d9b6a7c8e";

  beforeEach(() => {
    messageRepo = new InMemoryMessageRepository();
    lifecycle = new TemplateSessionLifecycle({ messageRepository: messageRepo });
  });

  // ── onSessionStart ──────────────────────────────────────────

  describe("onSessionStart", () => {
    it("creates a message with role assistant and system_notification kind", async () => {
      const messages = await lifecycle.onSessionStart({ discussionId });
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].kind).toBe("system_notification");
      expect(messages[0].panelistId).toBeNull();
      expect(messages[0].replyToMessageId).toBeNull();
    });

    it("creates a message with non-empty content", async () => {
      const messages = await lifecycle.onSessionStart({ discussionId });
      expect(messages[0].content).toBeTruthy();
      expect(typeof messages[0].content).toBe("string");
      expect(messages[0].content.length).toBeGreaterThan(0);
    });

    it("creates a message with the correct discussionId", async () => {
      const messages = await lifecycle.onSessionStart({ discussionId });
      expect(messages[0].discussionId).toBe(discussionId);
    });

    it("creates a message with a UUID v4 id", async () => {
      const messages = await lifecycle.onSessionStart({ discussionId });
      expect(messages[0].id).toMatch(UUID_V4_RE);
    });

    it("creates a message with a valid ISO 8601 createdAt", async () => {
      const messages = await lifecycle.onSessionStart({ discussionId });
      expect(messages[0].createdAt).toMatch(ISO_8601_RE);
    });

    it("returns exactly one message", async () => {
      const messages = await lifecycle.onSessionStart({ discussionId });
      expect(messages).toHaveLength(1);
    });
  });

  // ── onSessionEnd ────────────────────────────────────────────

  describe("onSessionEnd", () => {
    it("creates a message with role assistant and system_notification kind", async () => {
      const messages = await lifecycle.onSessionEnd({ discussionId });
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].kind).toBe("system_notification");
      expect(messages[0].panelistId).toBeNull();
      expect(messages[0].replyToMessageId).toBeNull();
    });

    it("creates a message with the correct discussionId", async () => {
      const messages = await lifecycle.onSessionEnd({ discussionId });
      expect(messages[0].discussionId).toBe(discussionId);
    });

    it("returns exactly one message", async () => {
      const messages = await lifecycle.onSessionEnd({ discussionId });
      expect(messages).toHaveLength(1);
    });
  });

  // ── Persistence and ordering ─────────────────────────────────

  it("persists start and end messages in insertion order", async () => {
    const startMessages = await lifecycle.onSessionStart({ discussionId });
    const endMessages = await lifecycle.onSessionEnd({ discussionId });

    const allMessages = await messageRepo.findByDiscussionId(discussionId);

    // Both messages appear in the persisted list
    expect(allMessages).toHaveLength(2);

    // Start message appears before end message (insertion order)
    expect(allMessages[0].id).toBe(startMessages[0].id);
    expect(allMessages[1].id).toBe(endMessages[0].id);
  });

  it("isolates messages across discussions", async () => {
    const otherId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    await lifecycle.onSessionStart({ discussionId });
    await lifecycle.onSessionStart({ discussionId: otherId });

    const messages = await messageRepo.findByDiscussionId(discussionId);
    const otherMessages = await messageRepo.findByDiscussionId(otherId);

    expect(messages).toHaveLength(1);
    expect(otherMessages).toHaveLength(1);
    expect(messages[0].discussionId).toBe(discussionId);
    expect(otherMessages[0].discussionId).toBe(otherId);
  });

  it("produces distinct messages on multiple calls to onSessionStart", async () => {
    const first = await lifecycle.onSessionStart({ discussionId });
    const second = await lifecycle.onSessionStart({ discussionId });

    // Each call returns a distinct message with its own id
    expect(first[0].id).not.toBe(second[0].id);

    // Both are persisted
    const all = await messageRepo.findByDiscussionId(discussionId);
    expect(all).toHaveLength(2);

    // Both have valid ISO 8601 timestamps
    expect(first[0].createdAt).toMatch(ISO_8601_RE);
    expect(second[0].createdAt).toMatch(ISO_8601_RE);
  });
});
