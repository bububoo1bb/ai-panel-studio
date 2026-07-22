import express from "express";
import cors from "cors";
import { DiscussionRepository } from "./repositories/DiscussionRepository.js";
import { InMemoryDiscussionRepository } from "./repositories/InMemoryDiscussionRepository.js";
import { MessageRepository } from "./repositories/MessageRepository.js";
import { InMemoryMessageRepository } from "./repositories/InMemoryMessageRepository.js";
import { createDiscussionRouter } from "./routes/discussion.js";
import { createMessageRouter } from "./routes/message.js";

/** Dependencies that can be injected into the application. */
export interface AppDependencies {
  discussionRepository: DiscussionRepository;
  messageRepository: MessageRepository;
}

/**
 * Create a fully configured Express application.
 *
 * Accepts optional dependency overrides so that tests can inject isolated
 * in-memory instances.  When omitted, default in-memory repositories are
 * used for normal startup.
 */
export function createApp(dependencies?: Partial<AppDependencies>) {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Health endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Repositories — resolve injected or default
  const discussionRepository =
    dependencies?.discussionRepository ?? new InMemoryDiscussionRepository();
  const messageRepository =
    dependencies?.messageRepository ?? new InMemoryMessageRepository();

  // Discussion routes
  app.use("/api/discussions", createDiscussionRouter(discussionRepository));

  // Message routes (scoped under a discussion)
  app.use(
    "/api/discussions/:discussionId/messages",
    createMessageRouter(messageRepository, discussionRepository),
  );

  return app;
}

// Default app instance used by index.ts (production) and the existing
// health-check test.
const app = createApp();
export default app;
