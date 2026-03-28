import { describe, it, expect, vi } from "vitest";
import {
  renderReportHeader,
  renderByProject,
  renderByModel,
  renderByCategory,
  renderByOutcome,
  renderSessionsList,
  renderSessionDetail,
  renderBranchDetail,
  renderBranchComparison,
  renderWasteReport,
} from "../../src/cli/formatters/table.js";
import { createSession, createExchange, createGitCommit } from "../fixtures/factory.js";
import type { CostBreakdown, BranchWork, WasteSignal } from "../../src/data/models.js";
import { sumTokenUsage } from "../../src/core/token-ledger.js";

function captureConsole(fn: () => void): string {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  fn();
  const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
  spy.mockRestore();
  return output;
}

const sessions = [
  createSession({ projectName: "app-a", estimatedCostUSD: 10, outcome: "fully_achieved", gitCommits: 3 }),
  createSession({ projectName: "app-b", estimatedCostUSD: 5, outcome: "not_achieved", gitCommits: 0 }),
];

const breakdown: CostBreakdown = {
  byProject: { "app-a": 10, "app-b": 5 },
  byBranch: { main: 15 },
  byCategory: { bug_fix: 8, implementation: 7 },
  byModel: { "claude-sonnet-4-5": 10, "claude-opus-4-6": 5 },
  byDay: { "2026-03-01": 15 },
  byOutcome: { fully_achieved: 10, not_achieved: 5 },
};

describe("renderReportHeader", () => {
  it("renders period, cost, session count", () => {
    const output = captureConsole(() => renderReportHeader(sessions, "Last 30 days"));
    expect(output).toContain("Last 30 days");
    expect(output).toContain("$15.00");
    expect(output).toContain("2 sessions");
  });

  it("uses commitsByProject when provided", () => {
    const commits = new Map([["app-a", 5], ["app-b", 2]]);
    const output = captureConsole(() => renderReportHeader(sessions, "Last 7 days", { commitsByProject: commits }));
    expect(output).toContain("7 commits");
  });
});

describe("renderByProject", () => {
  it("renders project table with cost and sessions", () => {
    const output = captureConsole(() => renderByProject(sessions));
    expect(output).toContain("app-a");
    expect(output).toContain("app-b");
    expect(output).toContain("$10.00");
  });

  it("uses commitsByProject for commit counts", () => {
    const commits = new Map([["app-a", 10]]);
    const output = captureConsole(() => renderByProject(sessions, commits));
    expect(output).toContain("10");
  });
});

describe("renderByModel", () => {
  it("renders model table", () => {
    const output = captureConsole(() => renderByModel(breakdown));
    expect(output).toContain("Sonnet 4.5");
    expect(output).toContain("Opus 4.6");
  });
});

describe("renderByCategory", () => {
  it("renders category table with humanized names", () => {
    const output = captureConsole(() => renderByCategory(breakdown));
    expect(output).toContain("Bug Fix");
    expect(output).toContain("Implementation");
  });

  it("limits to top 5 categories and groups the rest as Other", () => {
    const manyCategories: CostBreakdown = {
      ...breakdown,
      byCategory: {
        implementation: 50, bug_fix: 30, documentation: 20,
        feature_request: 15, devops_workflow: 10, code_review: 5,
        exploration: 3, planning: 1,
      },
    };
    const output = captureConsole(() => renderByCategory(manyCategories));
    expect(output).toContain("Implementation");
    expect(output).toContain("Bug Fix");
    expect(output).toContain("Other (3 more)");
    // The 6th+ categories should NOT appear as individual rows
    expect(output).not.toContain("Code Review");
    expect(output).not.toContain("Exploration");
  });
});

describe("renderByOutcome", () => {
  it("renders outcome table when mixed outcomes", () => {
    const output = captureConsole(() => renderByOutcome(breakdown));
    expect(output).toContain("fully_achieved");
    expect(output).toContain("not_achieved");
    expect(output).toContain("By Outcome");
  });

  it("renders inline when one outcome dominates (>90%)", () => {
    const dominant: CostBreakdown = {
      ...breakdown,
      byOutcome: { fully_achieved: 95, not_achieved: 3, unknown: 2 },
    };
    const output = captureConsole(() => renderByOutcome(dominant));
    expect(output).toContain("Outcomes:");
    expect(output).toContain("95%");
    expect(output).not.toContain("By Outcome");
  });
});

describe("renderSessionsList", () => {
  it("renders session rows", () => {
    const output = captureConsole(() => renderSessionsList(sessions));
    expect(output).toContain("app-a");
    expect(output).toContain("app-b");
  });
});

