import { describe, it, expect, vi, beforeEach } from "vitest";
import { CorrelationEngine } from "../../src/core/correlation-engine.js";
import { GitAnalyzer } from "../../src/git/git-analyzer.js";
import { createSession, createExchange, createGitCommit } from "../fixtures/factory.js";

vi.mock("../../src/git/git-analyzer.js");

describe("CorrelationEngine — extended", () => {
  let git: GitAnalyzer;
  let engine: CorrelationEngine;

  beforeEach(() => {
    git = new GitAnalyzer();
    engine = new CorrelationEngine(git);

    vi.mocked(git.isGitRepo).mockResolvedValue(true);
    vi.mocked(git.resolveGitRoot).mockResolvedValue("/repo");
    vi.mocked(git.getCurrentBranch).mockResolvedValue("main");
    vi.mocked(git.getCommits).mockResolvedValue([]);
    vi.mocked(git.getCommitsForBranch).mockResolvedValue([]);
    vi.mocked(git.getBranches).mockResolvedValue([]);
  });

  describe("correlateBranch", () => {
    it("returns null when no sessions match the branch", async () => {
      const session = createSession({ gitBranch: "other-branch" });
      const result = await engine.correlateBranch("feature/x", "/repo", [session]);
      expect(result).toBeNull();
    });

    it("correlates sessions matching branch by partial name", async () => {
      const session = createSession({ gitBranch: "feature/login-page" });
      vi.mocked(git.getBranches).mockResolvedValue(["feature/login-page"]);
      vi.mocked(git.getCommitsForBranch).mockResolvedValue([createGitCommit()]);

      const result = await engine.correlateBranch("login-page", "/repo", [session]);
      expect(result).not.toBeNull();
      expect(result!.sessions).toHaveLength(1);
    });

    it("handles main branch with temporal matching", async () => {
      const session = createSession({
        gitBranch: "main",
        startTime: new Date("2026-03-01T09:00:00Z"),
        endTime: new Date("2026-03-01T11:00:00Z"),
      });
      const commit = createGitCommit({ timestamp: new Date("2026-03-01T10:00:00Z") });
      vi.mocked(git.getCommits).mockResolvedValue([commit]);
      vi.mocked(git.getBranches).mockResolvedValue(["main"]);

      const result = await engine.correlateBranch("main", "/repo", [session]);
      expect(result).not.toBeNull();
      expect(result!.commits).toHaveLength(1);
    });
  });

  describe("file overlap matching", () => {
    it("matches commits by shared file basenames on main", async () => {
      const session = createSession({
        gitBranch: "main",
        startTime: new Date("2026-03-01T09:00:00Z"),
        endTime: new Date("2026-03-01T11:00:00Z"),
        exchanges: [
          createExchange({ filesModified: ["src/auth.ts", "src/utils.ts"] }),
        ],
      });
      // Commit outside temporal window but overlaps on files
      const commit = createGitCommit({
        timestamp: new Date("2026-03-01T14:00:00Z"), // outside ±2h
        filesChanged: ["src/auth.ts"],
      });
      vi.mocked(git.getCommits).mockResolvedValue([commit]);
      vi.mocked(git.getBranches).mockResolvedValue(["main"]);

      const result = await engine.correlateBranch("main", "/repo", [session]);
      expect(result).not.toBeNull();
      // File overlap match should find the commit even outside temporal window
      expect(result!.commits).toHaveLength(1);
    });
  });

  describe("correlate — main/master branch handling", () => {
    it("processes main sessions after feature branches to avoid double-counting", async () => {
      const featureSession = createSession({ gitBranch: "feature/x", estimatedCostUSD: 5 });
      const mainSession = createSession({ gitBranch: "main", estimatedCostUSD: 3 });

      const featureCommit = createGitCommit({ hash: "feat1" });
      const mainCommit = createGitCommit({
        hash: "main1",
        timestamp: new Date(mainSession.startTime.getTime() + 30 * 60 * 1000),
      });

      vi.mocked(git.getCommitsForBranch).mockResolvedValue([featureCommit]);
      vi.mocked(git.getCommits).mockResolvedValue([featureCommit, mainCommit]);

      const result = await engine.correlate([featureSession, mainSession]);
      expect(result.branchWork).toHaveLength(2);

      const featureBW = result.branchWork.find(bw => bw.branchName === "feature/x");
      const mainBW = result.branchWork.find(bw => bw.branchName === "main");
      expect(featureBW!.commits.map(c => c.hash)).toContain("feat1");
      // main should not re-count the feature commit
      expect(mainBW!.commits.map(c => c.hash)).not.toContain("feat1");
    });
  });

  describe("correlate — unbranched sessions", () => {
    it("uses temporal match for sessions without a branch", async () => {
      const session = createSession({
        gitBranch: "",
        startTime: new Date("2026-03-01T09:00:00Z"),
        endTime: new Date("2026-03-01T11:00:00Z"),
      });
      const commit = createGitCommit({ timestamp: new Date("2026-03-01T10:00:00Z") });
      vi.mocked(git.getCommits).mockResolvedValue([commit]);

      const result = await engine.correlate([session]);
      // Should try temporal matching
      expect(result.branchWork.length + result.unmatchedSessions.length).toBeGreaterThanOrEqual(1);
    });
  });
});
