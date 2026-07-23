import { Panelist } from "../domain/panelist.js";
import { Message } from "../domain/message.js";
import { AIService } from "../ai/AIService.js";

/**
 * The result of an AI-powered insight analysis.
 */
export interface InsightResult {
  /** Points where experts broadly agree (natural language). */
  consensus: string[];
  /** Points where experts disagree, with named conflict pairs. */
  divergence: string[];
}

// ═══════════════════════════════════════════════════════════════
// AI-Powered Insight Analyzer (M16.8)
// ═══════════════════════════════════════════════════════════════

/**
 * Uses the LLM to analyze the full discussion transcript and produce
 * structured consensus/divergence output in natural language.
 *
 * Each divergence item MUST identify the conflicting experts by name
 * and summarize the core conflict — NOT just copy transcript text.
 */
export class RuleBasedInsightAnalyzer {
  private readonly aiService: AIService;

  constructor(deps: { aiService: AIService }) {
    this.aiService = deps.aiService;
  }

  /**
   * Analyze panelists and messages to produce consensus + divergence.
   */
  async analyze(panelists: Panelist[], messages: Message[]): Promise<InsightResult> {
    if (messages.length < 2 || panelists.length < 2) {
      return {
        consensus: ["讨论即将开始，专家们正在准备观点"],
        divergence: [],
      };
    }

    const experts = panelists.filter((p) => p.role === "expert");
    const topic = "roundtable discussion";

    // ── Build transcript summary ────────────────────────────────
    const transcriptText = messages
      .map((m) => {
        const author = panelists.find((p) => p.id === m.panelistId);
        const prefix = author ? `${author.name}（${author.role === "host" ? "主持人" : author.title}）` : "系统";
        return `${prefix}: ${m.content}`;
      })
      .join("\n");

    // ── Build expert profiles ───────────────────────────────────
    const expertProfiles = experts
      .map((e) => `- ${e.name}（${e.title}）：立场=${e.stance}；信念=${e.beliefs ?? ""}；关切=${e.concerns ?? ""}`)
      .join("\n");

    // ── Build AI prompt ─────────────────────────────────────────
    const systemPrompt = [
      "你是一个专业的圆桌讨论分析助手。根据讨论记录和专家背景，分析当前共识与分歧。",
      "",
      "输出格式（纯JSON，不要markdown代码块）：",
      "{",
      '  "consensus": ["自然语言共识1", "自然语言共识2"],',
      '  "divergence": [',
      '    {',
      '      "expertA": "专家A姓名",',
      '      "expertB": "专家B姓名",',
      '      "expertAView": "专家A的核心观点（用自己的话概括，不要直接复制原文）",',
      '      "expertBView": "专家B的核心观点（用自己的话概括，不要直接复制原文）",',
      '      "conflict": "核心冲突的一句话总结"',
      "    }",
      "  ]",
      "}",
      "",
      "要求：",
      "- consensus: 专家们明确达成一致的共同观点（自然语言，每条1句话）",
      "- divergence: 必须识别具体冲突的双方专家，用自己的话概括各自观点",
      "- 禁止直接复制transcript原文——必须用自己的话提炼",
      "- 禁止引用未发言专家的观点（expertProfiles中但transcript中未出现的内容仅作背景参考）",
      "- 如果讨论刚开始尚无明确共识或分歧，返回空数组",
      "- 最多返回3条consensus和3条divergence",
    ].join("\n");

    const userPrompt = [
      "讨论主题：",
      topic,
      "",
      "专家背景：",
      expertProfiles,
      "",
      "讨论记录：",
      transcriptText,
    ].join("\n");

    try {
      const response = await this.aiService.generate({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      return this.parseAIResponse(response.content);
    } catch {
      // AI failed — return rule-based fallback
      return this.fallbackAnalysis(experts, messages);
    }
  }

  /**
   * Parse AI-generated JSON into InsightResult.
   */
  private parseAIResponse(content: string): InsightResult {
    try {
      let json = content.trim();
      if (json.startsWith("```")) {
        json = json.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }

      const parsed = JSON.parse(json);

      const divergence = Array.isArray(parsed.divergence)
        ? parsed.divergence
            .filter(
              (d: unknown) =>
                typeof d === "object" &&
                d !== null &&
                typeof (d as Record<string, unknown>).expertA === "string" &&
                typeof (d as Record<string, unknown>).expertB === "string",
            )
            .map((d: Record<string, unknown>) =>
              [
                `${d.expertA}认为${d.expertAView ?? ""}`,
                `${d.expertB}认为${d.expertBView ?? ""}`,
                `核心冲突：${d.conflict ?? ""}`,
              ].join("\n"),
            )
            .slice(0, 3)
        : [];

      const consensus = Array.isArray(parsed.consensus)
        ? (parsed.consensus as string[]).filter(
            (c: unknown) => typeof c === "string" && c.length > 0,
          ).slice(0, 3)
        : [];

      return { consensus, divergence };
    } catch {
      return { consensus: [], divergence: [] };
    }
  }

  /**
   * Rule-based fallback when AI is unavailable.
   */
  private fallbackAnalysis(experts: Panelist[], messages: Message[]): InsightResult {
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    const hasDiscussion = assistantMsgs.length >= 3;

    if (!hasDiscussion) {
      return {
        consensus: ["讨论正在进行中，专家们正在阐述各自观点"],
        divergence: [],
      };
    }

    return {
      consensus: ["专家们均认可该话题的重要性，各方从不同角度提出了建设性观点"],
      divergence: [
        "专家们在具体解决方案和实施路径上存在不同看法，需要进一步深入讨论",
      ],
    };
  }
}
