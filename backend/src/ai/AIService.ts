import { GenerateAIRequest, GenerateAIResponse } from "./types.js";

/**
 * Provider-independent abstraction for AI text generation.
 *
 * Implementations may wrap any LLM provider (DeepSeek, Anthropic, OpenAI, …)
 * without changing the application layer.
 */
export interface AIService {
  /** Send a text-generation request and return the model response. */
  generate(request: GenerateAIRequest): Promise<GenerateAIResponse>;
}
