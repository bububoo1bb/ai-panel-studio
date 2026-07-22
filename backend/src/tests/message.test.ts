import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { InMemoryDiscussionRepository } from "../repositories/InMemoryDiscussionRepository.js";
import { InMemoryMessageRepository } from "../repositories/InMemoryMessageRepository.js";
import { Discussion } from "../domain/discussion.js";
import { MessageKind } from "../domain/message.js";

/**
 * Helper: create an isolated Express app backed by fresh in-memory
 * repositories so every test is deterministic and free of shared state.
 */
function createTestApp() {
  const discussionRepo = new InMemoryDiscussionRepository();
  const messageRepo = new InMemoryMessageRepository();
  const app = createApp({
    discussionRepository: discussionRepo,
    messageRepository: messageRepo,
  });
  return { app, discussionRepo };
}

/**
 * Helper: create a discussion via the API and return the parsed entity.
 */
async function createDiscussion(
  app: ReturnType<typeof createTestApp>["app"],
  title = "Test Discussion",
): Promise<Discussion> {
  const res = await request(app)
    .post("/api/discussions")
    .send({ title });
  return res.body as Discussion;
}

describe("Message API", () => {
  // --------------------------------------------------------------------
  // GET /api/discussions/:discussionId/messages
  // --------------------------------------------------------------------
  describe("GET /api/discussions/:discussionId/messages", () => {
    it("returns 200 and an empty array when no messages exist", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app).get(
        `/api/discussions/${discussion.id}/messages`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it("returns 404 when the discussion does not exist", async () => {
      const { app } = createTestApp();

      const response = await request(app).get(
        "/api/discussions/non-existent-id/messages",
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Discussion not found" });
    });

    it("returns previously created messages in insertion order", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "user", content: "First message" });
      await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "assistant", content: "Second message" });

      const response = await request(app).get(
        `/api/discussions/${discussion.id}/messages`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].content).toBe("First message");
      expect(response.body[1].content).toBe("Second message");
    });

    it("isolates messages between different discussions", async () => {
      const { app } = createTestApp();
      const discussionA = await createDiscussion(app, "Discussion A");
      const discussionB = await createDiscussion(app, "Discussion B");

      await request(app)
        .post(`/api/discussions/${discussionA.id}/messages`)
        .send({ role: "user", content: "Message in A" });
      await request(app)
        .post(`/api/discussions/${discussionB.id}/messages`)
        .send({ role: "user", content: "Message in B" });

      const responseA = await request(app).get(
        `/api/discussions/${discussionA.id}/messages`,
      );
      const responseB = await request(app).get(
        `/api/discussions/${discussionB.id}/messages`,
      );

      expect(responseA.status).toBe(200);
      expect(responseA.body).toHaveLength(1);
      expect(responseA.body[0].content).toBe("Message in A");

      expect(responseB.status).toBe(200);
      expect(responseB.body).toHaveLength(1);
      expect(responseB.body[0].content).toBe("Message in B");
    });
  });

  // --------------------------------------------------------------------
  // POST /api/discussions/:discussionId/messages
  // --------------------------------------------------------------------
  describe("POST /api/discussions/:discussionId/messages", () => {
    it("creates a message with valid input and returns 201", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "user", content: "Hello, world!" });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(response.body.discussionId).toBe(discussion.id);
      expect(response.body.role).toBe("user");
      expect(response.body.content).toBe("Hello, world!");
    });

    it("creates a message with assistant role", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "assistant", content: "I am an AI." });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe("assistant");
    });

    it("includes a valid ISO 8601 createdAt timestamp", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "user", content: "Timestamp test" });

      expect(response.status).toBe(201);
      const createdAt: string = response.body.createdAt;
      expect(typeof createdAt).toBe("string");

      // Verify it is parseable and the round-trip produces the same string.
      const parsed = new Date(createdAt);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.toISOString()).toBe(createdAt);
    });

    it("trims leading and trailing whitespace from content", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "user", content: "  Padded content  " });

      expect(response.status).toBe(201);
      expect(response.body.content).toBe("Padded content");
    });

    it("makes the created message appear in the GET list", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const createRes = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "user", content: "Integration check" });

      expect(createRes.status).toBe(201);

      const listRes = await request(app).get(
        `/api/discussions/${discussion.id}/messages`,
      );

      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0]).toEqual(createRes.body);
    });

    // -- Discussion existence validation -------------------------------

    it("returns 404 when the discussion does not exist", async () => {
      const { app } = createTestApp();

      const response = await request(app)
        .post("/api/discussions/non-existent-id/messages")
        .send({ role: "user", content: "Valid content" });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Discussion not found" });
    });

    // -- Validation error cases ----------------------------------------

    it("returns 400 when role is missing from the body", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ content: "No role here" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "Role must be user or assistant",
      });
    });

    it("returns 400 when role is not 'user' or 'assistant'", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "moderator", content: "Invalid role" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "Role must be user or assistant",
      });
    });

    it("returns 400 when content is missing from the body", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "user" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Content is required" });
    });

    it("returns 400 when content is an empty string", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "user", content: "" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Content is required" });
    });

    it("returns 400 when content is whitespace only", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "user", content: "   " });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Content is required" });
    });

    it("returns 400 when content is not a string", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({ role: "user", content: 123 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Content is required" });
    });

    it("returns 400 when both role and content are invalid", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send({});

      expect(response.status).toBe(400);
      // Role validation runs first
      expect(response.body).toEqual({
        error: "Role must be user or assistant",
      });
    });

    it("returns 400 when no request body is supplied", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/messages`)
        .send();

      expect(response.status).toBe(400);
      // Role validation runs first — missing body means role is undefined
      expect(response.body).toEqual({
        error: "Role must be user or assistant",
      });
    });
  });

  // --------------------------------------------------------------------
  // New Message fields — repository-level tests
  //
  // panelistId, kind, and replyToMessageId are service-generated trusted
  // metadata.  The HTTP POST route does NOT accept them (unchanged).
  // These tests exercise the repository directly.
  // --------------------------------------------------------------------
  describe("new Message fields (repository)", () => {
    const discussionId = "d0f1e4e0-19b4-4b1e-8a4c-3f2d9b6a7c8e";

    it("preserves panelistId when provided", async () => {
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "assistant",
        content: "Test",
        panelistId: "panelist-1",
      });
      expect(msg.panelistId).toBe("panelist-1");
    });

    it("preserves kind when provided", async () => {
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "assistant",
        content: "Test",
        kind: "expert_statement",
      });
      expect(msg.kind).toBe("expert_statement");
    });

    it("preserves replyToMessageId when provided", async () => {
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "assistant",
        content: "Test",
        replyToMessageId: "msg-target-1",
      });
      expect(msg.replyToMessageId).toBe("msg-target-1");
    });

    it("defaults omitted panelistId to null", async () => {
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "user",
        content: "No panelistId",
      });
      expect(msg.panelistId).toBeNull();
    });

    it("defaults omitted kind to null", async () => {
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "user",
        content: "No kind",
      });
      expect(msg.kind).toBeNull();
    });

    it("defaults omitted replyToMessageId to null", async () => {
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "user",
        content: "No replyToMessageId",
      });
      expect(msg.replyToMessageId).toBeNull();
    });

    it("preserves explicit null for panelistId", async () => {
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "assistant",
        content: "Test",
        panelistId: null,
      });
      expect(msg.panelistId).toBeNull();
    });

    it("preserves explicit null for kind", async () => {
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "assistant",
        content: "Test",
        kind: null,
      });
      expect(msg.kind).toBeNull();
    });

    it("preserves explicit null for replyToMessageId", async () => {
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "assistant",
        content: "Test",
        replyToMessageId: null,
      });
      expect(msg.replyToMessageId).toBeNull();
    });

    it("findByDiscussionId returns all three new fields", async () => {
      const repo = new InMemoryMessageRepository();
      await repo.create({
        discussionId,
        role: "assistant",
        content: "With metadata",
        panelistId: "p-1",
        kind: "expert_statement",
        replyToMessageId: "m-1",
      });

      const messages = await repo.findByDiscussionId(discussionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].panelistId).toBe("p-1");
      expect(messages[0].kind).toBe("expert_statement");
      expect(messages[0].replyToMessageId).toBe("m-1");
    });

    it("insertion ordering is unchanged with new fields", async () => {
      const repo = new InMemoryMessageRepository();
      const msg1 = await repo.create({
        discussionId,
        role: "user",
        content: "First",
      });
      const msg2 = await repo.create({
        discussionId,
        role: "assistant",
        content: "Second",
        panelistId: "p-2",
        kind: "expert_statement",
      });

      const messages = await repo.findByDiscussionId(discussionId);
      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe(msg1.id);
      expect(messages[1].id).toBe(msg2.id);
    });

    it("discussion isolation is unchanged with new fields", async () => {
      const repo = new InMemoryMessageRepository();
      const otherId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

      await repo.create({
        discussionId,
        role: "user",
        content: "Message A",
        panelistId: "p-a",
      });
      await repo.create({
        discussionId: otherId,
        role: "user",
        content: "Message B",
        panelistId: "p-b",
      });

      const msgsA = await repo.findByDiscussionId(discussionId);
      const msgsB = await repo.findByDiscussionId(otherId);

      expect(msgsA).toHaveLength(1);
      expect(msgsA[0].panelistId).toBe("p-a");
      expect(msgsB).toHaveLength(1);
      expect(msgsB[0].panelistId).toBe("p-b");
    });

    it("UUID and createdAt behavior are unchanged with new fields", async () => {
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "user",
        content: "Timestamp + UUID check",
        panelistId: "p-1",
        kind: "expert_statement",
        replyToMessageId: "m-1",
      });

      // UUID v4 format
      expect(msg.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      // Valid ISO 8601 timestamp
      const parsed = new Date(msg.createdAt);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.toISOString()).toBe(msg.createdAt);
    });

    it("existing message-producing flows receive null defaults", async () => {
      // Simulates the RoundController path: create() without new fields
      const repo = new InMemoryMessageRepository();
      const msg = await repo.create({
        discussionId,
        role: "assistant",
        content: "Generated by AI",
        // panelistId, kind, replyToMessageId intentionally omitted
      });

      expect(msg.panelistId).toBeNull();
      expect(msg.kind).toBeNull();
      expect(msg.replyToMessageId).toBeNull();
      expect(msg.role).toBe("assistant");
      expect(msg.content).toBe("Generated by AI");
    });
  });
});
