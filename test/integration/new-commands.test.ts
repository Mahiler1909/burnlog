import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSession, createExchange } from "../fixtures/factory.js";
import type { Session, SessionOutcome } from "../../src/data/models.js";
import { setTestSessions, clearTestSessions, createMockProvider, createMockGitAnalyzer } from "../fixtures/mock-providers.js";

vi.mock("../../src/providers/claude-code/provider.js", () => createMockProvider());
vi.mock("../../src/git/git-analyzer.js", () => createMockGitAnalyzer());

function makeTodaySessions(): Session[] {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  return [
    createSession({
      id: "today-1",
      projectName: "my-app",
      estimatedCostUSD: 5,
      startTime: new Date(`${todayStr}T09:00:00Z`),
      endTime: new Date(`${todayStr}T10:00:00Z`),
      outcome: "fully_achieved" as SessionOutcome,
      exchanges: [createExchange({ model: "claude-sonnet-4-5", estimatedCostUSD: 5 })],
    }),
    createSession({
      id: "today-2",
      projectName: "burnlog",
      estimatedCostUSD: 3,
      startTime: new Date(`${todayStr}T14:00:00Z`),
      endTime: new Date(`${todayStr}T15:00:00Z`),
      outcome: "partially_achieved" as SessionOutcome,
      exchanges: [createExchange({ model: "claude-opus-4-6", estimatedCostUSD: 3 })],
    }),
    createSession({
      id: "yesterday-1",
      projectName: "my-app",
      estimatedCostUSD: 10,
      startTime: new Date(yesterday.toISOString().slice(0, 10) + "T09:00:00Z"),
      endTime: new Date(yesterday.toISOString().slice(0, 10) + "T11:00:00Z"),
      outcome: "fully_achieved" as SessionOutcome,
      exchanges: [createExchange({ model: "claude-sonnet-4-5", estimatedCostUSD: 10 })],
    }),
  ];
}

function makeWeeklySessions(): Session[] {
  const sessions: Session[] = [];
  const now = new Date();
  for (let w = 0; w < 4; w++) {
    for (let d = 0; d < 3; d++) {
      const date = new Date(now);
      date.setDate(date.getDate() - w * 7 - d);
      sessions.push(
        createSession({
          id: `week${w}-day${d}`,
          projectName: "my-app",
          estimatedCostUSD: 5 + w,
          startTime: date,
          endTime: new Date(date.getTime() + 3600000),
          outcome: w < 2 ? "fully_achieved" as SessionOutcome : "partially_achieved" as SessionOutcome,
          exchanges: [createExchange({ estimatedCostUSD: 5 + w })],
        }),
      );
    }
  }
  return sessions;
}

describe("todayCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("shows today's summary in JSON", async () => {
    setTestSessions(makeTodaySessions());
    const { todayCommand } = await import("../../src/cli/commands/today.js");
    await todayCommand({ format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.date).toBeDefined();
    expect(parsed.cost).toBeGreaterThan(0);
    expect(parsed.sessions).toBe(2);
    expect(parsed.efficiencyScore).toBeDefined();
  });

  it("prints message when no sessions in last 7 days", async () => {
    clearTestSessions();
    const { todayCommand } = await import("../../src/cli/commands/today.js");
    await todayCommand({ format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No sessions found in the last 7 days");
  });

  it("shows last activity when no sessions today but recent sessions exist", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    // Only yesterday sessions, none today
    setTestSessions([
      createSession({
        id: "yesterday-only",
        projectName: "my-app",
        estimatedCostUSD: 12,
        startTime: new Date(`${yesterdayStr}T09:00:00Z`),
        endTime: new Date(`${yesterdayStr}T10:00:00Z`),
        outcome: "fully_achieved" as SessionOutcome,
        exchanges: [createExchange({ estimatedCostUSD: 12 })],
      }),
    ]);
    const { todayCommand } = await import("../../src/cli/commands/today.js");
    await todayCommand({ format: "table" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("No sessions today");
    expect(output).toContain("Last activity:");
    expect(output).toContain("my-app");
  });

  it("renders table format", async () => {
    setTestSessions(makeTodaySessions());
    const { todayCommand } = await import("../../src/cli/commands/today.js");
    await todayCommand({ format: "table" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Burnlog Today");
    expect(output).toContain("Score:");
  });
});

describe("trendsCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("shows weekly trends in JSON", async () => {
    setTestSessions(makeWeeklySessions());
    const { trendsCommand } = await import("../../src/cli/commands/trends.js");
    await trendsCommand({ weeks: "4", format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.weeks).toBeDefined();
    expect(parsed.weeks.length).toBeGreaterThan(0);
  });

  it("prints message when no sessions found", async () => {
    clearTestSessions();
    const { trendsCommand } = await import("../../src/cli/commands/trends.js");
    await trendsCommand({ format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No sessions found");
  });

  it("renders table format with sparklines", async () => {
    setTestSessions(makeWeeklySessions());
    const { trendsCommand } = await import("../../src/cli/commands/trends.js");
    await trendsCommand({ weeks: "2", format: "table" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Burnlog Trends");
  });
});

describe("budgetCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("shows message when no budget configured", async () => {
    // Mock loadBudgetConfig to return empty config regardless of local machine state
    const budgetModule = await import("../../src/core/budget.js");
    vi.spyOn(budgetModule, "loadBudgetConfig").mockResolvedValue({});

    const { budgetCommand } = await import("../../src/cli/commands/budget.js");
    await budgetCommand({ format: "table" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No budget configured");
  });
});

describe("reportCommand with efficiency", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("includes efficiency score in JSON output", async () => {
    setTestSessions([
      createSession({
        id: "report-1",
        estimatedCostUSD: 10,
        startTime: new Date(),
        outcome: "fully_achieved" as SessionOutcome,
        exchanges: [createExchange({ model: "claude-sonnet-4-5", estimatedCostUSD: 10 })],
      }),
    ]);

    const { reportCommand } = await import("../../src/cli/commands/report.js");
    await reportCommand({ format: "json", period: "7d" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.summary.efficiencyScore).toBeDefined();
    expect(typeof parsed.summary.efficiencyScore).toBe("number");
  });
});
