import { AIService } from "./AIService.js";
import { MockAIService } from "./MockAIService.js";
import { DeepSeekAIService } from "./DeepSeekAIService.js";
import { AIConfig } from "../config/AppConfig.js";

/**
 * Create the appropriate {@link AIService} implementation from configuration.
 *
 * This is the single composition point for provider selection. Every other
 * module depends only on the {@link AIService} interface — never on a
 * concrete implementation or on provider-specific configuration.
 *
 * @param config The resolved and validated AI configuration section.
 * @returns An {@link AIService} ready for injection into controllers.
 */
export function createAIService(config: AIConfig): AIService {
  switch (config.provider) {
    case "mock":
      return new MockAIService();

    case "deepseek": {
      // The config loader guarantees deepseek exists when provider is "deepseek"
      const ds = config.deepseek!;
      return new DeepSeekAIService({
        apiKey: ds.apiKey,
        model: ds.model,
        ...(ds.baseUrl !== undefined ? { baseUrl: ds.baseUrl } : {}),
      });
    }

    default: {
      // Exhaustiveness check — should never reach here if the config is validated
      const _exhaustive: never = config.provider;
      throw new Error(`Unsupported AI provider: ${String(_exhaustive)}`);
    }
  }
}
