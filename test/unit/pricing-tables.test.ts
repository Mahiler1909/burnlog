import { describe, it, expect } from "vitest";
import { getModelPricing, getModelDisplayName } from "../../src/utils/pricing-tables.js";

describe("getModelPricing", () => {
  it("returns exact match for known model", () => {
    const pricing = getModelPricing("claude-opus-4-6");
    expect(pricing.inputPerMillion).toBe(15);
    expect(pricing.outputPerMillion).toBe(75);
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

  it("falls back to Sonnet 4.5 for unknown model", () => {
    const pricing = getModelPricing("totally-unknown-model");
    expect(pricing.inputPerMillion).toBe(3);
    expect(pricing.outputPerMillion).toBe(15);
  });
});

describe("getModelDisplayName", () => {
  it.each([
    ["claude-opus-4-6", "Opus 4.6"],
    ["claude-sonnet-4-5", "Sonnet 4.5"],
    ["claude-haiku-4-5", "Haiku 4.5"],
    ["claude-3-opus", "Opus 3"],
    ["claude-3-5-sonnet", "Sonnet 3.5"],
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
