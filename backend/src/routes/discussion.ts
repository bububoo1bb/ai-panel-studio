import { Router, Request, Response } from "express";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";

/**
 * Create an Express router for Discussion endpoints.
 *
 * The repository is injected through the factory function so that tests
 * can supply an isolated instance without relying on global mutable state.
 */
export function createDiscussionRouter(repository: DiscussionRepository): Router {
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

  return router;
}
