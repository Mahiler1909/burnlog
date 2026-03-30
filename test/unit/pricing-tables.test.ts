import { describe, it, expect, beforeAll, vi } from "vitest";
import { getModelPricing, getModelDisplayName, _setPricingData } from "../../src/utils/pricing-tables.js";
import { loadBundledPricing } from "../../src/utils/pricing-fetcher.js";
import type { PricingData } from "../../src/utils/pricing-fetcher.js";

// Ensure tests use bundled pricing (no network)
beforeAll(() => {
  _setPricingData(loadBundledPricing());
});

describe("bundled pricing.json", () => {
  it("loads and has models", () => {
    const data = loadBundledPricing();
    expect(data.lastUpdated).toBeDefined();
    expect(Object.keys(data.models).length).toBeGreaterThan(10);
  });

  it("has correct Opus 4.6 pricing (updated 2026)", () => {
    const data = loadBundledPricing();
    const opus = data.models["claude-opus-4-6"];
    expect(opus.inputPerMillion).toBe(5);
    expect(opus.outputPerMillion).toBe(25);
    expect(opus.cacheWritePerMillion).toBe(6.25);
    expect(opus.cacheReadPerMillion).toBe(0.50);
  });

  it("has correct Haiku 4.5 pricing (updated 2026)", () => {
    const data = loadBundledPricing();
    const haiku = data.models["claude-haiku-4-5"];
    expect(haiku.inputPerMillion).toBe(1);
    expect(haiku.outputPerMillion).toBe(5);
  });

  it("includes models missing from old pricing table", () => {
    const data = loadBundledPricing();
    expect(data.models["claude-opus-4-1"]).toBeDefined();
    expect(data.models["claude-opus-4"]).toBeDefined();
    expect(data.models["claude-sonnet-4"]).toBeDefined();
    expect(data.models["claude-3-7-sonnet"]).toBeDefined();
  });
});

describe("getModelPricing", () => {
  it("returns exact match for known model", () => {
    const pricing = getModelPricing("claude-opus-4-6");
    expect(pricing.inputPerMillion).toBe(5);
    expect(pricing.outputPerMillion).toBe(25);
  });

  it("strips date suffix and matches", () => {
    const pricing = getModelPricing("claude-sonnet-4-5-20250929");
    expect(pricing.inputPerMillion).toBe(3);
    expect(pricing.outputPerMillion).toBe(15);
  });

  it("matches by family prefix", () => {
    const pricing = getModelPricing("claude-3-haiku-extended");
    expect(pricing.inputPerMillion).toBe(0.25);
  });

  it("falls back to Sonnet 4.5 for unknown model and warns", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const pricing = getModelPricing("totally-unknown-model");
    expect(pricing.inputPerMillion).toBe(3);
    expect(pricing.outputPerMillion).toBe(15);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown model"));
    stderrSpy.mockRestore();
  });
});

describe("getModelDisplayName", () => {
  it.each([
    ["claude-opus-4-6", "Opus 4.6"],
    ["claude-sonnet-4-5", "Sonnet 4.5"],
    ["claude-haiku-4-5", "Haiku 4.5"],
    ["claude-3-opus", "Opus 3"],
    ["claude-3-5-sonnet", "Sonnet 3.5"],
    ["claude-opus-4-1", "Opus 4.1"],
    ["claude-sonnet-4", "Sonnet 4"],
    ["claude-3-7-sonnet", "Sonnet 3.7"],
  ])("maps %s to %s", (modelId, expected) => {
    expect(getModelDisplayName(modelId)).toBe(expected);
  });

  it("strips date suffix for display name", () => {
    expect(getModelDisplayName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
  });

  it("returns raw model ID for unknown model", () => {
    expect(getModelDisplayName("totally-unknown")).toBe("totally-unknown");
  });
});
