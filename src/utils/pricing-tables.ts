// Anthropic pricing per million tokens (USD)
// Source: https://www.anthropic.com/pricing
// Last updated: 2025-05

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Claude 4.5 / 4.6 family
  "claude-opus-4-6": {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheWritePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  "claude-sonnet-4-6": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  "claude-haiku-4-5": {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheWritePerMillion: 1,
    cacheReadPerMillion: 0.08,
  },

  "claude-opus-4-5": {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheWritePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },

  // Claude 3.5 family
  "claude-sonnet-4-5": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  "claude-3-5-sonnet": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  "claude-3-5-haiku": {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheWritePerMillion: 1,
    cacheReadPerMillion: 0.08,
  },

  // Claude 3 family
  "claude-3-opus": {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheWritePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  "claude-3-sonnet": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  "claude-3-haiku": {
    inputPerMillion: 0.25,
    outputPerMillion: 1.25,
    cacheWritePerMillion: 0.3,
    cacheReadPerMillion: 0.03,
  },
};

/**
 * Resolve a model ID to its pricing. Handles versioned model IDs
 * like "claude-sonnet-4-5-20250929" by stripping the date suffix.
 */
export function getModelPricing(modelId: string): ModelPricing {
  // Direct match
  if (PRICING[modelId]) return PRICING[modelId];

  // Strip date suffix (e.g., "claude-sonnet-4-5-20250929" -> "claude-sonnet-4-5")
  const withoutDate = modelId.replace(/-\d{8}$/, "");
  if (PRICING[withoutDate]) return PRICING[withoutDate];

  // Try matching by family prefix
  for (const key of Object.keys(PRICING)) {
    if (modelId.startsWith(key)) return PRICING[key];
  }

  // Fallback to Sonnet pricing (most common in Claude Code)
  return PRICING["claude-sonnet-4-5"];
}

export function getModelDisplayName(modelId: string): string {
  const withoutDate = modelId.replace(/-\d{8}$/, "");
  const names: Record<string, string> = {
    "claude-opus-4-6": "Opus 4.6",
    "claude-opus-4-5": "Opus 4.5",
    "claude-sonnet-4-6": "Sonnet 4.6",
    "claude-sonnet-4-5": "Sonnet 4.5",
    "claude-haiku-4-5": "Haiku 4.5",
    "claude-3-5-sonnet": "Sonnet 3.5",
    "claude-3-5-haiku": "Haiku 3.5",
    "claude-3-opus": "Opus 3",
    "claude-3-sonnet": "Sonnet 3",
    "claude-3-haiku": "Haiku 3",
  };
  for (const [key, name] of Object.entries(names)) {
    if (modelId.startsWith(key) || withoutDate === key) return name;
  }
  return modelId;
}
