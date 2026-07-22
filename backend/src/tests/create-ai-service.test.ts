import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAIService } from "../ai/createAIService.js";
import { MockAIService } from "../ai/MockAIService.js";
import { DeepSeekAIService } from "../ai/DeepSeekAIService.js";
import { AIConfig } from "../config/AppConfig.js";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function mockConfig(): AIConfig {
  return { provider: "mock" };
}

function deepseekConfig(overrides?: Partial<{ apiKey: string; model: string; baseUrl?: string }>): AIConfig {
  return {
    provider: "deepseek",
    deepseek: {
      apiKey: "sk-test-key",
      model: "deepseek-chat",
      ...overrides,
    },
  };
}

/** Create a minimal successful DeepSeek API response body. */
function successResponse(): object {
  return {
    id: "chatcmpl-test",
    model: "deepseek-chat",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Test response" },
        finish_reason: "stop",
      },
    ],
  };
}

function mockFetchOk(body: object = successResponse()): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    }),
  );
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("createAIService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------------
  // 11. Mock configuration creates MockAIService
  // ----------------------------------------------------------------
  describe("mock provider", () => {
    it("returns a MockAIService instance", () => {
      const service = createAIService(mockConfig());

      expect(service).toBeInstanceOf(MockAIService);
    });

    it("returns a functional MockAIService that responds with defaults", async () => {
      const service = createAIService(mockConfig());

      const response = await service.generate({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(response.content).toBe("Mock AI response");
      expect(response.model).toBe("mock-ai");
    });
  });

  // ----------------------------------------------------------------
  // 12. DeepSeek configuration creates DeepSeekAIService
  // ----------------------------------------------------------------
  describe("deepseek provider", () => {
    it("returns a DeepSeekAIService instance", () => {
      const service = createAIService(deepseekConfig());

      expect(service).toBeInstanceOf(DeepSeekAIService);
    });

    it("returns a functional DeepSeekAIService that calls the API", async () => {
      mockFetchOk();
      const service = createAIService(deepseekConfig());

      const response = await service.generate({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(response.content).toBe("Test response");
    });
  });

  // ----------------------------------------------------------------
  // 13. DeepSeek options are mapped correctly
  // ----------------------------------------------------------------
  describe("deepseek options mapping", () => {
    it("maps apiKey into the service", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => successResponse(),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const service = createAIService(
        deepseekConfig({ apiKey: "sk-custom-key-abc" }),
      );

      await service.generate({
        messages: [{ role: "user", content: "Hi" }],
      });

      const [, init] = fetchSpy.mock.calls[0];
      const headers = init!.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-custom-key-abc");
    });

    it("maps model into the service", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => successResponse(),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const service = createAIService(
        deepseekConfig({ model: "deepseek-reasoner" }),
      );

      await service.generate({
        messages: [{ role: "user", content: "Hi" }],
      });

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe("deepseek-reasoner");
    });

    it("maps optional baseUrl into the service", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => successResponse(),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const service = createAIService(
        deepseekConfig({ baseUrl: "https://custom-proxy.example.com" }),
      );

      await service.generate({
        messages: [{ role: "user", content: "Hi" }],
      });

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://custom-proxy.example.com/chat/completions");
    });

    it("omits baseUrl from DeepSeek options when not configured", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => successResponse(),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const config = deepseekConfig();
      // Ensure baseUrl is not present in the config
      delete config.deepseek!.baseUrl;

      const service = createAIService(config);

      await service.generate({
        messages: [{ role: "user", content: "Hi" }],
      });

      // Should use the default DeepSeek URL
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    });
  });

  // ----------------------------------------------------------------
  // 14. Unsupported configuration cannot silently fall back to mock
  // ----------------------------------------------------------------
  describe("no silent fallback", () => {
    it("throws when provider is not recognised (type-safety gate)", () => {
      // Force an invalid provider through type coercion — this tests the
      // exhaustiveness check in the factory switch statement.
      const invalidConfig = { provider: "openai" } as unknown as AIConfig;

      expect(() => createAIService(invalidConfig)).toThrow(
        "Unsupported AI provider: openai",
      );
    });

    it("does not silently return MockAIService for an unknown provider", () => {
      const invalidConfig = { provider: "deepseek" } as unknown as AIConfig;

      // If the config is invalid (deepseek but no deepseek config), it
      // should throw rather than falling back to mock.
      // The factory will try to read config.deepseek!.apiKey which will
      // throw — this behaviour prevents silent fallback.
      expect(() => createAIService(invalidConfig)).toThrow();
    });
  });
});
