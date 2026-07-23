import express from "express";
import cors from "cors";
import { DiscussionRepository } from "./repositories/DiscussionRepository.js";
import { InMemoryDiscussionRepository } from "./repositories/InMemoryDiscussionRepository.js";
import { MessageRepository } from "./repositories/MessageRepository.js";
import { InMemoryMessageRepository } from "./repositories/InMemoryMessageRepository.js";
import { PanelistRepository } from "./repositories/PanelistRepository.js";
import { InMemoryPanelistRepository } from "./repositories/InMemoryPanelistRepository.js";
import { InMemoryInsightRepository } from "./repositories/InMemoryInsightRepository.js";
import { InsightRepository } from "./repositories/InsightRepository.js";
import { AIService } from "./ai/AIService.js";
import { MockAIService } from "./ai/MockAIService.js";
import { PanelistGenerator } from "./services/PanelistGenerator.js";
import { RoundController } from "./controllers/RoundController.js";
import { DiscussionController } from "./controllers/DiscussionController.js";
import { DynamicDiscussionController } from "./controllers/DynamicDiscussionController.js";
import { DiscussionEngine } from "./services/DiscussionEngine.js";
import { DiscussionSessionController } from "./controllers/DiscussionSessionController.js";
import { SessionLifecycle } from "./lifecycle/SessionLifecycle.js";
import { AISessionLifecycle } from "./lifecycle/AISessionLifecycle.js";
import { ModeratorStrategy } from "./moderator/ModeratorStrategy.js";
import { AIModeratorStrategy } from "./moderator/AIModeratorStrategy.js";
import { SimpleReactionEvaluator } from "./scheduling/ReactionEvaluator.js";
import { DesireBasedScheduler } from "./scheduling/DesireBasedScheduler.js";
import { AIModeratorController } from "./scheduling/ModeratorController.js";
import { createDiscussionRouter } from "./routes/discussion.js";
import { createMessageRouter } from "./routes/message.js";
import { createPanelistRouter } from "./routes/panelist.js";

/** Dependencies that can be injected into the application. */
export interface AppDependencies {
  discussionRepository: DiscussionRepository;
  messageRepository: MessageRepository;
  panelistRepository: PanelistRepository;
  /** AI service implementation. Defaults to MockAIService when not injected. */
  aiService: AIService;
  /** Panelist generator service. Created from aiService + repos when not injected. */
  panelistGenerator: PanelistGenerator;
  /** Moderator strategy for AI-powered moderator behaviour. */
  moderatorStrategy: ModeratorStrategy;
  /** Session lifecycle for AI-powered session boundaries. */
  sessionLifecycle: SessionLifecycle;
  /** Session controller for discussion execution. */
  discussionSessionController: DiscussionSessionController;
  /** Insight repository for persisting final insights. */
  insightRepository: InsightRepository;
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
  const panelistRepository =
    dependencies?.panelistRepository ?? new InMemoryPanelistRepository();

  const insightRepository =
    dependencies?.insightRepository ?? new InMemoryInsightRepository();

  // AI Service — resolve injected or default to MockAIService for safety
  const aiService =
    dependencies?.aiService ?? new MockAIService();

  // Panelist Generator — resolve injected or create from available deps
  const panelistGenerator =
    dependencies?.panelistGenerator ??
    new PanelistGenerator({
      aiService,
      discussionRepository,
      panelistRepository,
    });

  // Moderator Strategy — resolve injected or create from available deps
  const moderatorStrategy =
    dependencies?.moderatorStrategy ??
    new AIModeratorStrategy({
      aiService,
      discussionRepository,
      panelistRepository,
    });

  // Session Lifecycle — resolve injected or create from available deps
  const sessionLifecycle =
    dependencies?.sessionLifecycle ??
    new AISessionLifecycle({
      moderator: moderatorStrategy,
      messageRepository,
    });

  // Execution hierarchy — controllers and engine
  const roundController = new RoundController({
    discussionRepository,
    messageRepository,
    panelistRepository,
    aiService,
  });

  // Round-robin controller (fallback)
  const discussionController = new DiscussionController({
    roundController,
    panelistRepository,
  });

  // ── Dynamic scheduling components (M16.5) ────────────────────
  const reactionEvaluator = new SimpleReactionEvaluator();
  const speakingScheduler = new DesireBasedScheduler({
    evaluator: reactionEvaluator,
    panelistRepository,
    messageRepository,
    discussionRepository,
  });
  const moderatorController = new AIModeratorController({
    panelistRepository,
    messageRepository,
    discussionRepository,
  });

  // Dynamic controller (active by default)
  const dynamicDiscussionController = new DynamicDiscussionController({
    roundController,
    panelistRepository,
    messageRepository,
    discussionRepository,
    scheduler: speakingScheduler,
    moderator: moderatorController,
  });

  const USE_DYNAMIC = process.env.DYNAMIC_SCHEDULING !== "false";
  const activeController = USE_DYNAMIC ? dynamicDiscussionController : discussionController;

  const discussionEngine = new DiscussionEngine({
    discussionController: activeController,
    discussionRepository,
    panelistRepository,
  });

  // Session controller — resolve injected or create from available deps
  const discussionSessionController =
    dependencies?.discussionSessionController ??
    new DiscussionSessionController({
      discussionEngine,
      discussionRepository,
      lifecycle: sessionLifecycle,
      messageRepository,
      moderatorStrategy,
    });

  // Discussion routes — with start, stop, pause, insights, and summary
  app.use(
    "/api/discussions",
    createDiscussionRouter(
      discussionRepository,
      discussionSessionController,
      panelistRepository,
      aiService,
      messageRepository,
      insightRepository,
    ),
  );

  // Message routes (scoped under a discussion)
  app.use(
    "/api/discussions/:discussionId/messages",
    createMessageRouter(messageRepository, discussionRepository),
  );

  // Panelist routes (scoped under a discussion)
  app.use(
    "/api/discussions/:discussionId/panelists",
    createPanelistRouter(panelistRepository, discussionRepository, panelistGenerator),
  );

  return app;
}

// Default app instance used by index.ts (production) and the existing
// health-check test.
const app = createApp();
export default app;
