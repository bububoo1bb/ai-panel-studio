import { Router, Request, Response } from "express";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { InsightRepository } from "../repositories/InsightRepository.js";
import { DiscussionSessionController } from "../controllers/DiscussionSessionController.js";
import { RuleBasedInsightAnalyzer } from "../scheduling/RuleBasedInsightAnalyzer.js";
import { AIService } from "../ai/AIService.js";

/**
 * Create an Express router for Discussion endpoints.
 *
 * The repository is injected through the factory function so that tests
 * can supply an isolated instance without relying on global mutable state.
 *
 * When `discussionSessionController` and `panelistRepository` are both
 * provided, the `POST /:id/start` endpoint is mounted for discussion
 * execution.
 *
 * When `insightAnalyzer` is provided, the `GET /:id/insights` endpoint
 * is mounted for live consensus/divergence analysis.
 */
export function createDiscussionRouter(
  repository: DiscussionRepository,
  discussionSessionController?: DiscussionSessionController,
  panelistRepository?: PanelistRepository,
  aiService?: AIService,
  messageRepository?: MessageRepository,
  insightRepository?: InsightRepository,
): Router {
  const router = Router();

  // GET /api/discussions — list all discussions in insertion order
  router.get("/", async (_req: Request, res: Response) => {
    const discussions = await repository.findAll();
    res.json(discussions);
  });

  // POST /api/discussions — create a new discussion
  router.post("/", async (req: Request, res: Response) => {
    const { title, durationLimit } = req.body;

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

    // Validate durationLimit (optional, must be 60 or 180 if provided)
    let validDuration: number | undefined;
    if (durationLimit !== undefined && durationLimit !== null) {
      if (typeof durationLimit !== "number" || ![60, 180].includes(durationLimit)) {
        res.status(400).json({ error: "durationLimit must be 60 or 180" });
        return;
      }
      validDuration = durationLimit;
    }

    const discussion = await repository.create({
      title: trimmed,
      durationLimit: validDuration,
    });
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
  // POST /:id/stop — stop discussion, generate final insight
  // ─────────────────────────────────────────────────────────────
  router.post("/:id/stop", async (req: Request, res: Response) => {
    const discussionId = req.params.id;

    try {
      const discussion = await repository.findById(discussionId);
      if (!discussion) {
        res.status(404).json({ error: "Discussion not found" });
        return;
      }
      if (discussion.status !== "active") {
        res.status(409).json({
          error: `Discussion is already ${discussion.status}`,
        });
        return;
      }

      // 1. Block new turns
      await repository.updateStatus(discussionId, "stopped");

      // 2. Generate final insight if AI and repos available
      if (aiService && panelistRepository && messageRepository && insightRepository) {
        try {
          const panelists = await panelistRepository.findByDiscussionId(discussionId);
          const messages = await messageRepository.findByDiscussionId(discussionId);
          const experts = panelists.filter((p) => p.role === "expert");

          const stanceSummary = experts
            .map((e) => `${e.name}（${e.title}）：立场=${e.stance}；信念=${e.beliefs ?? ""}；关切=${e.concerns ?? ""}`)
            .join("\n");

          const transcript = messages
            .map((m) => {
              const author = panelists.find((p) => p.id === m.panelistId);
              const prefix = author ? `${author.name}: ` : "";
              return `${prefix}${m.content}`;
            })
            .join("\n");

          const prompt = [
            "你是一个专业的圆桌讨论总结助手。讨论已经结束，请生成最终洞察。",
            "",
            "输出格式（纯JSON，不要markdown）：",
            "{",
            '  "consensus": ["共识1", "共识2"],',
            '  "divergence": [',
            '    {',
            '      "expertA": "专家A姓名",',
            '      "expertAView": "专家A的核心观点（用自己的话总结）",',
            '      "expertB": "专家B姓名",',
            '      "expertBView": "专家B的核心观点（用自己的话总结）",',
            '      "conflictSummary": "核心冲突的一句话总结"',
            "    }",
            "  ],",
            '  "summary": "主持人的1-2句全局总结"',
            "}",
            "",
            "要求：",
            "- 必须用自己的话进行观点归纳，禁止直接复制原文",
            "- consensus: 专家们明确达成的共同观点",
            "- divergence: 识别立场对立的专家对，各自总结观点和冲突",
            "- summary: 主持人视角的全局总结（2-3句话）",
          ].join("\n");

          const response = await aiService.generate({
            messages: [
              { role: "system", content: prompt },
              {
                role: "user",
                content: [
                  `讨论主题：${discussion.title}`,
                  "",
                  "专家背景：",
                  stanceSummary,
                  "",
                  "完整讨论记录：",
                  transcript,
                ].join("\n"),
              },
            ],
          });

          let parsed;
          try {
            let json = response.content.trim();
            if (json.startsWith("```")) {
              json = json.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
            }
            parsed = JSON.parse(json);
          } catch {
            parsed = {
              consensus: ["讨论已结束"],
              divergence: [],
              summary: "本次圆桌讨论圆满结束。",
            };
          }

          // Persist final insight
          await insightRepository.create({
            discussionId,
            consensus: Array.isArray(parsed.consensus) ? parsed.consensus : [],
            divergence: Array.isArray(parsed.divergence) ? parsed.divergence : [],
            summary: typeof parsed.summary === "string" ? parsed.summary : "",
          });
        } catch (err) {
          console.error("Final insight generation failed:", err);
        }
      }

      // 3. Mark finished
      await repository.updateStatus(discussionId, "finished");
      res.json({ status: "finished", discussionId });
    } catch (err) {
      console.error("Discussion stop error:", err);
      res.status(500).json({ error: "Failed to stop discussion" });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // POST /:id/pause — pause a running discussion
  // ─────────────────────────────────────────────────────────────
  router.post("/:id/pause", async (req: Request, res: Response) => {
    const discussionId = req.params.id;

    try {
      const discussion = await repository.findById(discussionId);
      if (!discussion) {
        res.status(404).json({ error: "Discussion not found" });
        return;
      }
      if (discussion.status !== "active") {
        res.status(409).json({
          error: `Cannot pause — discussion is ${discussion.status}`,
        });
        return;
      }

      await repository.updateStatus(discussionId, "paused");
      res.json({ status: "paused", discussionId });
    } catch (err) {
      res.status(500).json({ error: "Failed to pause discussion" });
    }
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

        // 2. Validate maxRounds — derive from durationLimit when absent
        let { maxRounds } = req.body ?? {};
        if (maxRounds === undefined || maxRounds === null) {
          // Derive from discussion duration: ~1 speech per 8 seconds
          const durationSec = discussion.durationLimit;
          maxRounds = Math.max(6, Math.ceil(durationSec / 8));
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

  // ─────────────────────────────────────────────────────────────
  // GET /:id/insights — live analysis or persisted final insight
  // ─────────────────────────────────────────────────────────────
  router.get("/:id/insights", async (req: Request, res: Response) => {
    const discussionId = req.params.id;

    try {
      const discussion = await repository.findById(discussionId);
      if (!discussion) {
        res.status(404).json({ error: "Discussion not found" });
        return;
      }

      // Finished/stopped: return persisted final insight
      if (discussion.status === "finished" || discussion.status === "stopped") {
        if (insightRepository) {
          const persisted = await insightRepository.findByDiscussionId(discussionId);
          if (persisted) {
            res.json({ ...persisted, phase: "final" });
            return;
          }
        }
        // No persisted insight yet — return empty
        res.json({ consensus: [], divergence: [], phase: "final", summary: "" });
        return;
      }

      // Active: return live AI analysis
      if (panelistRepository && messageRepository && aiService) {
        const panelists = await panelistRepository.findByDiscussionId(discussionId);
        const messages = await messageRepository.findByDiscussionId(discussionId);
        const expertMsgs = messages.filter(
          (m) => m.role === "assistant" && m.kind === "expert_statement",
        );

        if (expertMsgs.length < 2) {
          res.json({ consensus: [], divergence: [], phase: "waiting" });
          return;
        }

        const analyzer = new RuleBasedInsightAnalyzer({ aiService });
        const insights = await analyzer.analyze(panelists, messages);
        res.json({ ...insights, phase: "live" });
        return;
      }

      res.json({ consensus: [], divergence: [], phase: "waiting" });
    } catch (err) {
      console.error("Insight error:", err);
      res.json({ consensus: [], divergence: [], phase: "waiting" });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // GET /:id/summary — final summary after discussion ends
  // ─────────────────────────────────────────────────────────────
  router.get("/:id/summary", async (req: Request, res: Response) => {
    const discussionId = req.params.id;

    try {
      const discussion = await repository.findById(discussionId);
      if (!discussion) {
        res.status(404).json({ error: "Discussion not found" });
        return;
      }

      if (!panelistRepository || !messageRepository || !aiService) {
        res.status(500).json({ error: "Missing dependencies" });
        return;
      }

      const panelists = await panelistRepository.findByDiscussionId(discussionId);
      const messages = await messageRepository.findByDiscussionId(discussionId);
      const experts = panelists.filter((p) => p.role === "expert");

      // Build expert stance summary
      const stanceSummary = experts
        .map((e) => `${e.name}（${e.title}）：立场=${e.stance}；信念=${e.beliefs ?? ""}`)
        .join("\n");

      // Build full transcript
      const transcript = messages
        .map((m) => {
          const author = panelists.find((p) => p.id === m.panelistId);
          const prefix = author ? `${author.name}（${author.role === "host" ? "主持人" : author.title}）` : "";
          return `${prefix}: ${m.content}`;
        })
        .join("\n");

      const systemPrompt = [
        "你是一个专业的圆桌讨论总结助手。讨论已经结束，请生成最终总结。",
        "",
        "输出格式（纯JSON）：",
        "{",
        '  "finalConsensus": "最终达成的共识（自然语言，1-2句话）",',
        '  "coreConflict": "核心争议点总结（1句话）",',
        '  "expertSummaries": [',
        '    {"name": "专家名", "title": "职务", "position": "核心观点总结"}',
        "  ],",
        '  "moderatorSummary": "主持人角度的全场总结（2-3句话）"',
        "}",
        "",
        "要求：用自己的话总结，不要直接复制原文。",
      ].join("\n");

      const userPrompt = [
        `讨论主题：${discussion.title}`,
        "",
        "专家立场：",
        stanceSummary,
        "",
        "完整讨论记录：",
        transcript,
      ].join("\n");

      const response = await aiService.generate({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      try {
        let json = response.content.trim();
        if (json.startsWith("```")) {
          json = json.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        }
        res.json(JSON.parse(json));
      } catch {
        res.json({
          finalConsensus: "讨论已结束",
          coreConflict: "专家们在关键问题上进行了深入讨论",
          expertSummaries: experts.map((e) => ({ name: e.name, title: e.title, position: e.stance })),
          moderatorSummary: "本次圆桌讨论圆满结束，感谢各位专家的参与。",
        });
      }
    } catch (err) {
      console.error("Summary generation error:", err);
      res.status(500).json({ error: "Failed to generate summary" });
    }
  });

  return router;
}