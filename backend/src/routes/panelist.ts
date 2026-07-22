import { Router, Request, Response } from "express";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";

/**
 * Create an Express router for Panelist endpoints scoped to a discussion.
 *
 * Both repositories are injected through the factory function so that
 * tests can supply isolated instances without relying on global state.
 *
 * This router expects to be mounted at
 * `/api/discussions/:discussionId/panelists` so that `req.params.discussionId`
 * is available from the parent mount point.
 */
export function createPanelistRouter(
  panelistRepository: PanelistRepository,
  discussionRepository: DiscussionRepository,
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

  return router;
}
