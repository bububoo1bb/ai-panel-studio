import { AIService } from "./AIService.js";
import { AIMessage, GenerateAIRequest, GenerateAIResponse } from "./types.js";

/**
 * Configuration options for DeepSeekAIService.
 *
 * `apiKey` and `model` are required.
 * `baseUrl` defaults to the DeepSeek v1 API endpoint.
 */
export interface DeepSeekAIServiceOptions {
  /** DeepSeek API key (never hardcoded — inject via env var at startup). */
  apiKey: string;
  /** Model identifier e.g. "deepseek-chat" or "deepseek-reasoner". */
  model: string;
  /** Optional base URL override. Defaults to "https://api.deepseek.com/v1". */
  baseUrl?: string;
}

/**
 * Production AIService implementation backed by the DeepSeek Chat Completion API.
 *
 * Conforms to the provider-independent {@link AIService} interface.
 * Converts application-layer {@link AIMessage} arrays into the DeepSeek
 * request shape, calls the HTTP API, and maps the response back into a
 * {@link GenerateAIResponse}.
 *
 * Errors (401, 403, 429, 5xx, network failures) are thrown as `Error`
 * without retry.
 */
export class DeepSeekAIService implements AIService {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: DeepSeekAIServiceOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com/v1").replace(/\/+$/, "");
  }

  /**
   * Send a text-generation request to the DeepSeek API and return the
   * mapped response.
   *
   * @throws {Error} On HTTP 401, 403, 429, 5xx, or network failure.
   */
  async generate(request: GenerateAIRequest): Promise<GenerateAIResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body = this.buildRequestBody(request);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `DeepSeek API network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `DeepSeek API error: ${response.status} ${response.statusText}`.trim(),
      );
    }

    const data = (await response.json()) as DeepSeekChatCompletionResponse;

    return this.mapResponse(data);
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /** Build the DeepSeek chat completion request body from the app request. */
  private buildRequestBody(request: GenerateAIRequest): DeepSeekChatCompletionRequest {
    const body: DeepSeekChatCompletionRequest = {
      model: this.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }

    return body;
  }

  /** Map the DeepSeek API response into the provider-independent shape. */
  private mapResponse(data: DeepSeekChatCompletionResponse): GenerateAIResponse {
    // Validate the completion structure.  An explicit empty-string content
    // is valid — only missing / non-string content triggers an error.
    if (
      !Array.isArray(data.choices) ||
      data.choices.length === 0 ||
      !data.choices[0].message ||
      typeof data.choices[0].message.content !== "string"
    ) {
      throw new Error("DeepSeek API returned an invalid completion response");
    }

    const content = data.choices[0].message.content;

    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined;

    return {
      content,
      model: data.model,
      usage,
    };
  }
}

// ------------------------------------------------------------------
// DeepSeek API contract types (internal to this module)
// ------------------------------------------------------------------

interface DeepSeekChatCompletionRequest {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
}

interface DeepSeekChatCompletionResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
