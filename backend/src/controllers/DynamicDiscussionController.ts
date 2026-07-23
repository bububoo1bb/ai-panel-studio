import { RoundController } from "./RoundController.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { MessageRepository } from "../repositories/MessageRepository.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { SpeakingScheduler } from "../scheduling/SpeakingScheduler.js";
import { ModeratorController } from "../scheduling/ModeratorController.js";
import { Message } from "../domain/message.js";
import { DiscussionRoundExecutor } from "../services/DiscussionEngine.js";

/**
 * DynamicDiscussionController — replaces round-robin with desire-based
 * speaker selection and moderator-driven scheduling.
 *
 * Implements {@link DiscussionRoundExecutor} so it can be dropped into
 * {@link DiscussionEngine} without any engine changes.
 *
 * Each call to `executeDiscussion()` produces ONE expert message
 * (the dynamically-selected speaker), not a full round of all panelists.
 * This is intentional — the engine's loop now means "one speech per iteration"
 * rather than "one round-robin pass per iteration."
 */
export class DynamicDiscussionController implements DiscussionRoundExecutor {
  private readonly roundController: RoundController;
  private readonly panelistRepo: PanelistRepository;
  private readonly messageRepo: MessageRepository;
  private readonly discussionRepo: DiscussionRepository;
  private readonly scheduler: SpeakingScheduler;
  private readonly moderator: ModeratorController;

  /** Track the last turn when moderator intervened. */
  private lastInterventionTurn = -999; // far in the past so first intervention fires soon

  constructor(deps: {
    roundController: RoundController;
    panelistRepository: PanelistRepository;
    messageRepository: MessageRepository;
    discussionRepository: DiscussionRepository;
    scheduler: SpeakingScheduler;
    moderator: ModeratorController;
  }) {
    this.roundController = deps.roundController;
    this.panelistRepo = deps.panelistRepository;
    this.messageRepo = deps.messageRepository;
    this.discussionRepo = deps.discussionRepository;
    this.scheduler = deps.scheduler;
    this.moderator = deps.moderator;
  }

  /**
   * Execute one dynamic turn:
   *
   * 1. Load active candidates (scoped to discussionId only)
   * 2. Evaluate moderator actions
   * 3. Select next speaker via scheduler
   * 4. Update panelist status through state transitions
   * 5. Execute the turn via RoundController
   * 6. Update post-speech state
   *
   * @returns Array of Messages (typically 1, or 0 if nobody can speak).
   */
  async executeDiscussion(input: { discussionId: string }): Promise<Message[]> {
    const { discussionId } = input;

    // ── 1. Load candidates (scoped to discussionId) ──────────
    const panelists = await this.panelistRepo.findByDiscussionId(discussionId);
    const candidates = panelists.filter(
      (p) => p.status !== "finished" && p.role !== "host",
    );

    if (candidates.length === 0) return [];

    // ── 2. Load discussion ──────────────────────────────────
    const discussion = await this.discussionRepo.findById(discussionId);
    if (!discussion) throw new Error("Discussion not found");

    // ── 3. Load recent transcript ──────────────────────────
    const messages = await this.messageRepo.findByDiscussionId(discussionId);
    const recentTranscript = messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
      panelistId: m.panelistId,
    }));

    const turnCount = messages.filter(
      (m) => m.kind === "expert_statement" && m.panelistId !== null,
    ).length;

    // ── 4. Moderator evaluation ────────────────────────────
    const action = await this.moderator.evaluate(discussionId, messages, panelists);

    // Apply moderator overrides to scheduler
    if (action.type === "invite_speaker" && action.panelistId) {
      // Use type assertion for setModeratorOverride (implemented on DesireBasedScheduler)
      if ("setModeratorOverride" in this.scheduler) {
        (this.scheduler as { setModeratorOverride(id: string | null): void })
          .setModeratorOverride(action.panelistId);
      }
    }

    // ── 5. Select next speaker ─────────────────────────────
    const selected = await this.scheduler.selectNextSpeaker({
      discussionId,
      topic: discussion.title,
      candidates,
      turnCount,
      recentTranscript,
    });

    if (!selected) {
      // No one wants to speak — return empty (engine will check stop conditions)
      return [];
    }

    // ── 6. Status transitions ─────────────────────────────
    // raising_hand → preparing
    await this.panelistRepo.update(selected.id, {
      status: "raising_hand",
      currentFocus: "请求发言",
    });

    await this.panelistRepo.update(selected.id, {
      status: "preparing",
      currentFocus: "组织观点中",
    });

    // ── 7. Execute turn via RoundController ────────────────
    const message = await this.roundController.executeTurn({
      discussionId,
      panelistId: selected.id,
    });

    // ── 8. Post-speech update ─────────────────────────────
    const publicSummary =
      message.content.length > 50
        ? message.content.slice(0, 50) + "…"
        : message.content;

    await this.panelistRepo.update(selected.id, {
      status: "waiting",
      lastSpokeAt: new Date().toISOString(),
      speakCount: selected.speakCount + 1,
      currentFocus: null,
      publicSummary,
    });

    const resultMessages: Message[] = [message];

    // ── 9. Moderator intervention check ───────────────────
    const shouldIntervene = await this.moderator.shouldIntervene(
      discussionId,
      turnCount + 1,
      this.lastInterventionTurn,
    );

    if (shouldIntervene && action.type !== "none") {
      this.lastInterventionTurn = turnCount + 1;
      // The intervention message is NOT persisted here —
      // DiscussionSessionController handles moderator interventions
      // between round batches. This is just the scheduling signal.
    }

    return resultMessages;
  }
}
