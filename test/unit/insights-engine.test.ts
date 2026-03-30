import { describe, it, expect } from "vitest";
import { InsightsEngine } from "../../src/core/insights-engine.js";
import { createSession, createExchange } from "../fixtures/factory.js";

const engine = new InsightsEngine();

describe("InsightsEngine", () => {
  describe("retry_loop", () => {
    it("detects 3+ consecutive same-file edits with similar prompts", () => {
      const session = createSession({
        exchanges: [
          createExchange({ sequenceNumber: 0, userPrompt: "fix the bug in auth.ts please", filesModified: ["auth.ts"], estimatedCostUSD: 0.5 }),
          createExchange({ sequenceNumber: 1, userPrompt: "fix the bug in auth.ts now", filesModified: ["auth.ts"], estimatedCostUSD: 0.5 }),
          createExchange({ sequenceNumber: 2, userPrompt: "fix the bug in auth.ts again", filesModified: ["auth.ts"], estimatedCostUSD: 0.5 }),
          createExchange({ sequenceNumber: 3, userPrompt: "fix the bug in auth.ts correctly", filesModified: ["auth.ts"], estimatedCostUSD: 0.5 }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "retry_loop")).toBe(true);
    });

    it("does not trigger with different files", () => {
      const session = createSession({
        exchanges: [
          createExchange({ sequenceNumber: 0, userPrompt: "fix the bug in auth.ts", filesModified: ["auth.ts"] }),
          createExchange({ sequenceNumber: 1, userPrompt: "fix the bug in user.ts", filesModified: ["user.ts"] }),
          createExchange({ sequenceNumber: 2, userPrompt: "fix the bug in app.ts", filesModified: ["app.ts"] }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "retry_loop")).toBe(false);
    });
  });

  describe("abandoned_session", () => {
    it("detects not_achieved session with no commits and significant cost", () => {
      const session = createSession({
        outcome: "not_achieved",
        gitCommits: 0,
        estimatedCostUSD: 5.0,
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "abandoned_session")).toBe(true);
    });

    it("does not trigger for achieved sessions", () => {
      const session = createSession({
        outcome: "fully_achieved",
        gitCommits: 0,
        estimatedCostUSD: 5.0,
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "abandoned_session")).toBe(false);
    });

    it("does not trigger for cheap sessions", () => {
      const session = createSession({
        outcome: "not_achieved",
        gitCommits: 0,
        estimatedCostUSD: 0.10,
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "abandoned_session")).toBe(false);
    });
  });

  describe("context_rebuild", () => {
    it("detects cache rebuild after cache reads", () => {
      const session = createSession({
        exchanges: [
          createExchange({
            sequenceNumber: 0,
            tokenUsage: { inputTokens: 10_000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 50_000 },
          }),
          createExchange({
            sequenceNumber: 1,
            tokenUsage: { inputTokens: 10_000, outputTokens: 500, cacheCreationTokens: 80_000, cacheReadTokens: 1_000 },
          }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "context_rebuild")).toBe(true);
    });

    it("does not trigger without prior cache reads", () => {
      const session = createSession({
        exchanges: [
          createExchange({
            sequenceNumber: 0,
            tokenUsage: { inputTokens: 10_000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 },
          }),
          createExchange({
            sequenceNumber: 1,
            tokenUsage: { inputTokens: 10_000, outputTokens: 500, cacheCreationTokens: 80_000, cacheReadTokens: 0 },
          }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "context_rebuild")).toBe(false);
    });
  });

  describe("debugging_loop", () => {
    it("detects 4+ consecutive impl/debug on same files", () => {
      const session = createSession({
        exchanges: [
          createExchange({ sequenceNumber: 0, category: "implementation", filesModified: ["app.ts"], estimatedCostUSD: 1 }),
          createExchange({ sequenceNumber: 1, category: "debugging", filesModified: ["app.ts"], estimatedCostUSD: 1 }),
          createExchange({ sequenceNumber: 2, category: "implementation", filesModified: ["app.ts"], estimatedCostUSD: 1 }),
          createExchange({ sequenceNumber: 3, category: "debugging", filesModified: ["app.ts"], estimatedCostUSD: 1 }),
          createExchange({ sequenceNumber: 4, category: "implementation", filesModified: ["app.ts"], estimatedCostUSD: 1 }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "debugging_loop")).toBe(true);
    });

    it("does not trigger with fewer than 4 exchanges", () => {
      const session = createSession({
        exchanges: [
          createExchange({ sequenceNumber: 0, category: "implementation", filesModified: ["app.ts"] }),
          createExchange({ sequenceNumber: 1, category: "debugging", filesModified: ["app.ts"] }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "debugging_loop")).toBe(false);
    });
  });

  describe("excessive_exploration", () => {
    it("detects >70% exploration with 0 implementation", () => {
      const explorations = Array.from({ length: 8 }, (_, i) =>
        createExchange({ sequenceNumber: i, category: "exploration", toolsUsed: ["Read"], filesModified: [] }),
      );
      const session = createSession({
        exchanges: [
          ...explorations,
          createExchange({ sequenceNumber: 8, category: "planning", toolsUsed: [], filesModified: [] }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "excessive_exploration")).toBe(true);
    });

    it("does not trigger when implementation exchanges exist", () => {
      const session = createSession({
        exchanges: [
          ...Array.from({ length: 6 }, (_, i) =>
            createExchange({ sequenceNumber: i, category: "exploration", toolsUsed: ["Read"], filesModified: [] }),
          ),
          createExchange({ sequenceNumber: 6, category: "implementation", toolsUsed: ["Edit"], filesModified: ["app.ts"] }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "excessive_exploration")).toBe(false);
    });

    it("does not trigger for small sessions (<=5 exchanges)", () => {
      const session = createSession({
        exchanges: Array.from({ length: 5 }, (_, i) =>
          createExchange({ sequenceNumber: i, category: "exploration", toolsUsed: ["Read"], filesModified: [] }),
        ),
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "excessive_exploration")).toBe(false);
    });
  });

  describe("error_cascade", () => {
    it("detects 3+ consecutive debugging with tool errors", () => {
      const session = createSession({
        toolErrors: 5,
        exchanges: [
          createExchange({ sequenceNumber: 0, category: "debugging", estimatedCostUSD: 1 }),
          createExchange({ sequenceNumber: 1, category: "debugging", estimatedCostUSD: 1 }),
          createExchange({ sequenceNumber: 2, category: "debugging", estimatedCostUSD: 1 }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "error_cascade")).toBe(true);
    });

    it("does not trigger with few tool errors", () => {
      const session = createSession({
        toolErrors: 2,
        exchanges: [
          createExchange({ sequenceNumber: 0, category: "debugging" }),
          createExchange({ sequenceNumber: 1, category: "debugging" }),
          createExchange({ sequenceNumber: 2, category: "debugging" }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "error_cascade")).toBe(false);
    });
  });

  describe("high_cost_per_line", () => {
    it("detects >$1/line with >$20 cost", () => {
      const session = createSession({
        estimatedCostUSD: 50,
        linesAdded: 5,
        linesRemoved: 5,
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "high_cost_per_line")).toBe(true);
    });

    it("does not trigger for cheap sessions", () => {
      const session = createSession({
        estimatedCostUSD: 5,
        linesAdded: 5,
        linesRemoved: 5,
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "high_cost_per_line")).toBe(false);
    });

    it("does not trigger with many lines", () => {
      const session = createSession({
        estimatedCostUSD: 50,
        linesAdded: 500,
        linesRemoved: 500,
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "high_cost_per_line")).toBe(false);
    });
  });

  describe("stalled_exploration", () => {
    it("detects 3+ exploration/minimal-prompt with significant cost", () => {
      const session = createSession({
        exchanges: [
          createExchange({ sequenceNumber: 0, category: "exploration", userPrompt: "continua", estimatedCostUSD: 5 }),
          createExchange({ sequenceNumber: 1, category: "exploration", userPrompt: "continue", estimatedCostUSD: 5 }),
          createExchange({ sequenceNumber: 2, category: "exploration", userPrompt: "sigue", estimatedCostUSD: 5 }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "stalled_exploration")).toBe(true);
    });

    it("does not trigger when cost is low", () => {
      const session = createSession({
        exchanges: [
          createExchange({ sequenceNumber: 0, category: "exploration", userPrompt: "continua", estimatedCostUSD: 0.5 }),
          createExchange({ sequenceNumber: 1, category: "exploration", userPrompt: "continue", estimatedCostUSD: 0.5 }),
          createExchange({ sequenceNumber: 2, category: "exploration", userPrompt: "sigue", estimatedCostUSD: 0.5 }),
        ],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "stalled_exploration")).toBe(false);
    });
  });

  describe("wrong_approach", () => {
    it("detects sessions with wrong_approach friction", () => {
      const session = createSession({
        estimatedCostUSD: 10,
        frictions: [{ type: "wrong_approach", count: 2, detail: "Started with wrong pattern" }],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "wrong_approach")).toBe(true);
    });

    it("does not trigger without matching frictions", () => {
      const session = createSession({
        estimatedCostUSD: 10,
        frictions: [{ type: "unclear_instructions", count: 1, detail: "Ambiguous request" }],
      });
      const signals = engine.analyze([session]);
      expect(signals.some((s) => s.type === "wrong_approach")).toBe(false);
    });
  });

  describe("waste categories", () => {
    it("assigns 'avoidable' category to user-caused waste", () => {
      const session = createSession({
        outcome: "not_achieved",
        gitCommits: 0,
        estimatedCostUSD: 5.0,
      });
      const signals = engine.analyze([session]);
      const abandoned = signals.find((s) => s.type === "abandoned_session");
      expect(abandoned?.category).toBe("avoidable");
    });

    it("assigns 'platform_overhead' category to context_rebuild", () => {
      const session = createSession({
        exchanges: [
          createExchange({
            sequenceNumber: 0,
            tokenUsage: { inputTokens: 10_000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 50_000 },
          }),
          createExchange({
            sequenceNumber: 1,
            tokenUsage: { inputTokens: 10_000, outputTokens: 500, cacheCreationTokens: 80_000, cacheReadTokens: 1_000 },
          }),
        ],
      });
      const signals = engine.analyze([session]);
      const rebuild = signals.find((s) => s.type === "context_rebuild");
      expect(rebuild?.category).toBe("platform_overhead");
    });

    it("uses actual model pricing for context_rebuild cost", () => {
      const session = createSession({
        exchanges: [
          createExchange({
            sequenceNumber: 0,
            model: "claude-opus-4-6",
            tokenUsage: { inputTokens: 10_000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 50_000 },
          }),
          createExchange({
            sequenceNumber: 1,
            model: "claude-opus-4-6",
            tokenUsage: { inputTokens: 10_000, outputTokens: 500, cacheCreationTokens: 100_000, cacheReadTokens: 1_000 },
          }),
        ],
      });
      const signals = engine.analyze([session]);
      const rebuild = signals.find((s) => s.type === "context_rebuild");
      expect(rebuild).toBeDefined();
      // Opus 4.6 cache write is $6.25/M, so 100K tokens = $0.625
      expect(rebuild!.estimatedWastedCostUSD).toBeCloseTo(0.625, 2);
    });

    it("assigns 'avoidable' to retry_loop, debugging_loop, wrong_approach", () => {
      // retry_loop
      const retrySession = createSession({
        exchanges: [
          createExchange({ sequenceNumber: 0, userPrompt: "fix the bug in auth.ts please", filesModified: ["auth.ts"], estimatedCostUSD: 0.5 }),
          createExchange({ sequenceNumber: 1, userPrompt: "fix the bug in auth.ts now", filesModified: ["auth.ts"], estimatedCostUSD: 0.5 }),
          createExchange({ sequenceNumber: 2, userPrompt: "fix the bug in auth.ts again", filesModified: ["auth.ts"], estimatedCostUSD: 0.5 }),
          createExchange({ sequenceNumber: 3, userPrompt: "fix the bug in auth.ts correctly", filesModified: ["auth.ts"], estimatedCostUSD: 0.5 }),
        ],
      });
      const retrySignals = engine.analyze([retrySession]);
      expect(retrySignals.filter((s) => s.type === "retry_loop").every((s) => s.category === "avoidable")).toBe(true);

      // wrong_approach
      const wrongSession = createSession({
        estimatedCostUSD: 10,
        frictions: [{ type: "wrong_approach", count: 2, detail: "Wrong pattern" }],
      });
      const wrongSignals = engine.analyze([wrongSession]);
      expect(wrongSignals.filter((s) => s.type === "wrong_approach").every((s) => s.category === "avoidable")).toBe(true);
    });
  });

  describe("sorting", () => {
    it("sorts signals by wasted cost descending", () => {
      const sessions = [
        createSession({
          id: "s1",
          outcome: "not_achieved",
          gitCommits: 0,
          estimatedCostUSD: 1.0,
        }),
        createSession({
          id: "s2",
          outcome: "not_achieved",
          gitCommits: 0,
          estimatedCostUSD: 10.0,
        }),
      ];
      const signals = engine.analyze(sessions);
      const abandoned = signals.filter((s) => s.type === "abandoned_session");
      expect(abandoned.length).toBe(2);
      expect(abandoned[0].estimatedWastedCostUSD).toBeGreaterThanOrEqual(abandoned[1].estimatedWastedCostUSD);
    });
  });
});
