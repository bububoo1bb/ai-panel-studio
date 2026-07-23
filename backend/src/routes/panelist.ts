import { Router, Request, Response } from "express";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { PanelistGenerator } from "../services/PanelistGenerator.js";
import { Panelist } from "../domain/panelist.js";

/**
 * Request-level lock to prevent concurrent duplicate panelist generation
 * for the same discussion. Keyed by discussionId.
 *
 * Fixes TOCTOU race condition where React StrictMode double-mounts
 * trigger two concurrent POST /generate requests — both passing the
 * duplicate guard before either has persisted its results.
 */
const pendingGenerations = new Map<string, Promise<Panelist[]>>();

/**
 * Create an Express router for Panelist endpoints scoped to a discussion.
 *
 * Both repositories are injected through the factory function so that
 * tests can supply isolated instances without relying on global state.
 *
 * When `panelistGenerator` is provided, the POST /generate endpoint is
 * mounted for AI-powered panelist generation.
 *
 * This router expects to be mounted at
 * `/api/discussions/:discussionId/panelists` so that `req.params.discussionId`
 * is available from the parent mount point.
 */
export function createPanelistRouter(
  panelistRepository: PanelistRepository,
  discussionRepository: DiscussionRepository,
  panelistGenerator?: PanelistGenerator,
): Router {
  const router = Router({ mergeParams: true });

  // GET / — list all panelists for the discussion in insertion order
  router.get("/", async (req: Request, res: Response) => {
    const { discussionId } = req.params;

    // Verify the discussion exists
    const discussion = await discussionRepository.findById(discussionId);
    if (!discussion) {
      res.status(404).json({ error: "Discussion not found" });
      return;
    }

    const panelists = await panelistRepository.findByDiscussionId(discussionId);
    res.json(panelists);
  });

  // POST / — create a new panelist for the discussion
  router.post("/", async (req: Request, res: Response) => {
    const { discussionId } = req.params;
    const { role, name, occupation, title, stance, color } = req.body ?? {};

    // Verify the discussion exists before other validation
    const discussion = await discussionRepository.findById(discussionId);
    if (!discussion) {
      res.status(404).json({ error: "Discussion not found" });
      return;
    }

    // Validate role
    if (role !== "host" && role !== "expert") {
      res.status(400).json({ error: "Role must be host or expert" });
      return;
    }

    // Validate name — must be a non-empty string after trimming
    if (name === undefined || name === null || typeof name !== "string") {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    // Validate occupation
    if (occupation === undefined || occupation === null || typeof occupation !== "string") {
      res.status(400).json({ error: "Occupation is required" });
      return;
    }
    const trimmedOccupation = occupation.trim();
    if (trimmedOccupation.length === 0) {
      res.status(400).json({ error: "Occupation is required" });
      return;
    }

    // Validate title
    if (title === undefined || title === null || typeof title !== "string") {
      res.status(400).json({ error: "Title is required" });
      return;
    }
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      res.status(400).json({ error: "Title is required" });
      return;
    }

    // Validate stance
    if (stance === undefined || stance === null || typeof stance !== "string") {
      res.status(400).json({ error: "Stance is required" });
      return;
    }
    const trimmedStance = stance.trim();
    if (trimmedStance.length === 0) {
      res.status(400).json({ error: "Stance is required" });
      return;
    }

    // Validate color
    if (color === undefined || color === null || typeof color !== "string") {
      res.status(400).json({ error: "Color is required" });
      return;
    }
    const trimmedColor = color.trim();
    if (trimmedColor.length === 0) {
      res.status(400).json({ error: "Color is required" });
      return;
    }

    const panelist = await panelistRepository.create({
      discussionId,
      role,
      name: trimmedName,
      occupation: trimmedOccupation,
      title: trimmedTitle,
      stance: trimmedStance,
      color: trimmedColor,
    });
    res.status(201).json(panelist);
  });

  // ─────────────────────────────────────────────────────────────
  // POST /generate — AI-powered panelist generation
  // ─────────────────────────────────────────────────────────────
  if (panelistGenerator) {
    router.post("/generate", async (req: Request, res: Response) => {
      const { discussionId } = req.params;

      try {
        // Verify the discussion exists
        const discussion = await discussionRepository.findById(discussionId);
        if (!discussion) {
          res.status(404).json({ error: "Discussion not found" });
          return;
        }

        // ── Request-level lock: prevent concurrent generation ──
        if (pendingGenerations.has(discussionId)) {
          res.status(409).json({ error: "Panelist generation already in progress" });
          return;
        }

        // Prevent duplicate generation
        const existingPanelists = await panelistRepository.findByDiscussionId(discussionId);
        if (existingPanelists.length > 0) {
          res.status(409).json({ error: "Panelists already generated for this discussion" });
          return;
        }

        const { expertCount } = req.body ?? {};

        // Validate expertCount
        if (expertCount === undefined || expertCount === null) {
          res.status(400).json({ error: "expertCount is required" });
          return;
        }
        if (typeof expertCount !== "number") {
          res.status(400).json({ error: "expertCount must be a number" });
          return;
        }
        if (!Number.isInteger(expertCount)) {
          res.status(400).json({ error: "expertCount must be an integer" });
          return;
        }
        if (expertCount < 2 || expertCount > 8) {
          res.status(400).json({ error: "expertCount must be between 2 and 8" });
          return;
        }

        // ── Execute generation under lock ─────────────────────
        const generationPromise = panelistGenerator.generate({
          discussionId,
          topic: discussion.title,
          expertCount,
        });
        pendingGenerations.set(discussionId, generationPromise);

        try {
          const panelists = await generationPromise;
          res.status(201).json(panelists);
        } finally {
          pendingGenerations.delete(discussionId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal server error";

        // Distinguish known validation errors from unexpected failures
        if (
          message.includes("Failed to parse") ||
          message.includes("must be") ||
          message.includes("not a JSON array")
        ) {
          res.status(422).json({ error: message });
        } else {
          console.error("Panelist generation error:", message);
          res.status(500).json({ error: "Panelist generation failed" });
        }
      }
    });
  }

  return router;
}
