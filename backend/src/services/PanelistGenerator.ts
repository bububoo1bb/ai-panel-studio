import { AIService } from "../ai/AIService.js";
import { buildPanelistGenerationMessages } from "../ai/PromptBuilder.js";
import { DiscussionRepository } from "../repositories/DiscussionRepository.js";
import { PanelistRepository } from "../repositories/PanelistRepository.js";
import { Panelist, CreatePanelistInput } from "../domain/panelist.js";
import {
  parsePanelistGenerationResponse,
  RawGeneratedPanelist,
} from "./parsePanelistGenerationResponse.js";

/**
 * Request shape for {@link PanelistGenerator.generate}.
 */
export interface GeneratePanelistsRequest {
  /** The discussion to generate panelists for. */
  discussionId: string;
  /** The topic / title of the discussion. */
  topic: string;
  /** Number of experts to generate (2–8). A host is always included. */
  expertCount: number;
}

/**
 * System-assigned color palette for panelist visual identity.
 *
 * Colors are assigned deterministically in order: host gets the first
 * color, experts get subsequent colors. The palette is intentionally
 * distinct and high-contrast for visual differentiation.
 */
const PANELIST_COLORS = [
  "#e0556a", // red
  "#5b9bd5", // blue
  "#4caf88", // green
  "#e2a83e", // amber
  "#9b7ed8", // purple
  "#e87d3e", // orange
  "#3dbfc9", // teal
  "#d67ba8", // pink
  "#6c8ebf", // steel blue
];

/**
 * Application-layer service that generates a moderator + expert panel
 * for a discussion using the LLM.
 *
 * Responsibilities:
 * - Validate discussion existence
 * - Validate expertCount bounds (2–8)
 * - Build AI prompt via {@link buildPanelistGenerationMessages}
 * - Call {@link AIService.generate}
 * - Parse and validate the JSON response
 * - Assign system colors to each panelist
 * - Persist all panelists via {@link PanelistRepository}
 * - Return the created panelist array
 *
 * PanelistGenerator depends only on abstractions (AIService,
 * DiscussionRepository, PanelistRepository). It does not call
 * RoundController, DiscussionController, or any route handler directly.
 */
export class PanelistGenerator {
  private readonly aiService: AIService;
  private readonly discussionRepo: DiscussionRepository;
  private readonly panelistRepo: PanelistRepository;

  constructor(deps: {
    aiService: AIService;
    discussionRepository: DiscussionRepository;
    panelistRepository: PanelistRepository;
  }) {
    this.aiService = deps.aiService;
    this.discussionRepo = deps.discussionRepository;
    this.panelistRepo = deps.panelistRepository;
  }

  /**
   * Generate a panel of 1 host + expertCount experts for a discussion.
   *
   * Execution order:
   * 1. Validate the discussion exists
   * 2. Validate expertCount (2–8)
   * 3. Build AI messages via PromptBuilder
   * 4. Call AIService.generate()
   * 5. Parse the JSON response
   * 6. Validate and convert each entry to CreatePanelistInput
   * 7. Assign system colors
   * 8. Persist each panelist
   * 9. Return all created Panelists
   *
   * @throws {Error} If the discussion doesn't exist, expertCount is invalid,
   *                 the AI response is unparseable, or any entry is malformed.
   */
  async generate(request: GeneratePanelistsRequest): Promise<Panelist[]> {
    const { discussionId, topic, expertCount } = request;

    // ── 1. Validate discussion ──────────────────────────────────
    const discussion = await this.discussionRepo.findById(discussionId);
    if (discussion === null) {
      throw new Error("Discussion not found");
    }

    // ── 2. Validate expertCount ─────────────────────────────────
    if (typeof expertCount !== "number") {
      throw new Error("expertCount must be a number");
    }
    if (!Number.isInteger(expertCount)) {
      throw new Error("expertCount must be an integer");
    }
    if (expertCount < 2 || expertCount > 8) {
      throw new Error("expertCount must be between 2 and 8");
    }

    // ── 3. Build AI messages ────────────────────────────────────
    const messages = buildPanelistGenerationMessages({ topic, expertCount });

    // ── 4. Call AIService ───────────────────────────────────────
    const response = await this.aiService.generate({ messages });

    // ── DEBUG: Log raw AI response before parsing ───────────────
    console.log("══════════ PANELIST GENERATION DEBUG ══════════");
    console.log("Topic:", topic);
    console.log("Expert count:", expertCount);
    console.log("AI model:", response.model);
    console.log("AI usage:", JSON.stringify(response.usage));
    console.log("--- RAW RESPONSE CONTENT (first 2000 chars) ---");
    console.log(response.content.slice(0, 2000));
    if (response.content.length > 2000) {
      console.log(
        `... (${response.content.length - 2000} more chars, showing last 500) ...`,
      );
      console.log(response.content.slice(-500));
    }
    console.log("--- RAW RESPONSE LENGTH:", response.content.length, "chars ---");
    console.log(
      "--- FIRST 200 BYTES (hex):",
      Buffer.from(response.content.slice(0, 200)).toString("hex"),
    );
    console.log("══════════ END DEBUG ══════════");

    // ── 5. Parse JSON response ──────────────────────────────────
    const rawPanelists = parsePanelistGenerationResponse(response.content);

    // ── 6. Validate & convert each entry ────────────────────────
    const inputs = rawPanelists.map((raw, index) =>
      this.validateAndConvert(raw, index, discussionId),
    );

    // ── 7. Assign system colors ─────────────────────────────────
    const coloredInputs = inputs.map((input, index) => ({
      ...input,
      color: PANELIST_COLORS[index % PANELIST_COLORS.length],
    }));

    // ── 8. Persist each panelist ────────────────────────────────
    const panelists: Panelist[] = [];
    for (const input of coloredInputs) {
      const panelist = await this.panelistRepo.create(input);
      panelists.push(panelist);
    }

    // ── 9. Return ───────────────────────────────────────────────
    return panelists;
  }

  // ── Internal helpers ──────────────────────────────────────────

  /**
   * Validate a raw AI-generated panelist entry and convert it to
   * a {@link CreatePanelistInput} (without color, which is system-assigned).
   *
   * @throws {Error} When any required field is missing or invalid.
   */
  private validateAndConvert(
    raw: RawGeneratedPanelist,
    index: number,
    discussionId: string,
  ): Omit<CreatePanelistInput, "color"> {
    const prefix = `Panelist[${index}]`;

    // role
    if (raw.role !== "host" && raw.role !== "expert") {
      throw new Error(
        `${prefix}: role must be "host" or "expert", got "${String(raw.role)}"`,
      );
    }

    // name
    if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
      throw new Error(
        `${prefix}: name must be a non-empty string`,
      );
    }

    // occupation
    if (typeof raw.occupation !== "string" || raw.occupation.trim().length === 0) {
      throw new Error(
        `${prefix}: occupation must be a non-empty string`,
      );
    }

    // title
    if (typeof raw.title !== "string" || raw.title.trim().length === 0) {
      throw new Error(
        `${prefix}: title must be a non-empty string`,
      );
    }

    // stance
    if (typeof raw.stance !== "string" || raw.stance.trim().length === 0) {
      throw new Error(
        `${prefix}: stance must be a non-empty string`,
      );
    }

    return {
      discussionId,
      role: raw.role,
      name: raw.name.trim(),
      occupation: raw.occupation.trim(),
      title: raw.title.trim(),
      stance: raw.stance.trim(),
    };
  }
}
