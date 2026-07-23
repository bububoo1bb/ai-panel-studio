import { Panelist } from "../domain/panelist.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { ReactionEvaluator, DesireScore, RAISE_HAND_THRESHOLD } from "./ReactionEvaluator.js";
import { SpeakingScheduler, SchedulingContext } from "./SpeakingScheduler.js";

/**
 * MVP dynamic speaker scheduler.
 *
 * Scores all active expert candidates using a {@link ReactionEvaluator},
 * filters by threshold, applies moderator overrides, and returns the
 * highest-scoring speaker — or null if nobody is ready.
 *
 * Respects a cooldown safeguard: the same panelist cannot speak in
 * two consecutive turns (enforced at the scheduler level).
 */
export class DesireBasedScheduler implements SpeakingScheduler {
  private readonly evaluator: ReactionEvaluator;
  private readonly panelistRepo: PanelistRepository;
  private readonly messageRepo: MessageRepository;
  private readonly discussionRepo: DiscussionRepository;

  /** Optional moderator override — a panelist ID to prioritize. */
  private moderatorOverride: string | null = null;

  constructor(deps: {
    evaluator: ReactionEvaluator;
    panelistRepository: PanelistRepository;
    messageRepository: MessageRepository;
    discussionRepository: DiscussionRepository;
  }) {
    this.evaluator = deps.evaluator;
    this.panelistRepo = deps.panelistRepository;
    this.messageRepo = deps.messageRepository;
    this.discussionRepo = deps.discussionRepository;
  }

  /**
   * Set a moderator override for the next selection.
   * The override boosts the specified panelist's score.
   */
  setModeratorOverride(panelistId: string | null): void {
    this.moderatorOverride = panelistId;
  }

  /**
   * Select the next expert to speak.
   *
   * 1. Load discussion + recent transcript
   * 2. Score all candidates via ReactionEvaluator
   * 3. Apply moderator override boost
   * 4. Filter by RAISE_HAND_THRESHOLD
   * 5. Return highest scorer, or null
   */
  async selectNextSpeaker(context: SchedulingContext): Promise<Panelist | null> {
    const { candidates } = context;

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // ── Load discussion for topic ───────────────────────────
    const discussion = await this.discussionRepo.findById(context.discussionId);

    // ── Load recent transcript if not provided ──────────────
    let recentTranscript = context.recentTranscript;
    if (recentTranscript.length === 0) {
      const messages = await this.messageRepo.findByDiscussionId(context.discussionId);
      recentTranscript = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
        panelistId: m.panelistId,
      }));
    }

    // ── Determine last speaker for cooldown ─────────────────
    const lastSpeakerId = [...recentTranscript]
      .reverse()
      .find((m) => m.panelistId !== null)?.panelistId ?? null;

    // ── Score all candidates ────────────────────────────────
    const scores: DesireScore[] = [];
    for (const candidate of candidates) {
      // Cooldown: skip the last speaker
      if (candidate.id === lastSpeakerId && candidates.length > 1) {
        continue;
      }

      const score = this.evaluator.evaluateDesire(candidate, {
        topic: discussion?.title ?? context.topic,
        turnCount: context.turnCount,
        recentTranscript,
        allCandidates: candidates,
      });

      // Moderator override: boost if this is the invited expert
      if (this.moderatorOverride === candidate.id) {
        score.score = Math.min(1, score.score + 0.3);
        if (score.threshold === "none") {
          score.threshold = "raise_hand";
        }
      }

      scores.push(score);
    }

    // ── Clear moderator override after use ──────────────────
    this.moderatorOverride = null;

    // ── Filter by threshold ────────────────────────────────
    const ready = scores.filter((s) => s.threshold !== "none");

    if (ready.length === 0) {
      // If nobody is above threshold but there are candidates,
      // pick the highest-scoring one anyway (avoid deadlock)
      if (scores.length === 0) {
        // All candidates were in cooldown; pick the last speaker again
        const fallback = candidates.find((c) => c.id === lastSpeakerId);
        return fallback ?? candidates[0];
      }
      scores.sort((a, b) => b.score - a.score);
      const best = scores[0];
      return candidates.find((c) => c.id === best.panelistId) ?? null;
    }

    // ── Sort by score descending, return highest ────────────
    ready.sort((a, b) => b.score - a.score);
    const winner = ready[0];
    return candidates.find((c) => c.id === winner.panelistId) ?? null;
  }
}
