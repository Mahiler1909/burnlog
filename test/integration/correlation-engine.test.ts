import { describe, it, expect, vi, beforeEach } from "vitest";
import { CorrelationEngine } from "../../src/core/correlation-engine.js";
import { GitAnalyzer } from "../../src/git/git-analyzer.js";
import { createSession, createGitCommit } from "../fixtures/factory.js";

vi.mock("../../src/git/git-analyzer.js");

describe("CorrelationEngine", () => {
  let git: GitAnalyzer;
  let engine: CorrelationEngine;

  beforeEach(() => {
    git = new GitAnalyzer();
    engine = new CorrelationEngine(git);

    vi.mocked(git.isGitRepo).mockResolvedValue(true);
    vi.mocked(git.resolveGitRoot).mockResolvedValue("/Users/test/projects/my-app");
    vi.mocked(git.getCurrentBranch).mockResolvedValue("main");
    vi.mocked(git.getCommits).mockResolvedValue([]);
    vi.mocked(git.getCommitsForBranch).mockResolvedValue([]);
  });

  it("returns empty result for empty sessions", async () => {
    const result = await engine.correlate([]);
    expect(result.branchWork).toHaveLength(0);
    expect(result.unmatchedSessions).toHaveLength(0);
  });

  it("matches sessions to commits by branch name", async () => {
    const session = createSession({ gitBranch: "feature/auth" });
    const commit = createGitCommit({ branch: "feature/auth" });

    vi.mocked(git.getCommitsForBranch).mockResolvedValue([commit]);

    const result = await engine.correlate([session]);
    expect(result.branchWork).toHaveLength(1);
    expect(result.branchWork[0].branchName).toBe("feature/auth");
    expect(result.branchWork[0].commits).toHaveLength(1);
  });

  it("resolves HEAD branch to current branch", async () => {
    vi.mocked(git.getCurrentBranch).mockResolvedValue("main");
    const session = createSession({ gitBranch: "HEAD" });
    const commit = createGitCommit({
      branch: "main",
      timestamp: new Date(session.startTime.getTime() + 30 * 60 * 1000),
    });
    vi.mocked(git.getCommits).mockResolvedValue([commit]);

    const result = await engine.correlate([session]);
    // HEAD should be resolved to "main" — should produce branchWork
    expect(result.branchWork.length).toBeGreaterThanOrEqual(1);
    const mainBranch = result.branchWork.find((bw) => bw.branchName === "main");
    expect(mainBranch).toBeDefined();
    expect(mainBranch!.sessions).toHaveLength(1);
  });

  it("uses temporal matching when no branch commits found", async () => {
    const session = createSession({
      gitBranch: "feature/new",
      startTime: new Date("2026-03-01T09:00:00Z"),
      endTime: new Date("2026-03-01T11:00:00Z"),
    });
    const commit = createGitCommit({
      timestamp: new Date("2026-03-01T10:00:00Z"),
    });

    vi.mocked(git.getCommitsForBranch).mockResolvedValue([]);
    vi.mocked(git.getCommits).mockResolvedValue([commit]);

    const result = await engine.correlate([session]);
    expect(result.branchWork).toHaveLength(1);
    expect(result.branchWork[0].commits).toHaveLength(1);
  });

  it("returns unmatched sessions when not a git repo", async () => {
    vi.mocked(git.isGitRepo).mockResolvedValue(false);
    const session = createSession();

    const result = await engine.correlate([session]);
    expect(result.branchWork).toHaveLength(0);
    expect(result.unmatchedSessions).toHaveLength(1);
  });

  it("builds BranchWork with correct metrics", async () => {
    const session = createSession({
      gitBranch: "feature/test",
      estimatedCostUSD: 10,
      outcome: "not_achieved",
    });
    const commits = [
      createGitCommit({ linesAdded: 50, linesRemoved: 10 }),
      createGitCommit({ hash: "def456", linesAdded: 20, linesRemoved: 5 }),
    ];

    vi.mocked(git.getCommitsForBranch).mockResolvedValue(commits);

    const result = await engine.correlate([session]);
    expect(result.branchWork).toHaveLength(1);

    const bw = result.branchWork[0];
    expect(bw.totalCostUSD).toBe(10);
    expect(bw.costPerCommit).toBe(5);
    expect(bw.wasteRatio).toBe(1); // all not_achieved
    expect(bw.commits).toHaveLength(2);
  });
});
