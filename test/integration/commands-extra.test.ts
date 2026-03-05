import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSession } from "../fixtures/factory.js";
import { setTestSessions, clearTestSessions, createMockProvider, createMockGitAnalyzer } from "../fixtures/mock-providers.js";

vi.mock("../../src/providers/claude-code/provider.js", () => createMockProvider());
vi.mock("../../src/git/git-analyzer.js", () => createMockGitAnalyzer());

describe("sessionCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => consoleSpy.mockRestore());

  it("finds session by prefix and outputs JSON", async () => {
    setTestSessions([
      createSession({ id: "abc12345-full-id", estimatedCostUSD: 7, summary: "Fix auth" }),
    ]);
    const { sessionCommand } = await import("../../src/cli/commands/session.js");
    await sessionCommand("abc12345", { format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe("abc12345-full-id");
    expect(parsed.cost).toBe(7);
    expect(parsed.exchanges).toBeDefined();
    expect(parsed.wasteSignals).toBeDefined();
  });

  it("prints not found for unknown session", async () => {
    setTestSessions([createSession({ id: "known-id" })]);
    const { sessionCommand } = await import("../../src/cli/commands/session.js");
    await sessionCommand("nonexistent", { format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Session not found");
  });
});

describe("branchCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => consoleSpy.mockRestore());

  it("outputs branch JSON with session and commit data", async () => {
    setTestSessions([
      createSession({ gitBranch: "feature/login", estimatedCostUSD: 8 }),
    ]);
    const { branchCommand } = await import("../../src/cli/commands/branch.js");
    await branchCommand("feature/login", { format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.branch).toBe("feature/login");
    expect(parsed.cost).toBe(8);
    expect(parsed.sessionList).toHaveLength(1);
  });

  it("prints not found for unmatched branch", async () => {
    setTestSessions([createSession({ gitBranch: "main" })]);
    const { branchCommand } = await import("../../src/cli/commands/branch.js");
    await branchCommand("nonexistent-branch", { format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No sessions found for branch");
  });

  it("prints message when no sessions at all", async () => {
    clearTestSessions();
    const { branchCommand } = await import("../../src/cli/commands/branch.js");
    await branchCommand("any", { format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No sessions found");
  });
});

describe("compareCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => consoleSpy.mockRestore());

  it("compares two branches in JSON format", async () => {
    setTestSessions([
      createSession({ gitBranch: "feature/a", estimatedCostUSD: 5 }),
      createSession({ gitBranch: "feature/b", estimatedCostUSD: 10 }),
    ]);
    const { compareCommand } = await import("../../src/cli/commands/compare.js");
    await compareCommand("feature/a", "feature/b", { format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].branch).toBe("feature/a");
    expect(parsed[1].branch).toBe("feature/b");
  });

  it("prints message when no sessions found", async () => {
    clearTestSessions();
    const { compareCommand } = await import("../../src/cli/commands/compare.js");
    await compareCommand("a", "b", { format: "json" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("No sessions found");
  });
});
