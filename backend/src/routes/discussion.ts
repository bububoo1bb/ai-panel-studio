import { Router, Request, Response } from "express";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { DiscussionSessionController } from "../controllers/DiscussionSessionController.js";

/**
 * Create an Express router for Discussion endpoints.
 *
 * The repository is injected through the factory function so that tests
 * can supply an isolated instance without relying on global mutable state.
 *
 * When `discussionSessionController` and `panelistRepository` are both
 * provided, the `POST /:id/start` endpoint is mounted for discussion
 * execution.
 */
export function createDiscussionRouter(
  repository: DiscussionRepository,
  discussionSessionController?: DiscussionSessionController,
  panelistRepository?: PanelistRepository,
): Router {
  const router = Router();

  // GET /api/discussions — list all discussions in insertion order
  router.get("/", async (_req: Request, res: Response) => {
    const discussions = await repository.findAll();
    res.json(discussions);
  });

  // POST /api/discussions — create a new discussion
  router.post("/", async (req: Request, res: Response) => {
    const { title } = req.body;

    // Validate: title must be a non-empty string after trimming
    if (title === undefined || title === null || typeof title !== "string") {
      res.status(400).json({ error: "Title is required" });
      return;
    }

    const trimmed = title.trim();
    if (trimmed.length === 0) {
      res.status(400).json({ error: "Title is required" });
      return;
    }

    const discussion = await repository.create({ title: trimmed });
    res.status(201).json(discussion);
  });

  // GET /api/discussions/:id — get a single discussion
  router.get("/:id", async (req: Request, res: Response) => {
    const discussion = await repository.findById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: "Discussion not found" });
      return;
    }
    res.json(discussion);
  });

  // ─────────────────────────────────────────────────────────────
  // POST /:id/start — start discussion execution
  // ─────────────────────────────────────────────────────────────
  if (discussionSessionController && panelistRepository) {
    router.post("/:id/start", async (req: Request, res: Response) => {
      const discussionId = req.params.id;

      try {
        // 1. Validate discussion exists and is not finished
        const discussion = await repository.findById(discussionId);
        if (!discussion) {
          res.status(404).json({ error: "Discussion not found" });
          return;
        }
        if (discussion.status === "finished") {
          res.status(409).json({ error: "Discussion is already finished" });
          return;
        }

        // 2. Validate maxRounds
        const { maxRounds } = req.body ?? {};
        if (maxRounds === undefined || maxRounds === null) {
          res.status(400).json({ error: "maxRounds is required" });
          return;
        }
        if (typeof maxRounds !== "number") {
          res.status(400).json({ error: "maxRounds must be a number" });
          return;
        }
        if (!Number.isFinite(maxRounds)) {
          res.status(400).json({ error: "maxRounds must be finite" });
          return;
        }
        if (!Number.isInteger(maxRounds)) {
          res.status(400).json({ error: "maxRounds must be an integer" });
          return;
        }
        if (maxRounds <= 0) {
          res.status(400).json({ error: "maxRounds must be greater than zero" });
          return;
        }

        // 3. Validate panelists exist (at least 1 host + 1 expert)
        const panelists = await panelistRepository.findByDiscussionId(discussionId);
        if (panelists.length === 0) {
          res.status(422).json({ error: "Discussion has no panelists" });
          return;
        }
        const host = panelists.find((p) => p.role === "host");
        if (!host) {
          res.status(422).json({ error: "No moderator found for this discussion" });
          return;
        }
        const hasExperts = panelists.some((p) => p.role === "expert");
        if (!hasExperts) {
          res.status(422).json({ error: "Discussion has no experts" });
          return;
        }

        // 4. Start async execution — do NOT await
        // Frontend receives 202 immediately and polls for messages.
        // Discussion status transitions to "finished" when execution completes.
        discussionSessionController
          .runSession({ discussionId, maxRounds })
          .then(async () => {
            try {
              await repository.updateStatus(discussionId, "finished");
            } catch {
              // Status update is best-effort; frontend polling will
              // detect completion even if this fails
            }
          })
          .catch((err) => {
            console.error("Discussion execution failed:", err);
          });

        // 5. Respond immediately so frontend enters running state
        res.status(202).json({ status: "started", discussionId });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Discussion execution failed";
        console.error("Discussion start error:", message);
        res.status(500).json({ error: "Discussion execution failed" });
      }
    });
  }

  return router;
}