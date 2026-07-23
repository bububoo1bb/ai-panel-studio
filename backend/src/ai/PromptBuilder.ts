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
    "- beliefs: core convictions driving this expert, 1-2 sentences (Chinese) — for experts only",
    "- concerns: specific worries or fears about the topic, 1-2 sentences (Chinese) — for experts only",
    '- argumentStyle: debate style, one of "数据驱动","激进反驳","温和建设","质疑批判","实践经验" (Chinese) — for experts only',
    "",
    "Requirements:",
    "- The host must be neutral, skilled at facilitation,",
    '  with stance "中立，引导讨论深入"',
    "- Experts must represent genuinely different perspectives on the topic",
    "- Each expert's stance must be distinct — avoid overlapping positions",
    "- 至少2组专家之间存在直接对立的立场——确保讨论有真实的观点碰撞",
    "- Names must be realistic Chinese names (2-3 characters for given name)",
    "- Occupations and titles must be specific, not generic",
    "- All text must be in Chinese",
    "",
    "Example output format:",
    '[{"role":"host","name":"林澜","occupation":"主持人","title":"圆桌讨论主持人","stance":"中立，引导讨论深入"},{"role":"expert","name":"张明远","occupation":"经济学家","title":"宏观经济学家","stance":"支持市场化解决方案推动产业升级","beliefs":"市场机制是最有效的资源配置方式","concerns":"政府过度干预可能导致效率下降","argumentStyle":"数据驱动"}]',
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
/**
 * Discussion context injected into every panelist's system prompt.
 * Prevents hallucinated experts, invented stances, and references
 * to panelists who haven't spoken yet.
 */
export interface DiscussionAgentContext {
  /** Names of all participants (host + experts). */
  participants: string[];
  /** Names of experts who have already spoken. */
  spokenExperts: string[];
  /** Name of the last speaker (null if nobody has spoken yet). */
  lastSpeaker: string | null;
  /** Current stances of all experts (name → stance). */
  currentStances: Record<string, string>;
}

export function buildPanelistSystemPrompt(
  panelist: Panelist,
  agentContext?: DiscussionAgentContext,
): string {
  const lines = [
    `你是${panelist.name}，一名${panelist.role === "host" ? "主持人" : "圆桌讨论专家"}。`,
    "",
    `- 职业领域：${panelist.occupation}`,
    `- 职务/身份：${panelist.title}`,
    `- 立场：${panelist.stance}`,
  ];

  if (panelist.role === "expert") {
    if (panelist.beliefs) lines.push(`- 核心信念：${panelist.beliefs}`);
    if (panelist.concerns) lines.push(`- 关注问题：${panelist.concerns}`);
    if (panelist.argumentStyle) lines.push(`- 辩论风格：${panelist.argumentStyle}`);
  }

  // ── Agent Context Memory (M16.8) ─────────────────────────────
  if (agentContext) {
    lines.push("");
    lines.push("当前讨论状态：");
    lines.push(`- 参与专家：${agentContext.participants.join("、")}`);
    if (agentContext.spokenExperts.length > 0) {
      lines.push(`- 已发言专家：${agentContext.spokenExperts.join("、")}`);
    }
    if (agentContext.lastSpeaker) {
      lines.push(`- 上一位发言者：${agentContext.lastSpeaker}`);
    }
    lines.push("");
    lines.push("禁止事项：");
    lines.push("- 禁止引用未发言专家的观点（他们还没有机会表达立场）");
    lines.push("- 禁止创造不存在的讨论参与者");
    lines.push("- 禁止假设其他专家持有他们没有表达过的观点");
  }

  lines.push(
    "",
    "发言要求（非常重要——这是圆桌讨论，不是论文答辩）：",
    "- 每次发言严格1-2句话，30-80个中文字符，最多不超过150字符",
    "- 你不是在写文章——你是在真人圆桌前脱口而出",
    "- 必须针对上一位发言者的核心观点进行直接回应（支持/补充/质疑/反驳）",
    "- 保持鲜明的个人立场，不要'一方面...另一方面...'式的和稀泥",
    "- 用口语化的语气表达专业观点",
    "- 除首次发言外，禁止重复自我介绍——大家已经知道你是谁了",
    "- 直接进入观点，不要以'我是XXX'或'作为XXX'开头",
    "- 禁止任何动作描写（推眼镜、沉思、笑、点头、清嗓子）",
    "- 禁止\"第一第二第三\"、\"综上所述\"、\"总而言之\"等论文结构",
    "- 禁止输出你的内部推理过程——只输出你的公开发言",
  );

  return lines.join("\n");
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
  agentContext?: DiscussionAgentContext;
}): AIMessage[] {
  const { discussion, panelist, messages, agentContext } = input;

  const result: AIMessage[] = [];

  // 1. System message
  result.push({
    role: "system",
    content: buildPanelistSystemPrompt(panelist, agentContext),
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

// ═══════════════════════════════════════════════════════════════
// Moderator Intervention Prompts (M16.5)
// ═══════════════════════════════════════════════════════════════

/**
 * Build the system prompt for the moderator's mid-discussion intervention.
 *
 * The prompt instructs the moderator to bridge between rounds of expert
 * discussion — highlighting emerging themes, noting disagreements, and
 * guiding the conversation toward productive exploration.
 */
export function buildModeratorInterventionPrompt(input: {
  hostName: string;
  hostTitle: string;
  topic: string;
}): string {
  return [
    `你是${input.hostName}，${input.hostTitle}，本次圆桌讨论的主持人。`,
    "",
    `关于"${input.topic}"的讨论正在进行中。`,
    "",
    "你的任务：在专家们进行了几轮发言后，进行一次简短的中场干预。",
    "",
    "要求：",
    "- 简要总结刚才讨论中浮现的关键主题和立场分歧",
    "- 你的职责是发现分歧、邀请不同观点的专家回应、控制讨论节奏",
    "- 如果某位专家长时间未发言，主动邀请其参与",
    "- 如果两位专家观点对立，请他们分别阐述立场",
    "- 保持中立——不要选边站队",
    "- 控制在2-4句话，精炼有力",
    "- 只输出你的公开干预发言——不要暴露任何内部推理过程",
    "- 用口语化的方式表达——像真人主持人在引导讨论",
  ].join("\n");
}

/**
 * Build the AI message list for the moderator's mid-discussion intervention.
 *
 * Returns an array with one system message (the intervention instructions)
 * and the full conversation history so the moderator can reference recent
 * exchanges.
 */
export function buildModeratorInterventionMessages(input: {
  hostName: string;
  hostTitle: string;
  topic: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
}): AIMessage[] {
  const result: AIMessage[] = [
    {
      role: "system",
      content: buildModeratorInterventionPrompt(input),
    },
  ];

  // Include recent conversation history so the moderator can reference
  // specific expert statements
  for (const msg of input.recentMessages) {
    result.push({
      role: msg.role,
      content: msg.content,
    });
  }

  return result;
}
