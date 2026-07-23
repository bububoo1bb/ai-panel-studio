import { Panelist } from "../domain/panelist.js";

/**
 * The result of evaluating one panelist's speaking desire.
 */
export interface DesireScore {
  /** The panelist being evaluated. */
  panelistId: string;
  /** 0.0 to 1.0 — higher means stronger desire to speak. */
  score: number;
  /** Which threshold was reached: "none", "raise_hand", or "interrupt". */
  threshold: "none" | "raise_hand" | "interrupt";
}

/**
 * Context needed to evaluate a panelist's speaking desire.
 */
export interface DesireContext {
  /** The discussion topic. */
  topic: string;
  /** How many expert turns have been executed so far. */
  turnCount: number;
  /** Recent transcript entries (last ~10 messages). */
  recentTranscript: Array<{
    role: "user" | "assistant";
    content: string;
    panelistId: string | null;
  }>;
  /** All active candidates for cross-reference. */
  allCandidates: Panelist[];
}

/** Thresholds for speaking desire levels. */
export const RAISE_HAND_THRESHOLD = 0.3;
export const INTERRUPT_THRESHOLD = 0.7;

/**
 * Evaluates how much an expert wants to speak given the current context.
 *
 * Implementations should be pure functions — no side effects, no AI calls.
 */
export interface ReactionEvaluator {
  /** Calculate 0-1 desire score for a panelist in this context. */
  evaluateDesire(panelist: Panelist, context: DesireContext): DesireScore;
}

// ═══════════════════════════════════════════════════════════════
// SimpleReactionEvaluator — MVP heuristic implementation
// ═══════════════════════════════════════════════════════════════

/** Extract Chinese keywords from text for comparison. */
function extractKeywords(text: string): Set<string> {
  const cleaned = text.replace(/[，。、；：！？\s]/g, "");
  // Split into 2-4 char segments as rough keywords
  const keywords = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i++) {
    keywords.add(cleaned.slice(i, i + 2));
    if (i + 3 <= cleaned.length) {
      keywords.add(cleaned.slice(i, i + 3));
    }
  }
  return keywords;
}

/** Compute Jaccard similarity between two sets. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

/**
 * MVP heuristic evaluator. Uses keyword-based analysis without AI calls.
 *
 * Factors (all weighted and normalized to 0-1):
 * 1. Stance conflict (35%) — how different is this panelist's stance
 *    from the last speaker's content?
 * 2. Wait time (25%) — how long since this panelist last spoke?
 * 3. Direct rebuttal target (20%) — does the last message mention
 *    this panelist's domain?
 * 4. Cooldown penalty — if just spoke, heavy multiplier (0.2x)
 * 5. Jitter — small random variation to break ties
 */
export class SimpleReactionEvaluator implements ReactionEvaluator {
  evaluateDesire(panelist: Panelist, context: DesireContext): DesireScore {
    // ── Get last speaker info ──────────────────────────────────
    const lastAssistantMsg = [...context.recentTranscript]
      .reverse()
      .find((m) => m.role === "assistant" && m.panelistId !== null);

    const isLastSpeaker =
      lastAssistantMsg !== undefined &&
      lastAssistantMsg.panelistId === panelist.id;

    // ── 1. Stance conflict (35%) ─────────────────────────────
    let conflictFactor = 0.5; // default neutral
    if (lastAssistantMsg && lastAssistantMsg.panelistId !== panelist.id) {
      const myKeywords = extractKeywords(panelist.stance + (panelist.beliefs ?? ""));
      const lastKeywords = extractKeywords(lastAssistantMsg.content);
      const similarity = jaccardSimilarity(myKeywords, lastKeywords);
      // Lower similarity = higher conflict = higher desire to rebut
      conflictFactor = 1 - similarity;
    }

    // ── 2. Wait time (25%) ──────────────────────────────────
    let waitFactor: number;
    if (panelist.speakCount === 0) {
      waitFactor = 0.9; // never spoken — eager to participate
    } else {
      // Higher speakCount relative to turnCount reduces desire
      const participationRatio = panelist.speakCount / Math.max(context.turnCount, 1);
      waitFactor = Math.max(0, 1 - participationRatio);
    }

    // ── 3. Direct rebuttal target (20%) ─────────────────────
    let rebuttalFactor = 0.3;
    if (lastAssistantMsg && lastAssistantMsg.panelistId !== panelist.id) {
      const nameLower = panelist.name.toLowerCase();
      const occupationKeywords = extractKeywords(panelist.occupation);
      const contentLower = lastAssistantMsg.content.toLowerCase();
      // Check if last message mentions this panelist's name or domain
      if (contentLower.includes(nameLower)) {
        rebuttalFactor = 0.9; // directly addressed
      } else {
        const contentKeywords = extractKeywords(lastAssistantMsg.content);
        const domainOverlap = jaccardSimilarity(occupationKeywords, contentKeywords);
        rebuttalFactor = 0.3 + domainOverlap * 0.6;
      }
    }

    // ── 4. Cooldown penalty ──────────────────────────────────
    const cooldownMultiplier = isLastSpeaker ? 0.15 : 1.0;

    // ── 5. Jitter (±0.08) ────────────────────────────────────
    const jitter = (Math.random() - 0.5) * 0.16;

    // ── Combine ──────────────────────────────────────────────
    const rawScore =
      conflictFactor * 0.35 +
      waitFactor * 0.25 +
      rebuttalFactor * 0.20 +
      (1 - (isLastSpeaker ? 1 : 0)) * 0.10; // anti-monopoly bonus

    const score = Math.max(0, Math.min(1, rawScore * cooldownMultiplier + jitter));

    // ── Threshold classification ──────────────────────────────
    let threshold: "none" | "raise_hand" | "interrupt";
    if (score >= INTERRUPT_THRESHOLD) {
      threshold = "interrupt";
    } else if (score >= RAISE_HAND_THRESHOLD) {
      threshold = "raise_hand";
    } else {
      threshold = "none";
    }

    return { panelistId: panelist.id, score, threshold };
  }
}
