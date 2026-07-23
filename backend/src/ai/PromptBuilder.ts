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

// ═══════════════════════════════════════════════════════════════
// Moderator Prompts (M16)
// ═══════════════════════════════════════════════════════════════

/**
 * Build the system prompt for the moderator's opening statement.
 *
 * The prompt instructs the AI to deliver a professional opening from
 * the host panelist's perspective, welcoming experts, framing the topic,
 * and setting a constructive tone — without expressing a personal position.
 */
export function buildModeratorOpeningPrompt(input: {
  hostName: string;
  hostTitle: string;
  topic: string;
  expertNames: string[];
}): string {
  const expertList = input.expertNames.join("、");
  return [
    `你是${input.hostName}，${input.hostTitle}，本次圆桌讨论的主持人。`,
    "",
    "你的任务：以主持人的身份，专业地开启本场讨论。",
    "",
    "要求：",
    `- 欢迎各位专家：${expertList}`,
    `- 简要重申讨论主题："${input.topic}"`,
    "- 阐述为什么这个话题值得深入探讨",
    "- 设定建设性、理性严谨的讨论基调",
    "- 不要表达你自己对这个话题的立场——你必须保持中立",
    "- 开场白控制在3-5句话",
    "- 只输出你的公开开场白——不要暴露任何内部推理过程",
  ].join("\n");
}

/**
 * Build the system prompt for the moderator's closing statement.
 *
 * The prompt instructs the AI to deliver a professional closing from
 * the host panelist's perspective, thanking experts, summarizing key
 * perspectives, and noting areas of agreement and productive disagreement.
 */
export function buildModeratorClosingPrompt(input: {
  hostName: string;
  hostTitle: string;
  topic: string;
}): string {
  return [
    `你是${input.hostName}，${input.hostTitle}，本次圆桌讨论的主持人。`,
    "",
    `关于"${input.topic}"的讨论即将结束。`,
    "",
    "你的任务：以主持人的身份，专业地结束本场讨论。",
    "",
    "要求：",
    "- 感谢各位专家的贡献",
    "- 简要总结讨论中提出的关键视角和观点",
    "- 指出已形成的共识和富有建设性的分歧",
    "- 不要引入新的论点，也不要选边站队",
    "- 收尾语控制在3-5句话",
    "- 只输出你的公开收尾语——不要暴露任何内部推理过程",
  ].join("\n");
}

/**
 * Build the AI message list for the moderator's opening statement.
 *
 * Returns an array with one system message (the opening instructions).
 * The returned messages are provider-independent and ready to pass to
 * {@link AIService.generate}.
 */
export function buildModeratorOpeningMessages(input: {
  hostName: string;
  hostTitle: string;
  topic: string;
  expertNames: string[];
}): AIMessage[] {
  return [
    {
      role: "system",
      content: buildModeratorOpeningPrompt(input),
    },
  ];
}

/**
 * Build the AI message list for the moderator's closing statement.
 *
 * Returns an array with one system message (the closing instructions).
 * The returned messages are provider-independent and ready to pass to
 * {@link AIService.generate}.
 */
export function buildModeratorClosingMessages(input: {
  hostName: string;
  hostTitle: string;
  topic: string;
}): AIMessage[] {
  return [
    {
      role: "system",
      content: buildModeratorClosingPrompt(input),
    },
  ];
}
