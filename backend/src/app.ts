import express from "express";
import cors from "cors";
import { DiscussionRepository } from "./repositories/DiscussionRepository.js";
import { InMemoryDiscussionRepository } from "./repositories/InMemoryDiscussionRepository.js";
import { createDiscussionRouter } from "./routes/discussion.js";

/**
 * Create a fully configured Express application.
 *
 * Accepts an optional DiscussionRepository so that tests can inject an
 * isolated in-memory instance.  When omitted, a default
 * InMemoryDiscussionRepository is used for normal startup.
 */
export function createApp(discussionRepository?: DiscussionRepository) {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Health endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Discussion routes
  const repository = discussionRepository ?? new InMemoryDiscussionRepository();
  app.use("/api/discussions", createDiscussionRouter(repository));

  return app;
}

// Default app instance used by index.ts (production) and the existing
// health-check test.
const app = createApp();
export default app;
