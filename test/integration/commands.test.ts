import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSession, createExchange } from "../fixtures/factory.js";
import type { Session } from "../../src/data/models.js";

let testSessions: Session[] = [];

vi.mock("../../src/providers/claude-code/provider.js", () => {
  return {
    ClaudeCodeProvider: class {
      name = "claude-code";
      isAvailable() { return true; }
      async listProjects() { return []; }
      async loadSessionsForProject() { return []; }
      async loadAllSessions() { return testSessions; }
    },
  };
});

vi.mock("../../src/git/git-analyzer.js", () => {
  return {
    GitAnalyzer: class {
      async isGitRepo() { return false; }
      async resolveGitRoot() { return null; }
      async getCurrentBranch() { return "main"; }
      async getCommits() { return []; }
      async getCommitsForBranch() { return []; }
      async getBranches() { return []; }
    },
  };
});

function makeTestSessions(): Session[] {
  return [
    createSession({
      id: "session-1",
      projectName: "my-app",
      estimatedCostUSD: 5,
      startTime: new Date("2026-03-01T09:00:00Z"),
      tokenUsage: { inputTokens: 50000, outputTokens: 30000, cacheCreationTokens: 0, cacheReadTokens: 0 },
      outcome: "fully_achieved",
      exchanges: [createExchange({ model: "claude-sonnet-4-5", estimatedCostUSD: 5 })],
    }),
    createSession({
      id: "session-2",
      projectName: "burnlog",
      estimatedCostUSD: 10,
      startTime: new Date("2026-03-02T09:00:00Z"),
      tokenUsage: { inputTokens: 100000, outputTokens: 50000, cacheCreationTokens: 0, cacheReadTokens: 0 },
      outcome: "not_achieved",
      gitCommits: 0,
      exchanges: [createExchange({ model: "claude-opus-4-6", estimatedCostUSD: 10 })],
    }),
  ];
}

describe("sessionsCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    testSessions = makeTestSessions();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("sorts sessions by cost", async () => {
    const { sessionsCommand } = await import("../../src/cli/commands/sessions.js");
    await sessionsCommand({ sort: "cost", format: "json" });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed[0].cost).toBeGreaterThanOrEqual(parsed[1].cost);
  });

  it("limits output count", async () => {
    const { sessionsCommand } = await import("../../src/cli/commands/sessions.js");
    await sessionsCommand({ limit: 1, format: "json" });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
  });
});

describe("wasteCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("detects waste signals in sessions", async () => {
    testSessions = [
      createSession({
        id: "waste-session",
        outcome: "not_achieved",
        gitCommits: 0,
        estimatedCostUSD: 20,
        startTime: new Date(),
      }),
    ];

    const { wasteCommand } = await import("../../src/cli/commands/waste.js");
    await wasteCommand({ format: "json" });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.some((s: any) => s.type === "abandoned_session")).toBe(true);
  });
});

describe("reportCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("produces JSON output with summary and breakdowns", async () => {
    testSessions = makeTestSessions();

    const { reportCommand } = await import("../../src/cli/commands/report.js");
    await reportCommand({ format: "json", period: "90d" });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.totalCost).toBeGreaterThan(0);
    expect(parsed.byProject).toBeDefined();
    expect(parsed.byModel).toBeDefined();
  });
});
