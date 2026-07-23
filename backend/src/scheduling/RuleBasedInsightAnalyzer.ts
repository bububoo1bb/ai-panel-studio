import { Panelist } from "../domain/panelist.js";
import { Message } from "../domain/message.js";

/**
 * The result of a rule-based insight analysis.
 */
export interface InsightResult {
  /** Points where experts broadly agree. */
  consensus: string[];
  /** Points where experts disagree or have conflicting views. */
  divergence: string[];
}

// ═══════════════════════════════════════════════════════════════
// Agreement / disagreement markers (Chinese)
// ═══════════════════════════════════════════════════════════════

const AGREEMENT_MARKERS = [
  "同意", "赞同", "支持", "有道理", "确实", "没错",
  "我也认为", "说得对", "认可", "赞成",
];

const DISAGREEMENT_MARKERS = [
  "但是", "然而", "不同意", "反对", "问题在于",
  "不一定", "并非", "恰恰相反", "我不认为", "值得商榷",
];

/**
 * Rule-based insight analyzer.
 *
 * Extracts consensus and divergence from panelist stances/beliefs
 * and recent messages — using pure keyword matching without AI calls.
 *
 * Guaranteed to be non-empty when the discussion has ≥2 messages:
 * falls back to generic statements if no explicit patterns are found.
 */
export class RuleBasedInsightAnalyzer {
  /**
   * Analyze panelists and messages to produce consensus + divergence.
   *
   * @param panelists — must be scoped to a single discussionId.
   * @param messages — must be scoped to the same discussionId.
   */
  analyze(panelists: Panelist[], messages: Message[]): InsightResult {
    // ── Early return: not enough data ─────────────────────────
    if (messages.length < 2 || panelists.length < 2) {
      return {
        consensus: ["讨论即将开始，专家们正在准备观点"],
        divergence: [],
      };
    }

    // ── Extract stance keywords from all experts ──────────────
    const experts = panelists.filter((p) => p.role === "expert");
    const stanceTexts = experts.map((e) =>
      [e.stance, e.beliefs, e.concerns].filter(Boolean).join(" "),
    );

    // ── Analyze messages for explicit agreement/disagreement ──
    const consensusSet = new Set<string>();
    const divergenceSet = new Set<string>();

    const assistantMessages = messages.filter((m) => m.role === "assistant");

    for (const msg of assistantMessages) {
      // Check for agreement phrases
      for (const marker of AGREEMENT_MARKERS) {
        if (msg.content.includes(marker)) {
          // Extract the surrounding sentence as the insight
          const sentence = this.extractSentence(msg.content, marker);
          if (sentence) consensusSet.add(sentence);
        }
      }

      // Check for disagreement phrases
      for (const marker of DISAGREEMENT_MARKERS) {
        if (msg.content.includes(marker)) {
          const sentence = this.extractSentence(msg.content, marker);
          if (sentence) divergenceSet.add(sentence);
        }
      }
    }

    // ── Cross-reference panelist stances ─────────────────────
    // Compare each pair of stances for shared vs opposing keywords
    for (let i = 0; i < stanceTexts.length; i++) {
      for (let j = i + 1; j < stanceTexts.length; j++) {
        const shared = this.findSharedPhrases(stanceTexts[i], stanceTexts[j]);
        for (const phrase of shared) {
          if (phrase.length >= 4) consensusSet.add(`专家们均认为：${phrase}`);
        }
      }
    }

    // ── Build result with fallbacks ───────────────────────────
    const consensus = consensusSet.size > 0
      ? Array.from(consensusSet).slice(0, 3)
      : ["专家们均认可该话题的重要性"];

    const divergence = divergenceSet.size > 0
      ? Array.from(divergenceSet).slice(0, 3)
      : ["专家们在具体解决方案上存在不同看法"];

    return { consensus, divergence };
  }

  // ── Private helpers ─────────────────────────────────────────

  /**
   * Extract the sentence containing the marker from text.
   */
  private extractSentence(text: string, marker: string): string | null {
    const idx = text.indexOf(marker);
    if (idx === -1) return null;

    // Find sentence boundaries (Chinese punctuation)
    const start = Math.max(0, text.lastIndexOf("。", idx) + 1);
    let end = text.indexOf("。", idx);
    if (end === -1) end = text.length;

    const sentence = text.slice(start, end).trim();
    if (sentence.length < 4 || sentence.length > 100) return null;
    return sentence;
  }

  /**
   * Find shared multi-character phrases between two texts.
   */
  private findSharedPhrases(a: string, b: string): string[] {
    const shared: string[] = [];
    const minLen = 4;
    for (let i = 0; i <= a.length - minLen; i++) {
      const phrase = a.slice(i, i + minLen);
      if (b.includes(phrase) && phrase.trim().length >= minLen) {
        shared.push(phrase);
      }
    }
    return [...new Set(shared)];
  }
}
