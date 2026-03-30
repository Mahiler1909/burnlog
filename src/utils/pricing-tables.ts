import { resolvePricing, loadBundledPricing, type PricingData } from "./pricing-fetcher.js";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

// Active pricing data — initialized from bundled, refreshed by initPricing()
let pricingData: PricingData = loadBundledPricing();

/**
 * Initialize pricing from cache/remote/bundled. Call once at CLI startup.
 * Safe to skip — bundled pricing is always available as fallback.
 */
export async function initPricing(options?: { offline?: boolean }): Promise<void> {
  pricingData = await resolvePricing(options);
}

/**
 * Resolve a model ID to its pricing. Handles versioned model IDs
 * like "claude-sonnet-4-5-20250929" by stripping the date suffix.
 */
export function getModelPricing(modelId: string): ModelPricing {
  const models = pricingData.models;

  // Direct match
  if (models[modelId]) return toPricing(models[modelId]);

  // Strip date suffix (e.g., "claude-sonnet-4-5-20250929" -> "claude-sonnet-4-5")
  const withoutDate = modelId.replace(/-\d{8}$/, "");
  if (models[withoutDate]) return toPricing(models[withoutDate]);

  // Try matching by family prefix
  for (const key of Object.keys(models)) {
    if (modelId.startsWith(key)) return toPricing(models[key]);
  }

  // Warn and fallback to Sonnet 4.5 (most common in Claude Code)
  process.stderr.write(`⚠ Unknown model "${modelId}", using Sonnet 4.5 pricing.\n`);
  return toPricing(models["claude-sonnet-4-5"]);
}

export function getModelDisplayName(modelId: string): string {
  const models = pricingData.models;
  const withoutDate = modelId.replace(/-\d{8}$/, "");

  // Direct or prefix match from pricing data
  for (const [key, entry] of Object.entries(models)) {
    if (modelId.startsWith(key) || withoutDate === key) {
      return entry.displayName;
    }
  }

  return modelId;
}

/** Get the currently loaded pricing source and date for diagnostics. */
export function getPricingInfo(): { source: string; lastUpdated: string } {
  return { source: pricingData.source, lastUpdated: pricingData.lastUpdated };
}

function toPricing(entry: PricingData["models"][string]): ModelPricing {
  return {
    inputPerMillion: entry.inputPerMillion,
    outputPerMillion: entry.outputPerMillion,
    cacheWritePerMillion: entry.cacheWritePerMillion,
    cacheReadPerMillion: entry.cacheReadPerMillion,
  };
}

/**
 * Replace the active pricing data. Used by tests to inject known pricing.
 * @internal
 */
export function _setPricingData(data: PricingData): void {
  pricingData = data;
}
