import { AIService } from "./AIService.js";
import { GenerateAIRequest, GenerateAIResponse } from "./types.js";

/** Configuration options for MockAIService. */
export interface MockAIServiceOptions {
  /** The content returned by every generate() call. Defaults to "Mock AI response". */
  content?: string;
  /** The model name returned in the response. Defaults to "mock-ai". */
  model?: string;
  /** Optional usage statistics included in the response. */
  usage?: GenerateAIResponse["usage"];
}

/**
 * A deterministic, in-memory AIService implementation for testing.
 *
 * Every call to generate() returns the configured (or default) response
 * immediately — no network, no delay, no randomness.
 *
 * All requests are recorded so that tests can inspect call history.
 */
export class MockAIService implements AIService {
  private readonly defaultContent: string;
  private readonly defaultModel: string;
  private readonly defaultUsage: GenerateAIResponse["usage"];
  private readonly requests: GenerateAIRequest[] = [];

  constructor(options: MockAIServiceOptions = {}) {
    this.defaultContent = options.content ?? "Mock AI response";
    this.defaultModel = options.model ?? "mock-ai";
    this.defaultUsage = options.usage;
  }

  /** Return a resolved GenerateAIResponse using configured defaults. */
  async generate(request: GenerateAIRequest): Promise<GenerateAIResponse> {
    // Record a defensive copy of the request before returning
    this.requests.push(this.copyRequest(request));

    return {
      content: this.defaultContent,
      model: this.defaultModel,
      usage: this.defaultUsage,
    };
  }

  /**
   * Return a defensive copy of every recorded request.
   *
   * The returned array is a new array and each request + its messages are
   * deep-copied so that callers cannot mutate the internal history.
   */
  getRequests(): GenerateAIRequest[] {
    return this.requests.map((r) => this.copyRequest(r));
  }

  /** Clear all recorded request history. */
  clearRequests(): void {
    this.requests.length = 0;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /** Create a defensive deep copy of a GenerateAIRequest. */
  private copyRequest(request: GenerateAIRequest): GenerateAIRequest {
    return {
      messages: request.messages.map((m) => ({ ...m })),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    };
  }
}
