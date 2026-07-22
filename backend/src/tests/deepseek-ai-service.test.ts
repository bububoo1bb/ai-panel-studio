import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeepSeekAIService } from "../ai/DeepSeekAIService.js";
import { GenerateAIRequest } from "../ai/types.js";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** A minimal valid request used across tests. */
function sampleRequest(overrides: Partial<GenerateAIRequest> = {}): GenerateAIRequest {
  return {
    messages: [{ role: "user", content: "Hello" }],
    ...overrides,
  };
}

/**
 * Create a minimal successful DeepSeek API response body.
 * Mirrors the shape of a real chat completion response.
 */
function successResponse(overrides: Partial<Record<string, unknown>> = {}): object {
  return {
    id: "chatcmpl-abc123",
    model: "deepseek-chat",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Hello! How can I assist you today?",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
    ...overrides,
  };
}

/** Create a Response-like object for fetch mocking. */
function mockResponse(body: object, status = 200, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  } as Response;
}

/** Spy on global fetch and return the mock so tests can assert call details. */
function mockFetch(response: Response) {
  const spy = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("DeepSeekAIService", () => {
  // Restore the real fetch after each test
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------------
  // Successful completion
  // ----------------------------------------------------------------
  describe("successful completion", () => {
    it("returns the AI-generated content", async () => {
      mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      const response = await service.generate(sampleRequest());

      expect(response.content).toBe("Hello! How can I assist you today?");
    });

    it("returns the model name from the API response", async () => {
      mockFetch(mockResponse(successResponse({ model: "deepseek-chat" })));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      const response = await service.generate(sampleRequest());

      expect(response.model).toBe("deepseek-chat");
    });

    it("returns usage statistics when present", async () => {
      mockFetch(
        mockResponse(
          successResponse({
            usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 },
          }),
        ),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      const response = await service.generate(sampleRequest());

      expect(response.usage).toEqual({
        promptTokens: 42,
        completionTokens: 17,
        totalTokens: 59,
      });
    });

    it("omits usage when the API response has no usage field", async () => {
      const body = successResponse();
      delete (body as Record<string, unknown>).usage;

      mockFetch(mockResponse(body));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      const response = await service.generate(sampleRequest());

      expect(response.usage).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // Empty content (explicit empty string is valid)
  // ----------------------------------------------------------------
  describe("empty content", () => {
    it("returns content: '' when the API returns an explicit empty string", async () => {
      mockFetch(
        mockResponse(
          successResponse({
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "" },
                finish_reason: "stop",
              },
            ],
          }),
        ),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      const response = await service.generate(sampleRequest());

      expect(response.content).toBe("");
    });
  });

  // ----------------------------------------------------------------
  // Invalid completion response (malformed 200)
  // ----------------------------------------------------------------
  describe("invalid completion response", () => {
    it("throws when choices array is empty", async () => {
      mockFetch(
        mockResponse({
          id: "chatcmpl-empty",
          model: "deepseek-chat",
          choices: [],
        }),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow(
        "DeepSeek API returned an invalid completion response",
      );
    });

    it("throws when choices is missing from the response", async () => {
      mockFetch(
        mockResponse({
          id: "chatcmpl-no-choices",
          model: "deepseek-chat",
        }),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow(
        "DeepSeek API returned an invalid completion response",
      );
    });

    it("throws when choices is null", async () => {
      mockFetch(
        mockResponse({
          id: "chatcmpl-null-choices",
          model: "deepseek-chat",
          choices: null,
        }),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow(
        "DeepSeek API returned an invalid completion response",
      );
    });

    it("throws when choices[0].message is missing", async () => {
      mockFetch(
        mockResponse({
          id: "chatcmpl-no-message",
          model: "deepseek-chat",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
            },
          ],
        }),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow(
        "DeepSeek API returned an invalid completion response",
      );
    });

    it("throws when choices[0].message.content is missing", async () => {
      mockFetch(
        mockResponse({
          id: "chatcmpl-no-content",
          model: "deepseek-chat",
          choices: [
            {
              index: 0,
              message: { role: "assistant" },
              finish_reason: "stop",
            },
          ],
        }),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow(
        "DeepSeek API returned an invalid completion response",
      );
    });

    it("throws when choices[0].message.content is not a string", async () => {
      mockFetch(
        mockResponse({
          id: "chatcmpl-number-content",
          model: "deepseek-chat",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: 42 },
              finish_reason: "stop",
            },
          ],
        }),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow(
        "DeepSeek API returned an invalid completion response",
      );
    });

    it("throws when content is null (not a string)", async () => {
      mockFetch(
        mockResponse({
          id: "chatcmpl-null-content",
          model: "deepseek-chat",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: null },
              finish_reason: "stop",
            },
          ],
        }),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow(
        "DeepSeek API returned an invalid completion response",
      );
    });
  });

  // ----------------------------------------------------------------
  // 401 error
  // ----------------------------------------------------------------
  describe("401 Unauthorized", () => {
    it("throws an Error for 401", async () => {
      mockFetch(
        mockResponse(
          { error: { message: "Invalid API key" } },
          401,
          "Unauthorized",
        ),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-bad-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow("DeepSeek API error: 401 Unauthorized");
    });
  });

  // ----------------------------------------------------------------
  // 403 error
  // ----------------------------------------------------------------
  describe("403 Forbidden", () => {
    it("throws an Error for 403", async () => {
      mockFetch(
        mockResponse(
          { error: { message: "Access denied" } },
          403,
          "Forbidden",
        ),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow("DeepSeek API error: 403 Forbidden");
    });
  });

  // ----------------------------------------------------------------
  // 429 error
  // ----------------------------------------------------------------
  describe("429 Too Many Requests", () => {
    it("throws an Error for 429", async () => {
      mockFetch(
        mockResponse(
          { error: { message: "Rate limit exceeded" } },
          429,
          "Too Many Requests",
        ),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow("DeepSeek API error: 429 Too Many Requests");
    });
  });

  // ----------------------------------------------------------------
  // 500 error
  // ----------------------------------------------------------------
  describe("500 Internal Server Error", () => {
    it("throws an Error for 500", async () => {
      mockFetch(
        mockResponse(
          { error: { message: "Internal server error" } },
          500,
          "Internal Server Error",
        ),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow("DeepSeek API error: 500 Internal Server Error");
    });

    it("throws an Error for 502 Bad Gateway", async () => {
      mockFetch(
        mockResponse({ error: { message: "Bad gateway" } }, 502, "Bad Gateway"),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow("DeepSeek API error: 502 Bad Gateway");
    });

    it("throws an Error for 503 Service Unavailable", async () => {
      mockFetch(
        mockResponse(
          { error: { message: "Service unavailable" } },
          503,
          "Service Unavailable",
        ),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow("DeepSeek API error: 503 Service Unavailable");
    });
  });

  // ----------------------------------------------------------------
  // Network failure
  // ----------------------------------------------------------------
  describe("network failure", () => {
    it("throws an Error when fetch rejects", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Connection refused")),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow(
        "DeepSeek API network error: Connection refused",
      );
    });

    it("handles non-Error rejections", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue("timeout"));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await expect(
        service.generate(sampleRequest()),
      ).rejects.toThrow("DeepSeek API network error: timeout");
    });
  });

  // ----------------------------------------------------------------
  // Request mapping
  // ----------------------------------------------------------------
  describe("request mapping", () => {
    it("sends the correct HTTP method and URL", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await service.generate(sampleRequest());

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
      expect(init?.method).toBe("POST");
    });

    it("uses a custom baseUrl when provided", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
        baseUrl: "https://custom-proxy.example.com/v1",
      });

      await service.generate(sampleRequest());

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://custom-proxy.example.com/v1/chat/completions");
    });

    it("strips a single trailing slash from baseUrl", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1/",
      });

      await service.generate(sampleRequest());

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    });

    it("strips multiple trailing slashes from baseUrl", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1///",
      });

      await service.generate(sampleRequest());

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    });

    it("sets the Authorization header with the API key", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-my-secret-key",
        model: "deepseek-chat",
      });

      await service.generate(sampleRequest());

      const [, init] = fetchSpy.mock.calls[0];
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer sk-my-secret-key",
      });
    });

    it("includes Content-Type application/json header", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await service.generate(sampleRequest());

      const [, init] = fetchSpy.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("maps AIMessage[] into the request body messages", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await service.generate(
        sampleRequest({
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "What is TypeScript?" },
            { role: "assistant", content: "A typed superset of JavaScript." },
            { role: "user", content: "Tell me more." },
          ],
        }),
      );

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init!.body as string);

      expect(body.messages).toHaveLength(4);
      expect(body.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant.",
      });
      expect(body.messages[1]).toEqual({
        role: "user",
        content: "What is TypeScript?",
      });
      expect(body.messages[2]).toEqual({
        role: "assistant",
        content: "A typed superset of JavaScript.",
      });
      expect(body.messages[3]).toEqual({
        role: "user",
        content: "Tell me more.",
      });
    });

    it("includes the model in the request body", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-reasoner",
      });

      await service.generate(sampleRequest());

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe("deepseek-reasoner");
    });

    it("includes temperature when provided", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await service.generate(sampleRequest({ temperature: 0.7 }));

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init!.body as string);
      expect(body.temperature).toBe(0.7);
    });

    it("omits temperature when not provided", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await service.generate(sampleRequest({ temperature: undefined }));

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init!.body as string);
      expect(body).not.toHaveProperty("temperature");
    });

    it("includes max_tokens when maxTokens is provided", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await service.generate(sampleRequest({ maxTokens: 2048 }));

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init!.body as string);
      expect(body.max_tokens).toBe(2048);
    });

    it("omits max_tokens when not provided", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await service.generate(sampleRequest({ maxTokens: undefined }));

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init!.body as string);
      expect(body).not.toHaveProperty("max_tokens");
    });
  });

  // ----------------------------------------------------------------
  // Response mapping
  // ----------------------------------------------------------------
  describe("response mapping", () => {
    it("maps the API content field correctly", async () => {
      mockFetch(
        mockResponse(
          successResponse({
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "Carbon pricing is an effective market-based mechanism.",
                },
                finish_reason: "stop",
              },
            ],
          }),
        ),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      const response = await service.generate(sampleRequest());

      expect(response.content).toBe(
        "Carbon pricing is an effective market-based mechanism.",
      );
    });

    it("maps the API model field correctly", async () => {
      mockFetch(mockResponse(successResponse({ model: "deepseek-chat-v2" })));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      const response = await service.generate(sampleRequest());

      expect(response.model).toBe("deepseek-chat-v2");
    });

    it("maps usage fields from snake_case to camelCase", async () => {
      mockFetch(
        mockResponse(
          successResponse({
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
          }),
        ),
      );

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      const response = await service.generate(sampleRequest());

      expect(response.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
    });
  });

  // ----------------------------------------------------------------
  // Constructor — defaults
  // ----------------------------------------------------------------
  describe("constructor", () => {
    it("defaults baseUrl to the DeepSeek v1 API endpoint", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-test-key",
        model: "deepseek-chat",
      });

      await service.generate(sampleRequest());

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    });

    it("accepts all configuration options", async () => {
      const fetchSpy = mockFetch(mockResponse(successResponse()));

      const service = new DeepSeekAIService({
        apiKey: "sk-custom",
        model: "deepseek-reasoner",
        baseUrl: "https://api.example.com",
      });

      await service.generate(sampleRequest());

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.example.com/chat/completions");

      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-custom");

      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe("deepseek-reasoner");
    });
  });
});
