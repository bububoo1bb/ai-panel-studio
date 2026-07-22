/** The role of a message in an AI conversation. */
export type AIMessageRole = "system" | "user" | "assistant";

/** A single message in an AI conversation. */
export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

/** Parameters for an AI text-generation request. */
export interface GenerateAIRequest {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
}

/** The result of an AI text-generation request. */
export interface GenerateAIResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}
