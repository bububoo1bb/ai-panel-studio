import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { InMemoryDiscussionRepository } from "../repositories/InMemoryDiscussionRepository.js";

/**
 * Helper: create an isolated Express app backed by a fresh in-memory
 * repository so every test is deterministic and free of shared state.
 */
function createTestApp() {
  return createApp(new InMemoryDiscussionRepository());
}

describe("Discussion API", () => {
  // --------------------------------------------------------------------
  // GET /api/discussions
  // --------------------------------------------------------------------
  describe("GET /api/discussions", () => {
    it("returns 200 and an empty array when no discussions exist", async () => {
      const app = createTestApp();
      const response = await request(app).get("/api/discussions");

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it("returns previously created discussions in insertion order", async () => {
      const app = createTestApp();

      await request(app)
        .post("/api/discussions")
        .send({ title: "First" });
      await request(app)
        .post("/api/discussions")
        .send({ title: "Second" });

      const response = await request(app).get("/api/discussions");

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].title).toBe("First");
      expect(response.body[1].title).toBe("Second");
    });
  });

  // --------------------------------------------------------------------
  // POST /api/discussions
  // --------------------------------------------------------------------
  describe("POST /api/discussions", () => {
    it("creates a discussion with a valid title and returns 201", async () => {
      const app = createTestApp();
      const response = await request(app)
        .post("/api/discussions")
        .send({ title: "My First Discussion" });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(typeof response.body.id).toBe("string");
      expect(response.body.id.length).toBeGreaterThan(0);
      expect(response.body.title).toBe("My First Discussion");
    });

    it("includes a valid ISO 8601 createdAt timestamp", async () => {
      const app = createTestApp();
      const response = await request(app)
        .post("/api/discussions")
        .send({ title: "Timestamp Test" });

      expect(response.status).toBe(201);
      const createdAt: string = response.body.createdAt;
      expect(typeof createdAt).toBe("string");

      // Verify it is parseable and the round-trip produces the same string.
      const parsed = new Date(createdAt);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.toISOString()).toBe(createdAt);
    });

    it("trims leading and trailing whitespace from the title", async () => {
      const app = createTestApp();
      const response = await request(app)
        .post("/api/discussions")
        .send({ title: "  Padded Title  " });

      expect(response.status).toBe(201);
      expect(response.body.title).toBe("Padded Title");
    });

    it("makes the created discussion appear in the GET list", async () => {
      const app = createTestApp();

      const createRes = await request(app)
        .post("/api/discussions")
        .send({ title: "Integration Check" });

      expect(createRes.status).toBe(201);

      const listRes = await request(app).get("/api/discussions");

      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0]).toEqual(createRes.body);
    });

    // -- Validation error cases ----------------------------------------

    it("returns 400 when title is missing from the body", async () => {
      const app = createTestApp();
      const response = await request(app)
        .post("/api/discussions")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Title is required" });
    });

    it("returns 400 when title is an empty string", async () => {
      const app = createTestApp();
      const response = await request(app)
        .post("/api/discussions")
        .send({ title: "" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Title is required" });
    });

    it("returns 400 when title is whitespace only", async () => {
      const app = createTestApp();
      const response = await request(app)
        .post("/api/discussions")
        .send({ title: "   " });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Title is required" });
    });

    it("returns 400 when title is not a string", async () => {
      const app = createTestApp();
      const response = await request(app)
        .post("/api/discussions")
        .send({ title: 123 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Title is required" });
    });
  });
});
