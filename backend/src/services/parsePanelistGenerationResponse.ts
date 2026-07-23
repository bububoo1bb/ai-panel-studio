/**
 * Parse the raw AI response text from a panelist generation request
 * into an array of raw panelist objects (unvalidated).
 *
 * Handles common AI output patterns:
 * - Pure JSON array
 * - JSON array wrapped in markdown code fences (```json ... ```)
 * - JSON array with surrounding commentary text
 *
 * Returns the parsed array on success, or throws with a descriptive
 * message on failure.
 */

export interface RawGeneratedPanelist {
  role: unknown;
  name: unknown;
  occupation: unknown;
  title: unknown;
  stance: unknown;
  beliefs: unknown;
  concerns: unknown;
  argumentStyle: unknown;
}

/**
 * Extract and parse a JSON array of panelists from raw AI response text.
 *
 * @throws {Error} When no JSON array can be found or parsed.
 */
export function parsePanelistGenerationResponse(
  raw: string,
): RawGeneratedPanelist[] {
  const trimmed = raw.trim();

  // Attempt 1: direct JSON parse
  const direct = tryParseJSON(trimmed);
  if (direct !== null) return validateIsArray(direct);

  // Attempt 2: extract from markdown code fence (```json ... ```)
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const fenced = tryParseJSON(fenceMatch[1].trim());
    if (fenced !== null) return validateIsArray(fenced);
  }

  // Attempt 3: find first JSON array with balanced brackets
  const arrayMatch = extractFirstJSONArray(trimmed);
  if (arrayMatch !== null) {
    const parsed = tryParseJSON(arrayMatch);
    if (parsed !== null) return validateIsArray(parsed);
  }

  throw new Error(
    "Failed to parse panelist generation response: no valid JSON array found",
  );
}

// ── Internal helpers ─────────────────────────────────────────────

function tryParseJSON(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validateIsArray(value: unknown): RawGeneratedPanelist[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "Panelist generation response is not a JSON array",
    );
  }
  return value as RawGeneratedPanelist[];
}

/**
 * Find the first JSON array in text by tracking bracket depth.
 * Returns the substring from '[' to the matching ']', or null.
 */
function extractFirstJSONArray(text: string): string | null {
  const start = text.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null; // unbalanced brackets
}
