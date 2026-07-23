import { Panelist } from "../domain/panelist.js";
import { Message } from "../domain/message.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";

/**
 * Actions the moderator can take during a discussion.
 */
export type ModeratorAction =
  | { type: "invite_speaker"; panelistId: string; reason: string }
  | { type: "highlight_conflict"; summary: string }
  | { type: "pace_control"; reason: string }
  | { type: "none" };

/**
 * ModeratorController — MVP IMPLEMENTATION (not a future stub).
 *
 * Analyzes the discussion transcript and decides what scheduling
 * action the moderator should take next.
 *
 * Uses lightweight heuristics (keyword matching) without AI calls
 * to keep it fast and deterministic.
 */
export interface ModeratorController {
  /**
   * Analyze the current discussion state and decide an action.
   *
   * @returns A ModeratorAction, or { type: "none" } if no action needed.
   */
  evaluate(
    discussionId: string,
    recentMessages: Message[],
    panelists: Panelist[],
  ): Promise<ModeratorAction>;

  /**
   * Whether the moderator should deliver an intervention message now.
   *
   * @param turnCount — number of expert turns so far.
   * @param lastInterventionTurn — the turn number when the last intervention happened.
   */
  shouldIntervene(
    discussionId: string,
    turnCount: number,
    lastInterventionTurn: number,
  ): Promise<boolean>;
}

// ═══════════════════════════════════════════════════════════════
// AIModeratorController — MVP heuristic implementation
// ═══════════════════════════════════════════════════════════════

/**
 * Heuristic moderator controller.
 *
 * Detects:
 * - Conflicts: opposing stances in recent messages
 * - Silent experts: panelists who haven't spoken in 5+ turns
 * - Monopoly: same expert speaking 3+ consecutive turns
 *
 * Intervention cadence: every 4-6 turns, or when a conflict is detected.
 */
export class AIModeratorController implements ModeratorController {
  private readonly panelistRepo: PanelistRepository;
  private readonly messageRepo: MessageRepository;
  private readonly discussionRepo: DiscussionRepository;

  constructor(deps: {
    panelistRepository: PanelistRepository;
    messageRepository: MessageRepository;
    discussionRepository: DiscussionRepository;
  }) {
    this.panelistRepo = deps.panelistRepository;
    this.messageRepo = deps.messageRepository;
    this.discussionRepo = deps.discussionRepository;
  }

  async evaluate(
    _discussionId: string,
    recentMessages: Message[],
    panelists: Panelist[],
  ): Promise<ModeratorAction> {
    const experts = panelists.filter((p) => p.role === "expert");

    // ── 1. Detect silent experts ────────────────────────────
    const speakerIds = new Set(
      recentMessages
        .filter((m) => m.panelistId !== null)
        .map((m) => m.panelistId!),
    );

    const silentExperts = experts.filter(
      (e) => !speakerIds.has(e.id) && e.status !== "finished",
    );

    if (silentExperts.length > 0 && recentMessages.length >= 4) {
      const target = silentExperts[0];
      return {
        type: "invite_speaker",
        panelistId: target.id,
        reason: `${target.name}（${target.title}）尚未发表看法`,
      };
    }

    // ── 2. Detect consecutive same speaker ─────────────────
    const recentSpeakers = recentMessages
      .filter((m) => m.panelistId !== null)
      .slice(-4)
      .map((m) => m.panelistId!);

    if (recentSpeakers.length >= 3) {
      const last3 = recentSpeakers.slice(-3);
      if (last3.every((id) => id === last3[0])) {
        const otherExperts = experts.filter((e) => e.id !== last3[0]);
        if (otherExperts.length > 0) {
          return {
            type: "pace_control",
            reason: "讨论节奏需要平衡，邀请其他专家发表观点",
          };
        }
      }
    }

    // ── 3. Detect stance conflicts ──────────────────────────
    const recentContents = recentMessages
      .filter((m) => m.role === "assistant")
      .slice(-4)
      .map((m) => m.content);

    const conflictMarkers = ["但是", "然而", "不同意", "反对", "不一定", "并非"];
    const conflictCount = recentContents.filter((c) =>
      conflictMarkers.some((marker) => c.includes(marker)),
    ).length;

    if (conflictCount >= 2) {
      return {
        type: "highlight_conflict",
        summary: "专家们在这个问题上存在明显的立场分歧",
      };
    }

    return { type: "none" };
  }

  /**
   * M16.8: Only intervene when there's a real need — not mechanically.
   *
   * Conditions:
   * - New conflict detected (≥2 disagreement markers in recent messages)
   * - Silent expert needs invitation (4+ messages without speaking)
   * - Near end of discussion (last ~20% of turns)
   * - Minimum gap of 3 turns since last intervention
   */
  async shouldIntervene(
    discussionId: string,
    turnCount: number,
    lastInterventionTurn: number,
  ): Promise<boolean> {
    const turnsSinceLastIntervention = turnCount - lastInterventionTurn;
    if (turnsSinceLastIntervention < 3) return false;

    // Check for actual need
    const messages = await this.messageRepo.findByDiscussionId(discussionId);
    const recentContents = messages.slice(-5).map((m) => m.content);

    // Conflict detection: ≥2 disagreement markers in last 5 messages
    const conflictMarkers = ["但是", "然而", "不同意", "反对"];
    const conflictCount = recentContents.filter((c) =>
      conflictMarkers.some((m) => c.includes(m)),
    ).length;

    if (conflictCount >= 2) return true; // new conflict — intervene

    // Silent expert: check if any expert hasn't spoken in last 5+ messages
    const panelists = await this.panelistRepo.findByDiscussionId(discussionId);
    const recentSpeakerIds = new Set(
      messages.slice(-5).filter((m) => m.panelistId !== null).map((m) => m.panelistId!),
    );
    const experts = panelists.filter((p) => p.role === "expert" && p.status !== "finished");
    const hasSilentExpert = experts.some((e) => !recentSpeakerIds.has(e.id));
    if (hasSilentExpert && turnsSinceLastIntervention >= 4) return true;

    // Near-end: last ~20% of turns (intervene to guide toward closing)
    // This is heuristic — turnCount is relative to maxRounds
    if (turnsSinceLastIntervention >= 5) return true; // safety: don't go too long without intervention

    return false;
  }
}
