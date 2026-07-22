import { Router, Request, Response } from "express";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";

/**
 * Create an Express router for Message endpoints scoped to a discussion.
 *
 * Both repositories are injected through the factory function so that
 * tests can supply isolated instances without relying on global state.
 *
 * This router expects to be mounted at
 * `/api/discussions/:discussionId/messages` so that `req.params.discussionId`
 * is available from the parent mount point.
 */
export function createMessageRouter(
  messageRepository: MessageRepository,
  discussionRepository: DiscussionRepository,
): Router {
  const router = Router({ mergeParams: true });

  // GET / — list all messages for the discussion in insertion order
  router.get("/", async (req: Request, res: Response) => {
    const { discussionId } = req.params;

    // Verify the discussion exists
    const discussion = await discussionRepository.findById(discussionId);
    if (!discussion) {
      res.status(404).json({ error: "Discussion not found" });
      return;
    }

    const messages = await messageRepository.findByDiscussionId(discussionId);
    res.json(messages);
  });

  // POST / — create a new message for the discussion
  router.post("/", async (req: Request, res: Response) => {
    const { discussionId } = req.params;
    const { role, content } = req.body ?? {};

    // Verify the discussion exists
    const discussion = await discussionRepository.findById(discussionId);
    if (!discussion) {
      res.status(404).json({ error: "Discussion not found" });
      return;
    }

    // Validate: role must be "user" or "assistant"
    if (role !== "user" && role !== "assistant") {
      res.status(400).json({ error: "Role must be user or assistant" });
      return;
    }

    // Validate: content must be a non-empty string after trimming
    if (content === undefined || content === null || typeof content !== "string") {
      res.status(400).json({ error: "Content is required" });
      return;
    }

    const trimmed = content.trim();
    if (trimmed.length === 0) {
      res.status(400).json({ error: "Content is required" });
      return;
    }

    const message = await messageRepository.create({
      discussionId,
      role,
      content: trimmed,
    });
    res.status(201).json(message);
  });

  return router;
}
