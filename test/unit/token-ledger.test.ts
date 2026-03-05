import { describe, it, expect } from "vitest";
import {
  calculateCost,
  sumTokenUsage,
  totalTokens,
  buildCostBreakdown,
} from "../../src/core/token-ledger.js";
import { createTokenUsage, createSession, createExchange } from "../fixtures/factory.js";

describe("calculateCost", () => {
  it("calculates cost for Sonnet 4.5 pricing", () => {
    const usage = createTokenUsage({
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    // input: 1M * $3/M = $3, output: 100K * $15/M = $1.50
    const cost = calculateCost(usage, "claude-sonnet-4-5");
    expect(cost).toBeCloseTo(4.5, 2);
  });

  it("includes cache costs", () => {
    const usage = createTokenUsage({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    // cacheWrite: 1M * $3.75/M = $3.75, cacheRead: 1M * $0.30/M = $0.30
    const cost = calculateCost(usage, "claude-sonnet-4-5");
    expect(cost).toBeCloseTo(4.05, 2);
  });

  it("returns 0 for zero usage", () => {
    const usage = createTokenUsage({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    expect(calculateCost(usage, "claude-sonnet-4-5")).toBe(0);
  });
});

describe("sumTokenUsage", () => {
  it("sums multiple usages", () => {
    const a = createTokenUsage({ inputTokens: 100, outputTokens: 200 });
    const b = createTokenUsage({ inputTokens: 300, outputTokens: 400 });
    const sum = sumTokenUsage([a, b]);
    expect(sum.inputTokens).toBe(400);
    expect(sum.outputTokens).toBe(600);
    expect(sum.cacheCreationTokens).toBe(200);
    expect(sum.cacheReadTokens).toBe(200);
  });

  it("returns zeros for empty array", () => {
    const sum = sumTokenUsage([]);
    expect(sum.inputTokens).toBe(0);
    expect(sum.outputTokens).toBe(0);
    expect(sum.cacheCreationTokens).toBe(0);
    expect(sum.cacheReadTokens).toBe(0);
  });
});

describe("totalTokens", () => {
  it("sums all 4 fields", () => {
    const usage = createTokenUsage({
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationTokens: 300,
      cacheReadTokens: 400,
    });
    expect(totalTokens(usage)).toBe(1000);
  });
});

describe("buildCostBreakdown", () => {
  it("groups costs by project, model, outcome, and category", () => {
    const sessions = [
      createSession({
        projectName: "app-a",
        estimatedCostUSD: 5,
        outcome: "fully_achieved",
        goalCategory: "bug_fix",
        exchanges: [createExchange({ model: "claude-sonnet-4-5", estimatedCostUSD: 5 })],
      }),
      createSession({
        projectName: "app-b",
        estimatedCostUSD: 3,
        outcome: "not_achieved",
        goalCategory: "implementation",
        exchanges: [createExchange({ model: "claude-opus-4-6", estimatedCostUSD: 3 })],
      }),
    ];

    const breakdown = buildCostBreakdown(sessions);
    expect(breakdown.byProject["app-a"]).toBe(5);
    expect(breakdown.byProject["app-b"]).toBe(3);
    expect(breakdown.byModel["claude-sonnet-4-5"]).toBe(5);
    expect(breakdown.byModel["claude-opus-4-6"]).toBe(3);
    expect(breakdown.byOutcome["fully_achieved"]).toBe(5);
    expect(breakdown.byOutcome["not_achieved"]).toBe(3);
  });

  it("normalizes category aliases", () => {
    const sessions = [
      createSession({ goalCategory: "fix_bug", estimatedCostUSD: 2, exchanges: [] }),
      createSession({ goalCategory: "documentation_creation", estimatedCostUSD: 1, exchanges: [] }),
      createSession({ goalCategory: "documentation_cleanup", estimatedCostUSD: 1, exchanges: [] }),
    ];

    const breakdown = buildCostBreakdown(sessions);
    expect(breakdown.byCategory["bug_fix"]).toBe(2);
    expect(breakdown.byCategory["documentation"]).toBe(2);
  });
});
