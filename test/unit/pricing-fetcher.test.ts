import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchRemotePricing, loadBundledPricing } from "../../src/utils/pricing-fetcher.js";

describe("fetchRemotePricing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses LiteLLM format and converts to per-million pricing", async () => {
    const mockData = {
      "claude-sonnet-4-5": {
        input_cost_per_token: 0.000003,   // $3/M
        output_cost_per_token: 0.000015,  // $15/M
        cache_creation_input_token_cost: 0.00000375, // $3.75/M
        cache_read_input_token_cost: 0.0000003, // $0.30/M
      },
      "claude-opus-4-6": {
        input_cost_per_token: 0.000005,   // $5/M
        output_cost_per_token: 0.000025,  // $25/M
        cache_creation_input_token_cost: 0.00000625,
        cache_read_input_token_cost: 0.0000005,
      },
      // Non-claude entries should be filtered out
      "gpt-4o": {
        input_cost_per_token: 0.000005,
        output_cost_per_token: 0.000015,
      },
      // Bedrock variants should be filtered out (not starting with "claude-")
      "anthropic.claude-sonnet-4-5": {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await fetchRemotePricing();

    expect(result.source).toBe("litellm");
    expect(Object.keys(result.models)).toHaveLength(2); // Only claude- prefixed

    const sonnet = result.models["claude-sonnet-4-5"];
    expect(sonnet.inputPerMillion).toBe(3);
    expect(sonnet.outputPerMillion).toBe(15);
    expect(sonnet.cacheWritePerMillion).toBe(3.75);
    expect(sonnet.cacheReadPerMillion).toBe(0.3);

    const opus = result.models["claude-opus-4-6"];
    expect(opus.inputPerMillion).toBe(5);
    expect(opus.outputPerMillion).toBe(25);
  });

  it("strips date suffix to create canonical keys", async () => {
    const mockData = {
      "claude-sonnet-4-5-20250929": {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await fetchRemotePricing();
    expect(result.models["claude-sonnet-4-5"]).toBeDefined();
    expect(result.models["claude-sonnet-4-5-20250929"]).toBeUndefined();
  });

  it("throws on HTTP error", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchRemotePricing()).rejects.toThrow("HTTP 500");
  });

  it("derives cache pricing when not provided", async () => {
    const mockData = {
      "claude-sonnet-4-5": {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        // No cache fields
      },
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await fetchRemotePricing();
    const sonnet = result.models["claude-sonnet-4-5"];
    // cacheWrite = input * 1.25, cacheRead = input * 0.1
    expect(sonnet.cacheWritePerMillion).toBe(3.75);
    expect(sonnet.cacheReadPerMillion).toBe(0.3);
  });
});

describe("loadBundledPricing", () => {
  it("returns valid pricing data", () => {
    const data = loadBundledPricing();
    expect(data.lastUpdated).toBeDefined();
    expect(data.source).toBeDefined();
    expect(Object.keys(data.models).length).toBeGreaterThan(10);

    // Every model should have all required fields
    for (const [key, model] of Object.entries(data.models)) {
      expect(model.displayName, `${key} missing displayName`).toBeDefined();
      expect(model.inputPerMillion, `${key} missing inputPerMillion`).toBeGreaterThan(0);
      expect(model.outputPerMillion, `${key} missing outputPerMillion`).toBeGreaterThan(0);
      expect(model.cacheWritePerMillion, `${key} missing cacheWritePerMillion`).toBeGreaterThan(0);
      expect(model.cacheReadPerMillion, `${key} missing cacheReadPerMillion`).toBeGreaterThan(0);
    }
  });
});
