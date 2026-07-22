import { Discussion } from "../domain/discussion.js";
import { Message } from "../domain/message.js";
import { Panelist } from "../domain/panelist.js";
import { AIMessage } from "./types.js";

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
