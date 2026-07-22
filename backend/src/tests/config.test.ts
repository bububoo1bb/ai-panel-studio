import { describe, it, expect } from "vitest";
import { loadAppConfig, ConfigValidationError } from "../config/AppConfig.js";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Create a minimal valid environment object for the mock provider. */
function mockEnv(): NodeJS.ProcessEnv {
  return {
    AI_PROVIDER: "mock",
  };
}

/** Create a minimal valid environment object for the deepseek provider. */
function deepseekEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    AI_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "sk-test-key-12345",
    DEEPSEEK_MODEL: "deepseek-chat",
    ...overrides,
  };
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("loadAppConfig", () => {
  // ----------------------------------------------------------------
  // 1. Missing AI_PROVIDER defaults to mock
  // ----------------------------------------------------------------
  describe("default provider", () => {
    it("defaults to mock when AI_PROVIDER is not set", () => {
      const config = loadAppConfig({});

      expect(config.ai.provider).toBe("mock");
    });

    it("defaults to mock when AI_PROVIDER is an empty string", () => {
      const config = loadAppConfig({ AI_PROVIDER: "" });

      expect(config.ai.provider).toBe("mock");
    });

    it("defaults to mock when AI_PROVIDER is whitespace only", () => {
      const config = loadAppConfig({ AI_PROVIDER: "   " });

      expect(config.ai.provider).toBe("mock");
    });
  });

  // ----------------------------------------------------------------
  // 2. Explicit mock provider succeeds
  // ----------------------------------------------------------------
  describe("explicit mock", () => {
    it("accepts explicit 'mock' provider", () => {
      const config = loadAppConfig(mockEnv());

      expect(config.ai.provider).toBe("mock");
    });

    it("does not require DeepSeek configuration for mock", () => {
      const config = loadAppConfig(mockEnv());

      expect(config.ai.deepseek).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // 3. Explicit deepseek provider succeeds with required configuration
  // ----------------------------------------------------------------
  describe("explicit deepseek", () => {
    it("accepts 'deepseek' provider with required configuration", () => {
      const config = loadAppConfig(deepseekEnv());

      expect(config.ai.provider).toBe("deepseek");
      expect(config.ai.deepseek).toBeDefined();
      expect(config.ai.deepseek!.apiKey).toBe("sk-test-key-12345");
      expect(config.ai.deepseek!.model).toBe("deepseek-chat");
    });
  });

  // ----------------------------------------------------------------
  // 4. Optional DeepSeek base URL is preserved
  // ----------------------------------------------------------------
  describe("optional base URL", () => {
    it("preserves DEEPSEEK_BASE_URL when provided", () => {
      const config = loadAppConfig(
        deepseekEnv({ DEEPSEEK_BASE_URL: "https://custom.example.com/v1" }),
      );

      expect(config.ai.deepseek!.baseUrl).toBe("https://custom.example.com/v1");
    });

    it("omits baseUrl from config when DEEPSEEK_BASE_URL is not set", () => {
      const env = deepseekEnv();
      delete env.DEEPSEEK_BASE_URL;

      const config = loadAppConfig(env);

      expect(config.ai.deepseek!.baseUrl).toBeUndefined();
    });

    it("omits baseUrl from config when DEEPSEEK_BASE_URL is empty", () => {
      const config = loadAppConfig(
        deepseekEnv({ DEEPSEEK_BASE_URL: "" }),
      );

      expect(config.ai.deepseek!.baseUrl).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // 5. Invalid provider throws
  // ----------------------------------------------------------------
  describe("invalid provider", () => {
    it("throws ConfigValidationError for an unrecognized provider", () => {
      expect(() =>
        loadAppConfig({ AI_PROVIDER: "openai" }),
      ).toThrow(ConfigValidationError);
    });

    it("error message mentions the invalid value", () => {
      expect(() =>
        loadAppConfig({ AI_PROVIDER: "openai" }),
      ).toThrow(/openai/);
    });

    it("error message mentions the valid options", () => {
      expect(() =>
        loadAppConfig({ AI_PROVIDER: "unknown" }),
      ).toThrow(/"mock" or "deepseek"/);
    });
  });

  // ----------------------------------------------------------------
  // 6. DeepSeek without DEEPSEEK_API_KEY throws
  // ----------------------------------------------------------------
  describe("deepseek missing API key", () => {
    it("throws when DEEPSEEK_API_KEY is not set", () => {
      const env = deepseekEnv();
      delete env.DEEPSEEK_API_KEY;

      expect(() => loadAppConfig(env)).toThrow(ConfigValidationError);
    });

    it("error message identifies DEEPSEEK_API_KEY as the missing key", () => {
      const env = deepseekEnv();
      delete env.DEEPSEEK_API_KEY;

      expect(() => loadAppConfig(env)).toThrow(/DEEPSEEK_API_KEY/);
    });
  });

  // ----------------------------------------------------------------
  // 7. DeepSeek without DEEPSEEK_MODEL throws
  // ----------------------------------------------------------------
  describe("deepseek missing model", () => {
    it("throws when DEEPSEEK_MODEL is not set", () => {
      const env = deepseekEnv();
      delete env.DEEPSEEK_MODEL;

      expect(() => loadAppConfig(env)).toThrow(ConfigValidationError);
    });

    it("error message identifies DEEPSEEK_MODEL as the missing key", () => {
      const env = deepseekEnv();
      delete env.DEEPSEEK_MODEL;

      expect(() => loadAppConfig(env)).toThrow(/DEEPSEEK_MODEL/);
    });
  });

  // ----------------------------------------------------------------
  // 8. Mock does not require DeepSeek configuration
  // ----------------------------------------------------------------
  describe("mock ignores DeepSeek variables", () => {
    it("succeeds with mock even when DeepSeek variables are absent", () => {
      const config = loadAppConfig({ AI_PROVIDER: "mock" });

      expect(config.ai.provider).toBe("mock");
      expect(config.ai.deepseek).toBeUndefined();
    });

    it("succeeds with mock even when DeepSeek variables are present", () => {
      const config = loadAppConfig({
        AI_PROVIDER: "mock",
        DEEPSEEK_API_KEY: "sk-ignored",
        DEEPSEEK_MODEL: "ignored-model",
      });

      expect(config.ai.provider).toBe("mock");
      // DeepSeek config is not populated for mock provider
      expect(config.ai.deepseek).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // 9. Empty required values are treated as missing
  // ----------------------------------------------------------------
  describe("empty values treated as missing", () => {
    it("treats empty DEEPSEEK_API_KEY as missing", () => {
      expect(() =>
        loadAppConfig(deepseekEnv({ DEEPSEEK_API_KEY: "" })),
      ).toThrow(ConfigValidationError);
    });

    it("treats whitespace-only DEEPSEEK_API_KEY as missing", () => {
      expect(() =>
        loadAppConfig(deepseekEnv({ DEEPSEEK_API_KEY: "   " })),
      ).toThrow(ConfigValidationError);
    });

    it("treats empty DEEPSEEK_MODEL as missing", () => {
      expect(() =>
        loadAppConfig(deepseekEnv({ DEEPSEEK_MODEL: "" })),
      ).toThrow(ConfigValidationError);
    });

    it("treats whitespace-only DEEPSEEK_MODEL as missing", () => {
      expect(() =>
        loadAppConfig(deepseekEnv({ DEEPSEEK_MODEL: "   " })),
      ).toThrow(ConfigValidationError);
    });
  });

  // ----------------------------------------------------------------
  // 10. Validation errors never contain the API key value
  // ----------------------------------------------------------------
  describe("secret protection", () => {
    it("never includes the API key value in error messages", () => {
      const secretKey = "sk-very-secret-key-do-not-leak";

      expect(() =>
        loadAppConfig(
          deepseekEnv({ DEEPSEEK_MODEL: "" }),
        ),
      ).toThrow(/DEEPSEEK_MODEL/);
      // The error should NOT contain the API key
      try {
        loadAppConfig(
          deepseekEnv({ DEEPSEEK_API_KEY: secretKey, DEEPSEEK_MODEL: "" }),
        );
      } catch (e) {
        const message = (e as Error).message;
        expect(message).not.toContain(secretKey);
      }
    });

    it("never includes the API key value when API key itself is missing", () => {
      const env = deepseekEnv();
      delete env.DEEPSEEK_API_KEY;

      try {
        loadAppConfig(env);
      } catch (e) {
        const message = (e as Error).message;
        // Should mention the key name, not any value
        expect(message).toContain("DEEPSEEK_API_KEY");
        expect(message).not.toContain("sk-");
      }
    });

    it("never includes secret values from other env vars", () => {
      // Even if some other env var has a secret-looking value, errors
      // should only contain the key name, not the value
      try {
        loadAppConfig({
          AI_PROVIDER: "deepseek",
          DEEPSEEK_API_KEY: "sk-actual-secret-abc123",
          // DEEPSEEK_MODEL is missing — this should trigger the error
        });
      } catch (e) {
        const message = (e as Error).message;
        expect(message).toContain("DEEPSEEK_MODEL");
        expect(message).not.toContain("sk-actual-secret-abc123");
      }
    });
  });

  // ----------------------------------------------------------------
  // Trimming behaviour
  // ----------------------------------------------------------------
  describe("value trimming", () => {
    it("trims whitespace from AI_PROVIDER", () => {
      const config = loadAppConfig({ AI_PROVIDER: "  mock  " });

      expect(config.ai.provider).toBe("mock");
    });

    it("trims whitespace from DeepSeek config values", () => {
      const config = loadAppConfig({
        AI_PROVIDER: "deepseek",
        DEEPSEEK_API_KEY: "  sk-trimmed  ",
        DEEPSEEK_MODEL: "  deepseek-chat  ",
        DEEPSEEK_BASE_URL: "  https://example.com  ",
      });

      expect(config.ai.deepseek!.apiKey).toBe("sk-trimmed");
      expect(config.ai.deepseek!.model).toBe("deepseek-chat");
      expect(config.ai.deepseek!.baseUrl).toBe("https://example.com");
    });
  });
});
