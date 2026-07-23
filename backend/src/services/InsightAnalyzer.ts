import { AIService } from "../ai/AIService.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";

/**
 * The result of an insight analysis run.
 */
export interface InsightResult {
  /** Points where experts broadly agree. */
  consensus: string[];
  /** Points where experts disagree or have conflicting views. */
  divergence: string[];
}

/**
 * Application-layer service that analyzes a discussion transcript
 * to extract live consensus and divergence points using the LLM.
 *
 * Responsibilities:
 * - Load the discussion and its transcript
 * - Build an analysis prompt with the conversation history
 * - Call AIService to extract consensus and divergence
 * - Parse and return structured insight data
 *
 * InsightAnalyzer depends only on abstractions (AIService,
 * DiscussionRepository, MessageRepository). It does not persist
 * data or mutate any entity.
 */
export class InsightAnalyzer {
  private readonly aiService: AIService;
  private readonly discussionRepo: DiscussionRepository;
  private readonly messageRepo: MessageRepository;

  constructor(deps: {
    aiService: AIService;
    discussionRepository: DiscussionRepository;
    messageRepository: MessageRepository;
  }) {
    this.aiService = deps.aiService;
    this.discussionRepo = deps.discussionRepository;
    this.messageRepo = deps.messageRepository;
  }

  /**
   * Analyze the discussion transcript to produce consensus and divergence.
   *
   * Returns empty arrays when the transcript has fewer than 2 messages
   * (not enough data for meaningful analysis).
   */
  async analyze(discussionId: string): Promise<InsightResult> {
    // 1. Load discussion
    const discussion = await this.discussionRepo.findById(discussionId);
    if (!discussion) {
      throw new Error("Discussion not found");
    }

    // 2. Load transcript
    const messages = await this.messageRepo.findByDiscussionId(discussionId);

    // Not enough data for analysis
    if (messages.length < 2) {
      return { consensus: [], divergence: [] };
    }

    // 3. Build conversation summary for the AI
    const conversationText = messages
      .map((m) => `${m.role === "assistant" ? "专家" : "用户"}: ${m.content}`)
      .join("\n\n");

    // 4. Build analysis prompt
    const systemPrompt = [
      "你是一个圆桌讨论分析专家。你的任务是分析以下讨论记录，提取共识和分歧。",
      "",
      "要求：",
      "- 共识(consensus)：专家们达成一致的共同观点，每条一句话",
      "- 分歧(divergence)：专家们存在争议或不同立场的问题，每条一句话",
      "- 如果讨论刚开始、信息不足，返回空数组",
      "- 每条见解必须具体、有实质性内容，不要泛泛而谈",
      "",
      "输出格式（纯JSON，不要markdown代码块）：",
      '{"consensus":["共识1","共识2"],"divergence":["分歧1","分歧2"]}',
    ].join("\n");

    const response = await this.aiService.generate({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `讨论主题：${discussion.title}\n\n讨论记录：\n${conversationText}` },
      ],
    });

    // 5. Parse response
    return this.parseInsightResponse(response.content);
  }

  /**
   * Parse the AI-generated JSON response into an InsightResult.
   *
   * Robust against:
   * - JSON wrapped in markdown code fences
   * - Missing fields (defaults to empty arrays)
   * - Malformed JSON (returns empty arrays)
   */
  private parseInsightResponse(content: string): InsightResult {
    try {
      // Strip markdown code fences if present
      let json = content.trim();
      if (json.startsWith("```")) {
        json = json.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }

      const parsed = JSON.parse(json);

      return {
        consensus: Array.isArray(parsed.consensus) ? parsed.consensus : [],
        divergence: Array.isArray(parsed.divergence) ? parsed.divergence : [],
      };
    } catch {
      // If parsing fails, return empty — the UI shows placeholder state
      console.warn("InsightAnalyzer: failed to parse AI response:", content.slice(0, 200));
      return { consensus: [], divergence: [] };
    }
  }
}
