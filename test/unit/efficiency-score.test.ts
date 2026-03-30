import { describe, it, expect } from "vitest";
import { computeEfficiency } from "../../src/core/efficiency-score.js";
import { createSession } from "../fixtures/factory.js";
import type { SessionOutcome, WasteSignal, WasteType } from "../../src/data/models.js";

function createWasteSignal(overrides?: Partial<WasteSignal>): WasteSignal {
  return {
    type: "retry_loop" as WasteType,
    category: "avoidable",
    sessionId: "test",
    estimatedWastedCostUSD: 1,
    description: "test waste",
    suggestion: "fix it",
    ...overrides,
  };
}

describe("computeEfficiency", () => {
  it("returns 0 for empty sessions", () => {
    const result = computeEfficiency({ sessions: [], wasteSignals: [], totalCommits: 0 });
    expect(result.score).toBe(0);
  });

  it("returns high score for perfect sessions", () => {
    const sessions = [
      createSession({
        outcome: "fully_achieved" as SessionOutcome,
        estimatedCostUSD: 5,
        tokenUsage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 4000 },
      }),
    ];
    const result = computeEfficiency({ sessions, wasteSignals: [], totalCommits: 1 });
    // Outcome: 1.0 * 35 = 35
    // Waste: 1.0 * 25 = 25
    // Cost eff: $5/commit → 1.0 * 20 = 20
    // Cache: 4000/(1000+4000) = 0.8 * 20 = 16
    // Total: 96
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns low score for failed expensive sessions", () => {
    const sessions = [
      createSession({
        outcome: "not_achieved" as SessionOutcome,
        estimatedCostUSD: 50,
        tokenUsage: { inputTokens: 100000, outputTokens: 50000, cacheCreationTokens: 0, cacheReadTokens: 0 },
      }),
    ];
    const wasteSignals = [createWasteSignal({ estimatedWastedCostUSD: 25 })];
    const result = computeEfficiency({ sessions, wasteSignals, totalCommits: 0 });
    expect(result.score).toBeLessThan(30);
  });

  it("handles mixed outcomes", () => {
    const sessions = [
      createSession({ outcome: "fully_achieved" as SessionOutcome, estimatedCostUSD: 10 }),
      createSession({ outcome: "not_achieved" as SessionOutcome, estimatedCostUSD: 10 }),
    ];
    const result = computeEfficiency({ sessions, wasteSignals: [], totalCommits: 2 });
    // Outcome: 0.5 * 35 = 17.5
    expect(result.components.outcomeRatio).toBe(0.5);
    expect(result.score).toBeGreaterThan(20);
    expect(result.score).toBeLessThan(80);
  });

  it("penalizes high waste ratio", () => {
    const sessions = [
      createSession({ outcome: "fully_achieved" as SessionOutcome, estimatedCostUSD: 100 }),
    ];
    const noWaste = computeEfficiency({ sessions, wasteSignals: [], totalCommits: 1 });
    const withWaste = computeEfficiency({
      sessions,
      wasteSignals: [createWasteSignal({ estimatedWastedCostUSD: 80 })],
      totalCommits: 1,
    });
    expect(noWaste.score).toBeGreaterThan(withWaste.score);
  });

  it("rewards high cache hit rate", () => {
    const highCache = [
      createSession({
        outcome: "fully_achieved" as SessionOutcome,
        estimatedCostUSD: 5,
        tokenUsage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 9000 },
      }),
    ];
    const lowCache = [
      createSession({
        outcome: "fully_achieved" as SessionOutcome,
        estimatedCostUSD: 5,
        tokenUsage: { inputTokens: 9000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 1000 },
      }),
    ];
    const highResult = computeEfficiency({ sessions: highCache, wasteSignals: [], totalCommits: 1 });
    const lowResult = computeEfficiency({ sessions: lowCache, wasteSignals: [], totalCommits: 1 });
    expect(highResult.components.cacheHitRate).toBeGreaterThan(lowResult.components.cacheHitRate);
    expect(highResult.score).toBeGreaterThan(lowResult.score);
  });

  it("clamps score between 0 and 100", () => {
    const result = computeEfficiency({
      sessions: [createSession({ outcome: "fully_achieved" as SessionOutcome, estimatedCostUSD: 5 })],
      wasteSignals: [],
      totalCommits: 100, // very cheap per commit
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("exposes component values", () => {
    const result = computeEfficiency({
      sessions: [createSession({ outcome: "mostly_achieved" as SessionOutcome, estimatedCostUSD: 10 })],
      wasteSignals: [],
      totalCommits: 2,
    });
    expect(result.components).toHaveProperty("outcomeRatio");
    expect(result.components).toHaveProperty("wasteRatio");
    expect(result.components).toHaveProperty("costEfficiency");
    expect(result.components).toHaveProperty("cacheHitRate");
    expect(result.components.outcomeRatio).toBe(0.7);
  });
});
