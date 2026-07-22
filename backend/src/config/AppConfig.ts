/** Supported AI provider identifiers. */
export type AIProvider = "mock" | "deepseek";

/** Configuration specific to the DeepSeek AI provider. */
export interface DeepSeekConfig {
  /** DeepSeek API key (never logged or exposed). */
  apiKey: string;
  /** Model identifier e.g. "deepseek-chat". */
  model: string;
  /** Optional base URL override. */
  baseUrl?: string;
}

/** AI configuration section. */
export interface AIConfig {
  /** Which AI provider to use. Defaults to "mock". */
  provider: AIProvider;
  /** DeepSeek-specific configuration (required when provider is "deepseek"). */
  deepseek?: DeepSeekConfig;
}

/** Application configuration read from environment variables. */
export interface AppConfig {
  ai: AIConfig;
}

// ------------------------------------------------------------------
// Validation errors
// ------------------------------------------------------------------

/**
 * Returned when the configuration is invalid.
 *
 * The message identifies the missing or invalid key but never includes
 * secret values.
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

// ------------------------------------------------------------------
// Configuration loader
// ------------------------------------------------------------------

/**
 * Parse and validate application configuration from an environment-like object.
 *
 * This is a pure function — it does not read `process.env` directly.
 * Pass `process.env` at the composition root.
 *
 * @throws {ConfigValidationError} When required configuration is missing or invalid.
 */
export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const providerRaw = env.AI_PROVIDER;

  // 1. Resolve provider with "mock" as default
  const provider = resolveProvider(providerRaw);

  // 2. Build AI config based on provider
  const ai = buildAIConfig(provider, env);

  return { ai };
}

// ------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------

/** Parse AI_PROVIDER or default to "mock". */
function resolveProvider(raw: string | undefined): AIProvider {
  if (raw === undefined || raw.trim().length === 0) {
    return "mock";
  }

  const trimmed = raw.trim();

  if (trimmed === "mock" || trimmed === "deepseek") {
    return trimmed;
  }

  throw new ConfigValidationError(
    `Invalid AI_PROVIDER "${trimmed}". Must be "mock" or "deepseek".`,
  );
}

/** Build the AIConfig from a resolved provider and environment. */
function buildAIConfig(provider: AIProvider, env: NodeJS.ProcessEnv): AIConfig {
  if (provider === "mock") {
    return { provider };
  }

  // provider === "deepseek"
  const apiKey = readRequired(env, "DEEPSEEK_API_KEY");
  const model = readRequired(env, "DEEPSEEK_MODEL");
  const baseUrl = readOptional(env, "DEEPSEEK_BASE_URL");

  return {
    provider,
    deepseek: {
      apiKey,
      model,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    },
  };
}

/**
 * Read a required string environment variable.
 *
 * @throws {ConfigValidationError} When the value is missing or empty.
 */
function readRequired(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (value === undefined || value.trim().length === 0) {
    throw new ConfigValidationError(
      `Missing required configuration: ${key}`,
    );
  }

  return value.trim();
}

/**
 * Read an optional string environment variable.
 *
 * Returns `undefined` when missing or empty.
 */
function readOptional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];

  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}
