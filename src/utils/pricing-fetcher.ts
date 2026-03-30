import { readFileSync, existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ModelPricing } from "./pricing-tables.js";

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_DIR = join(homedir(), ".config", "burnlog");
const CACHE_FILE = join(CACHE_DIR, "pricing-cache.json");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 5_000;

export interface PricingData {
  lastUpdated: string;
  source: string;
  models: Record<string, ModelPricing & { displayName: string }>;
}

/**
 * Fetch pricing from LiteLLM's open dataset, filtering to Claude models only.
 * Costs in LiteLLM are per-token; we convert to per-million.
 */
export async function fetchRemotePricing(): Promise<PricingData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(LITELLM_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as Record<string, Record<string, unknown>>;

    const models: PricingData["models"] = {};

    for (const [key, entry] of Object.entries(raw)) {
      // Only direct claude keys (skip bedrock/azure/regional variants)
      if (!key.startsWith("claude-")) continue;
      if (typeof entry.input_cost_per_token !== "number") continue;
      if (typeof entry.output_cost_per_token !== "number") continue;

      const inputPerMillion = entry.input_cost_per_token * 1_000_000;
      const outputPerMillion = entry.output_cost_per_token * 1_000_000;
      const cacheWritePerMillion =
        typeof entry.cache_creation_input_token_cost === "number"
          ? entry.cache_creation_input_token_cost * 1_000_000
          : inputPerMillion * 1.25;
      const cacheReadPerMillion =
        typeof entry.cache_read_input_token_cost === "number"
          ? entry.cache_read_input_token_cost * 1_000_000
          : inputPerMillion * 0.1;

      // Normalize key: strip date suffix for canonical name
      const canonical = key.replace(/-\d{8}$/, "");

      // Derive display name from canonical key
      const displayName = deriveDisplayName(canonical);

      // Keep the first (most specific) entry per canonical name
      if (!models[canonical]) {
        models[canonical] = {
          displayName,
          inputPerMillion: round(inputPerMillion),
          outputPerMillion: round(outputPerMillion),
          cacheWritePerMillion: round(cacheWritePerMillion),
          cacheReadPerMillion: round(cacheReadPerMillion),
        };
      }
    }

    return {
      lastUpdated: new Date().toISOString().slice(0, 10),
      source: "litellm",
      models,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read cached pricing from disk. Returns null if missing or expired.
 */
export function loadCachedPricing(): PricingData | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const raw = readFileSync(CACHE_FILE, "utf-8");
    const data = JSON.parse(raw) as PricingData & { cachedAt?: string };
    if (!data.models || !data.lastUpdated) return null;

    // Check age
    const cachedAt = data.cachedAt ? new Date(data.cachedAt).getTime() : 0;
    if (Date.now() - cachedAt > CACHE_MAX_AGE_MS) return null;

    return data;
  } catch {
    return null;
  }
}

/**
 * Save pricing to disk cache.
 */
export async function savePricingCache(data: PricingData): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const withTimestamp = { ...data, cachedAt: new Date().toISOString() };
    await writeFile(CACHE_FILE, JSON.stringify(withTimestamp, null, 2));
  } catch {
    // Non-fatal — cache is a convenience, not a requirement
  }
}

/**
 * Resolve pricing with fallback chain: cache → remote → bundled.
 */
export async function resolvePricing(options?: {
  offline?: boolean;
}): Promise<PricingData> {
  // 1. Try disk cache (fast, no network)
  const cached = loadCachedPricing();
  if (cached) return cached;

  // 2. Try remote fetch (unless offline)
  if (!options?.offline) {
    try {
      const remote = await fetchRemotePricing();
      if (Object.keys(remote.models).length > 0) {
        await savePricingCache(remote);
        return remote;
      }
    } catch {
      // Fall through to bundled
    }
  }

  // 3. Fallback to bundled JSON
  if (!options?.offline) {
    process.stderr.write(
      "⚠ Using bundled pricing (offline or fetch failed).\n",
    );
  }
  return loadBundledPricing();
}

/** Load the bundled pricing.json shipped with the package. */
export function loadBundledPricing(): PricingData {
  // Resolve relative to this file's location (works in both src/ and dist/)
  const thisDir = new URL(".", import.meta.url);
  const jsonPath = new URL("../data/pricing.json", thisDir);
  const content = readFileSync(jsonPath, "utf-8");
  return JSON.parse(content) as PricingData;
}

function deriveDisplayName(canonical: string): string {
  // "claude-opus-4-6" → "Opus 4.6", "claude-3-5-sonnet" → "Sonnet 3.5"
  const withoutClaude = canonical.replace(/^claude-/, "");

  // New naming: opus-4-6, sonnet-4-5, haiku-4-5
  const newMatch = withoutClaude.match(/^(opus|sonnet|haiku)-(\d+)-(\d+)$/);
  if (newMatch) {
    const [, family, major, minor] = newMatch;
    return `${family.charAt(0).toUpperCase() + family.slice(1)} ${major}.${minor}`;
  }

  // Old naming: 3-5-sonnet, 3-7-sonnet, 3-opus
  const oldMatch = withoutClaude.match(/^(\d+)(?:-(\d+))?-(opus|sonnet|haiku)$/);
  if (oldMatch) {
    const [, major, minor, family] = oldMatch;
    const version = minor ? `${major}.${minor}` : major;
    return `${family.charAt(0).toUpperCase() + family.slice(1)} ${version}`;
  }

  return canonical;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
