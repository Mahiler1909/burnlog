import { describe, it, expect } from "vitest";
import { inferOutcome, inferSummary, inferGoal, inferGoalCategory } from "../../src/providers/claude-code/outcome-inferrer.js";
import { createExchange } from "../fixtures/factory.js";

describe("inferOutcome", () => {
  const emptyActivity = { linesAdded: 0, linesRemoved: 0, filesModified: new Set<string>(), filesRead: new Set<string>(), editCount: 0, writeCount: 0, toolCounts: {} };

  it("returns unknown for empty exchanges", () => {
    expect(inferOutcome([], emptyActivity, undefined)).toBe("unknown");
  });

  it("returns fully_achieved for impl + changes + no errors", () => {
    const ex = [createExchange({ category: "implementation" })];
    const activity = { ...emptyActivity, linesAdded: 10, filesModified: new Set(["a.ts"]) };
    const meta = { tool_errors: 0, user_interruptions: 0 } as any;
    expect(inferOutcome(ex, activity, meta)).toBe("fully_achieved");
  });

  it("returns partially_achieved when errors exist", () => {
    const ex = [createExchange({ category: "implementation" })];
    const activity = { ...emptyActivity, linesAdded: 10, filesModified: new Set(["a.ts"]) };
    const meta = { tool_errors: 3, user_interruptions: 0 } as any;
    expect(inferOutcome(ex, activity, meta)).toBe("partially_achieved");
  });

  it("returns not_achieved for expensive exploration-only sessions", () => {
    const ex = Array.from({ length: 5 }, (_, i) =>
      createExchange({ category: "exploration", estimatedCostUSD: 0.5 }),
    );
    expect(inferOutcome(ex, emptyActivity, undefined)).toBe("not_achieved");
  });
});

describe("inferSummary", () => {
  it("returns empty for no exchanges", () => {
    expect(inferSummary([])).toBe("");
  });

  it("extracts first prompt + modified files", () => {
    const ex = [
      createExchange({ userPrompt: "Fix the login bug", filesModified: ["auth.ts", "login.tsx"] }),
    ];
    const result = inferSummary(ex);
    expect(result).toContain("Fix the login bug");
    expect(result).toContain("auth.ts");
  });
});

describe("inferGoal", () => {
  it("prefers firstRawPrompt when available", () => {
    expect(inferGoal([], "This is my detailed request for something")).toBe("This is my detailed request for something");
  });

  it("uses first substantive exchange prompt", () => {
    const ex = [
      createExchange({ userPrompt: "hi" }),
      createExchange({ userPrompt: "Please implement the authentication flow" }),
    ];
    expect(inferGoal(ex)).toBe("Please implement the authentication flow");
  });
});

describe("inferGoalCategory", () => {
  it("returns unknown for no exchanges", () => {
    expect(inferGoalCategory([])).toBe("unknown");
  });

  it("returns most common category", () => {
    const ex = [
      createExchange({ category: "implementation" }),
      createExchange({ category: "implementation" }),
      createExchange({ category: "exploration" }),
    ];
    expect(inferGoalCategory(ex)).toBe("implementation");
  });
});
