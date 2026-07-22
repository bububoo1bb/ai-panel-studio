import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { InMemoryDiscussionRepository } from "../repositories/InMemoryDiscussionRepository.js";
import { InMemoryPanelistRepository } from "../repositories/InMemoryPanelistRepository.js";
import { Discussion } from "../domain/discussion.js";

/**
 * Helper: create an isolated Express app backed by fresh in-memory
 * repositories so every test is deterministic and free of shared state.
 */
function createTestApp() {
  const discussionRepo = new InMemoryDiscussionRepository();
  const panelistRepo = new InMemoryPanelistRepository();
  const app = createApp({
    discussionRepository: discussionRepo,
    panelistRepository: panelistRepo,
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

/** A valid panelist payload for test reuse. */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    role: "expert",
    name: "Dr. Li Wei",
    occupation: "Economist",
    title: "Chief Economist",
    stance: "Market-based solutions are most effective",
    color: "#4A90D9",
    ...overrides,
  };
}

describe("Panelist API", () => {
  // --------------------------------------------------------------------
  // GET /api/discussions/:discussionId/panelists
  // --------------------------------------------------------------------
  describe("GET /api/discussions/:discussionId/panelists", () => {
    it("returns 200 and an empty array when the Discussion exists but has no panelists", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app).get(
        `/api/discussions/${discussion.id}/panelists`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it("returns 404 when the Discussion does not exist", async () => {
      const { app } = createTestApp();

      const response = await request(app).get(
        "/api/discussions/non-existent-id/panelists",
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Discussion not found" });
    });

    it("returns created panelists in insertion order", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ name: "First Expert" }));
      await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ name: "Second Expert" }));

      const response = await request(app).get(
        `/api/discussions/${discussion.id}/panelists`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].name).toBe("First Expert");
      expect(response.body[1].name).toBe("Second Expert");
    });

    it("isolates panelists between different Discussions", async () => {
      const { app } = createTestApp();
      const discussionA = await createDiscussion(app, "Discussion A");
      const discussionB = await createDiscussion(app, "Discussion B");

      await request(app)
        .post(`/api/discussions/${discussionA.id}/panelists`)
        .send(validPayload({ name: "Expert A" }));
      await request(app)
        .post(`/api/discussions/${discussionB.id}/panelists`)
        .send(validPayload({ name: "Expert B" }));

      const responseA = await request(app).get(
        `/api/discussions/${discussionA.id}/panelists`,
      );
      const responseB = await request(app).get(
        `/api/discussions/${discussionB.id}/panelists`,
      );

      expect(responseA.status).toBe(200);
      expect(responseA.body).toHaveLength(1);
      expect(responseA.body[0].name).toBe("Expert A");

      expect(responseB.status).toBe(200);
      expect(responseB.body).toHaveLength(1);
      expect(responseB.body[0].name).toBe("Expert B");
    });
  });

  // --------------------------------------------------------------------
  // POST /api/discussions/:discussionId/panelists
  // --------------------------------------------------------------------
  describe("POST /api/discussions/:discussionId/panelists", () => {
    it("creates a host and returns 201", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ role: "host", name: "Moderator Zhang" }));

      expect(response.status).toBe(201);
      expect(response.body.role).toBe("host");
      expect(response.body.name).toBe("Moderator Zhang");
    });

    it("creates an expert and returns 201", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload());

      expect(response.status).toBe(201);
      expect(response.body.role).toBe("expert");
      expect(response.body.name).toBe("Dr. Li Wei");
    });

    it("generates a UUID v4 id", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload());

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("generates a valid ISO 8601 createdAt value", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload());

      expect(response.status).toBe(201);
      const createdAt: string = response.body.createdAt;
      expect(typeof createdAt).toBe("string");

      // Verify it is parseable and the round-trip produces the same string.
      const parsed = new Date(createdAt);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.toISOString()).toBe(createdAt);
    });

    it("defaults status to 'waiting'", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload());

      expect(response.status).toBe(201);
      expect(response.body.status).toBe("waiting");
    });

    it("defaults currentFocus to null", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload());

      expect(response.status).toBe(201);
      expect(response.body.currentFocus).toBeNull();
    });

    it("defaults publicSummary to null", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload());

      expect(response.status).toBe(201);
      expect(response.body.publicSummary).toBeNull();
    });

    it("trims all string fields", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send({
          role: "expert",
          name: "  Dr. Li Wei  ",
          occupation: "  Economist  ",
          title: "  Chief Economist  ",
          stance: "  Market-based solutions  ",
          color: "  #4A90D9  ",
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe("Dr. Li Wei");
      expect(response.body.occupation).toBe("Economist");
      expect(response.body.title).toBe("Chief Economist");
      expect(response.body.stance).toBe("Market-based solutions");
      expect(response.body.color).toBe("#4A90D9");
    });

    it("makes the created panelist appear in the GET list", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const createRes = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload());

      expect(createRes.status).toBe(201);

      const listRes = await request(app).get(
        `/api/discussions/${discussion.id}/panelists`,
      );

      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0]).toEqual(createRes.body);
    });

    // -- Discussion existence validation -------------------------------

    it("returns 404 when the Discussion does not exist", async () => {
      const { app } = createTestApp();

      const response = await request(app)
        .post("/api/discussions/non-existent-id/panelists")
        .send(validPayload());

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Discussion not found" });
    });

    // -- Role validation ------------------------------------------------

    it("returns 400 when role is missing", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ role: undefined }));

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Role must be host or expert" });
    });

    it("returns 400 when role is invalid", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ role: "moderator" }));

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Role must be host or expert" });
    });

    // -- Name validation ------------------------------------------------

    it("returns 400 when name is missing or blank", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      // Missing
      const res1 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ name: undefined }));

      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: "Name is required" });

      // Empty string
      const res2 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ name: "" }));

      expect(res2.status).toBe(400);
      expect(res2.body).toEqual({ error: "Name is required" });

      // Whitespace only
      const res3 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ name: "   " }));

      expect(res3.status).toBe(400);
      expect(res3.body).toEqual({ error: "Name is required" });
    });

    // -- Occupation validation ------------------------------------------

    it("returns 400 when occupation is missing or blank", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const res1 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ occupation: undefined }));

      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: "Occupation is required" });

      const res2 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ occupation: "   " }));

      expect(res2.status).toBe(400);
      expect(res2.body).toEqual({ error: "Occupation is required" });
    });

    // -- Title validation -----------------------------------------------

    it("returns 400 when title is missing or blank", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const res1 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ title: undefined }));

      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: "Title is required" });

      const res2 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ title: "   " }));

      expect(res2.status).toBe(400);
      expect(res2.body).toEqual({ error: "Title is required" });
    });

    // -- Stance validation ----------------------------------------------

    it("returns 400 when stance is missing or blank", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const res1 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ stance: undefined }));

      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: "Stance is required" });

      const res2 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ stance: "   " }));

      expect(res2.status).toBe(400);
      expect(res2.body).toEqual({ error: "Stance is required" });
    });

    // -- Color validation -----------------------------------------------

    it("returns 400 when color is missing or blank", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const res1 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ color: undefined }));

      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: "Color is required" });

      const res2 = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send(validPayload({ color: "   " }));

      expect(res2.status).toBe(400);
      expect(res2.body).toEqual({ error: "Color is required" });
    });

    // -- No body --------------------------------------------------------

    it("returns 400 instead of throwing when no body is supplied", async () => {
      const { app } = createTestApp();
      const discussion = await createDiscussion(app);

      const response = await request(app)
        .post(`/api/discussions/${discussion.id}/panelists`)
        .send();

      expect(response.status).toBe(400);
      // Role validation runs first — missing body means role is undefined
      expect(response.body).toEqual({ error: "Role must be host or expert" });
    });
  });
});
