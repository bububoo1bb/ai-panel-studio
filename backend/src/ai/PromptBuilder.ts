import { Discussion } from "../domain/discussion.js";
import { Message } from "../domain/message.js";
import { Panelist } from "../domain/panelist.js";
import { AIMessage } from "./types.js";

// ═══════════════════════════════════════════════════════════════
// Panelist Generation Prompts
// ═══════════════════════════════════════════════════════════════

/** System prompt that instructs the AI to generate a diverse panel in JSON. */
export function buildPanelistGenerationSystemPrompt(): string {
  return [
    "You are a roundtable discussion producer.",
    "Given a discussion topic and the number of experts requested,",
    "generate a diverse panel consisting of 1 moderator (host) and",
    "the requested number of experts.",
    "",
    "Output ONLY valid JSON — no markdown fences, no commentary,",
    "no surrounding text, no trailing commas.",
    "",
    "The JSON must be an array of objects, each with these exact keys:",
    '- role: "host" or "expert"',
    "- name: full Chinese name",
    "- occupation: profession or field (Chinese)",
    "- title: specific job title or role description (Chinese)",
    "- stance: concise statement of their position on the topic, 1 sentence (Chinese)",
    "",
    "Requirements:",
    "- The host must be neutral, skilled at facilitation,",
    '  with stance "中立，引导讨论深入"',
    "- Experts must represent genuinely different perspectives on the topic",
    "- Each expert's stance must be distinct — avoid overlapping positions",
    "- Names must be realistic Chinese names (2-3 characters for given name)",
    "- Occupations and titles must be specific, not generic",
    "- All text must be in Chinese",
    "",
    "Example output format:",
    '[{"role":"host","name":"林澜","occupation":"主持人","title":"圆桌讨论主持人","stance":"中立，引导讨论深入"},{"role":"expert","name":"张明远","occupation":"经济学家","title":"宏观经济学家","stance":"支持市场化解决方案推动产业升级"}]',
  ].join("\n");
}

/**
 * Build the AI message list for generating a panel of experts.
 *
 * Returns:
 * 1. One system message (generation instructions).
 * 2. One user message with the topic and expert count.
 */
export function buildPanelistGenerationMessages(input: {
  topic: string;
  expertCount: number;
}): AIMessage[] {
  return [
    {
      role: "system",
      content: buildPanelistGenerationSystemPrompt(),
    },
    {
      role: "user",
      content: [
        `Discussion topic: ${input.topic}`,
        `Number of experts: ${input.expertCount}`,
        "",
        "Generate 1 host and the requested number of experts.",
        "Return ONLY the JSON array — no other text.",
      ].join("\n"),
    },
  ];
}

// ═══════════════════════════════════════════════════════════════
// Panelist Discussion Prompts
// ═══════════════════════════════════════════════════════════════

/**
 * Construct a deterministic system prompt for a panelist.
 *
 * The prompt instructs the model to respond from the panelist's assigned
 * professional perspective while adhering to behavioural constraints.
 */
export function buildPanelistSystemPrompt(panelist: Panelist): string {
  return [
    `You are ${panelist.name}, a ${panelist.role === "host" ? "moderator" : "panel expert"} in a roundtable discussion.`,
    "",
    `- Occupation: ${panelist.occupation}`,
    `- Title: ${panelist.title}`,
    `- Stance: ${panelist.stance}`,
    "",
    "Behavioural requirements:",
    "- Respond from your assigned professional perspective.",
    "- Maintain your stated stance consistently.",
    "- Engage directly with the discussion topic and prior messages.",
    "- Be concise and substantive.",
    "- Do not fabricate facts; openly acknowledge uncertainty when appropriate.",
    "- Output only your public response — never reveal private chain-of-thought,",
    "  hidden reasoning, or internal analysis.",
  ].join("\n");
}

/**
 * Build the ordered AI message list for a panelist in a discussion.
 *
 * The returned array consists of:
 * 1. One system message (produced by {@link buildPanelistSystemPrompt}).
 * 2. One user message presenting the discussion topic.
 * 3. Zero or more conversation messages converted from the domain Message list.
 *
 * Domain messages are mapped by role ("user" → "user", "assistant" → "assistant"),
 * preserve their original insertion order, and are not mutated.
 */
export function buildPanelistMessages(input: {
  discussion: Discussion;
  panelist: Panelist;
  messages: Message[];
}): AIMessage[] {
  const { discussion, panelist, messages } = input;

  const result: AIMessage[] = [];

  // 1. System message
  result.push({
    role: "system",
    content: buildPanelistSystemPrompt(panelist),
  });

  // 2. Discussion topic
  result.push({
    role: "user",
    content: `Discussion topic:\n${discussion.title}`,
  });

  // 3. Conversation history (preserving insertion order)
  for (const msg of messages) {
    result.push({
      role: msg.role, // "user" or "assistant" — already matches AIMessageRole
      content: msg.content,
    });
  }

  return result;
}
