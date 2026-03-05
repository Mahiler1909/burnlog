import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSession, createExchange } from "../fixtures/factory.js";
import type { Session } from "../../src/data/models.js";
import { setTestSessions, clearTestSessions, createMockProvider, createMockGitAnalyzer } from "../fixtures/mock-providers.js";

vi.mock("../../src/providers/claude-code/provider.js", () => createMockProvider());
vi.mock("../../src/git/git-analyzer.js", () => createMockGitAnalyzer());

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
    setTestSessions(makeTestSessions());
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("sorts sessions by cost", async () => {
    const { sessionsCommand } = await import("../../src/cli/commands/sessions.js");
    await sessionsCommand({ sort: "cost", format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed[0].cost).toBeGreaterThanOrEqual(parsed[1].cost);
  });

  it("limits output count", async () => {
    const { sessionsCommand } = await import("../../src/cli/commands/sessions.js");
    await sessionsCommand({ limit: 1, format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
  });

  it("sorts by tokens", async () => {
    const { sessionsCommand } = await import("../../src/cli/commands/sessions.js");
    await sessionsCommand({ sort: "tokens", format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed[0].tokens).toBeGreaterThanOrEqual(parsed[1].tokens);
  });

  it("shows all sessions with --all flag", async () => {
    const { sessionsCommand } = await import("../../src/cli/commands/sessions.js");
    await sessionsCommand({ all: true, format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
  });

  it("prints message when no sessions found", async () => {
    clearTestSessions();
    const { sessionsCommand } = await import("../../src/cli/commands/sessions.js");
    await sessionsCommand({ format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No sessions found");
  });

  it("outputs CSV format", async () => {
    const { sessionsCommand } = await import("../../src/cli/commands/sessions.js");
    await sessionsCommand({ format: "csv" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("id,date,project,branch,cost,tokens,outcome,summary");
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

  it("prints message when no sessions found", async () => {
    clearTestSessions();
    const { wasteCommand } = await import("../../src/cli/commands/waste.js");
    await wasteCommand({ format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No sessions found");
  });

  it("detects waste signals in sessions", async () => {
    setTestSessions([
      createSession({
        id: "waste-session",
        outcome: "not_achieved",
        gitCommits: 0,
        estimatedCostUSD: 20,
        startTime: new Date(),
      }),
    ]);

    const { wasteCommand } = await import("../../src/cli/commands/waste.js");
    await wasteCommand({ format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
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

  it("prints message when no sessions found", async () => {
    clearTestSessions();
    const { reportCommand } = await import("../../src/cli/commands/report.js");
    await reportCommand({ format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No sessions found");
  });

  it("produces JSON output with summary and breakdowns", async () => {
    setTestSessions(makeTestSessions());

    const { reportCommand } = await import("../../src/cli/commands/report.js");
    await reportCommand({ format: "json", period: "90d" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.totalCost).toBeGreaterThan(0);
    expect(parsed.byProject).toBeDefined();
    expect(parsed.byModel).toBeDefined();
  });
});