describe("renderSessionDetail", () => {
  it("renders session detail with exchanges", () => {
    const session = createSession({
      exchanges: [
        createExchange({ sequenceNumber: 0, estimatedCostUSD: 0.5 }),
        createExchange({ sequenceNumber: 1, estimatedCostUSD: 0.3, category: "exploration", toolsUsed: ["Read"] }),
      ],
      frictions: [{ type: "wrong_approach", count: 1, detail: "Started wrong" }],
    });
    const output = captureConsole(() => renderSessionDetail(session));
    expect(output).toContain("Session:");
    expect(output).toContain("Token Usage");
    expect(output).toContain("Exchanges (2 total");
    expect(output).toContain("Frictions");
  });

  it("limits exchanges to top 15 by cost and shows omitted count", () => {
    const exchanges = Array.from({ length: 20 }, (_, i) =>
      createExchange({ sequenceNumber: i, estimatedCostUSD: (20 - i) * 0.1 }),
    );
    const session = createSession({ exchanges });
    const output = captureConsole(() => renderSessionDetail(session));
    expect(output).toContain("20 total, showing top 15 by cost");
    expect(output).toContain("... and 5 more exchanges");
  });

  it("renders waste signals and commits when provided", () => {
    const session = createSession();
    const signals: WasteSignal[] = [{
      type: "abandoned_session",
      sessionId: session.id,
      estimatedWastedCostUSD: 5,
      description: "Test waste",
      suggestion: "Do better",
    }];
    const commits = [createGitCommit()];
    const output = captureConsole(() => renderSessionDetail(session, signals, commits));
    expect(output).toContain("Waste Signals");
    expect(output).toContain("Correlated Commits");
  });

  it("cleans long prompts with XML tags", () => {
    const longPrompt = "Fix the bug please\n<bash-stdout>some long output here that spans many lines and contains details</bash-stdout>\nMore text after the tag that is also quite long to trigger cleaning";
    const session = createSession({
      exchanges: [createExchange({ sequenceNumber: 0, userPrompt: longPrompt })],
    });
    const output = captureConsole(() => renderSessionDetail(session));
    expect(output).toContain("collapsed");
  });

  it("handles session with tool counts and languages", () => {
    const session = createSession({
      toolCounts: { Edit: 5, Read: 10, "mcp__claude-in-chrome__navigate": 2 },
      languages: { typescript: 15, python: 3 },
      exchanges: [createExchange()],
    });
    const output = captureConsole(() => renderSessionDetail(session));
    expect(output).toContain("Tools:");
    expect(output).toContain("Languages:");
    expect(output).toContain("chrome:navigate");
  });

  it("handles session with no exchanges", () => {
    const session = createSession({ exchanges: [] });
    const output = captureConsole(() => renderSessionDetail(session));
    expect(output).toContain("Session:");
    expect(output).not.toContain("Exchanges (");
  });

  it("renders all outcome types", () => {
    for (const outcome of ["fully_achieved", "mostly_achieved", "partially_achieved", "not_achieved", "unknown"] as const) {
      const s = [createSession({ outcome })];
      const output = captureConsole(() => renderSessionsList(s));
      expect(output.length).toBeGreaterThan(0);
    }
  });

  it("wraps long goal text", () => {
    const session = createSession({
      goal: "A ".repeat(200), // very long goal
      exchanges: [createExchange()],
    });
    const output = captureConsole(() => renderSessionDetail(session));
    expect(output).toContain("Goal:");
  });
});

describe("renderBranchDetail", () => {
  it("renders branch metrics and tables", () => {
    const bw: BranchWork = {
      branchName: "feature/test",
      projectPath: "/test",
      sessions: [createSession()],
      commits: [createGitCommit()],
      totalTokens: sumTokenUsage([sessions[0].tokenUsage]),
      totalCostUSD: 10,
      costPerCommit: 10,
      costPerLineChanged: 0.25,
      wasteRatio: 0,
      timeSpan: { start: new Date("2026-03-01"), end: new Date("2026-03-02") },
    };
    const output = captureConsole(() => renderBranchDetail(bw));
    expect(output).toContain("feature/test");
    expect(output).toContain("$10.00");
    expect(output).toContain("Sessions");
    expect(output).toContain("Commits");
  });

  it("shows warnings when provided", () => {
    const bw: BranchWork = {
      branchName: "test",
      projectPath: "/test",
      sessions: [createSession()],
      commits: [],
      totalTokens: sumTokenUsage([]),
      totalCostUSD: 0,
      costPerCommit: 0,
      costPerLineChanged: 0,
      wasteRatio: 0,
      timeSpan: { start: new Date(), end: new Date() },
    };
    const output = captureConsole(() => renderBranchDetail(bw, ["Git repo not found"]));
    expect(output).toContain("Git repo not found");
    expect(output).toContain("No git commits found");
  });
});

describe("renderBranchComparison", () => {
  it("renders comparison table", () => {
    const bw: BranchWork = {
      branchName: "feature/a",
      projectPath: "/test",
      sessions: [createSession()],
      commits: [createGitCommit()],
      totalTokens: sumTokenUsage([]),
      totalCostUSD: 10,
      costPerCommit: 10,
      costPerLineChanged: 0.5,
      wasteRatio: 0.1,
      timeSpan: { start: new Date(), end: new Date() },
    };
    const output = captureConsole(() => renderBranchComparison(bw, null));
    expect(output).toContain("Branch Comparison");
    expect(output).toContain("feature/a");
  });
});

describe("renderWasteReport", () => {
  it("renders waste summary and signals", () => {
    const signals: WasteSignal[] = [
      { type: "abandoned_session", sessionId: "s1", estimatedWastedCostUSD: 5, description: "No commits", suggestion: "Plan better" },
      { type: "retry_loop", sessionId: "s2", estimatedWastedCostUSD: 3, description: "3 retries", suggestion: "Give context" },
    ];
    const output = captureConsole(() => renderWasteReport(signals, sessions, "Last 30 days"));
    expect(output).toContain("Waste Report");
    expect(output).toContain("$8.00"); // total waste
    expect(output).toContain("Abandoned Session");
    expect(output).toContain("Tips");
  });

  it("renders clean message when no signals", () => {
    const output = captureConsole(() => renderWasteReport([], sessions, "Last 7 days"));
    expect(output).toContain("No waste signals detected");
  });
});
