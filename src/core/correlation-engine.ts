import type { Session, GitCommit, BranchWork, CorrelationResult } from "../data/models.js";
import { sumTokenUsage } from "./token-ledger.js";
import { GitAnalyzer } from "../git/git-analyzer.js";

export class CorrelationEngine {
  constructor(private git: GitAnalyzer) {}

  /**
   * Correlate all sessions with git data, grouped by project then branch.
   */
  async correlate(sessions: Session[]): Promise<CorrelationResult> {
    // Group sessions by project path
    const byProject = new Map<string, Session[]>();
    for (const s of sessions) {
      const list = byProject.get(s.projectPath) ?? [];
      list.push(s);
      byProject.set(s.projectPath, list);
    }

    const allBranchWork: BranchWork[] = [];
    const unmatchedSessions: Session[] = [];

    for (const [projectPath, projectSessions] of byProject) {
      const result = await this.correlateProject(projectPath, projectSessions);
      allBranchWork.push(...result.branchWork);
      unmatchedSessions.push(...result.unmatchedSessions);
    }

    // Sort by cost descending
    allBranchWork.sort((a, b) => b.totalCostUSD - a.totalCostUSD);

    return { branchWork: allBranchWork, unmatchedSessions };
  }

  /**
   * Correlate sessions for a single project with its git data.
   */
  async correlateProject(
    projectPath: string,
    sessions: Session[],
  ): Promise<CorrelationResult> {
    const isRepo = await this.git.isGitRepo(projectPath);
    if (!isRepo) {
      // No git repo — all sessions are unmatched
      return { branchWork: [], unmatchedSessions: sessions };
    }

    // Get time bounds from sessions
    const earliest = new Date(Math.min(...sessions.map((s) => s.startTime.getTime())));
    const latest = new Date(Math.max(...sessions.map((s) => s.endTime.getTime())));
    const since = new Date(earliest.getTime() - 24 * 60 * 60 * 1000); // -1 day
    const until = new Date(latest.getTime() + 24 * 60 * 60 * 1000); // +1 day

    // Get all commits in the time range
    const allCommits = await this.git.getCommits(projectPath, { since, until });

    // Tier 1: Group sessions by branch name
    const branchGroups = new Map<string, Session[]>();
    const unbranchedSessions: Session[] = [];

    for (const s of sessions) {
      if (s.gitBranch && s.gitBranch !== "HEAD") {
        const list = branchGroups.get(s.gitBranch) ?? [];
        list.push(s);
        branchGroups.set(s.gitBranch, list);
      } else {
        unbranchedSessions.push(s);
      }
    }

    const branchWork: BranchWork[] = [];

    // Process each branch group
    for (const [branch, branchSessions] of branchGroups) {
      if (branch === "main" || branch === "master") {
        // Main branch: get merge commits in time window
        const mainCommits = allCommits.filter((c) =>
          this.isInTimeWindow(c, branchSessions),
        );
        branchWork.push(this.buildBranchWork(branch, projectPath, branchSessions, mainCommits));
        continue;
      }

      // Feature branch: get exclusive commits
      const branchCommits = await this.git.getCommitsForBranch(projectPath, branch);
      // Also try temporal match if branch had no exclusive commits
      const matched = branchCommits.length > 0
        ? branchCommits
        : this.temporalMatch(allCommits, branchSessions);

      branchWork.push(this.buildBranchWork(branch, projectPath, branchSessions, matched));
    }

    // Tier 2: Temporal match for sessions without branch
    const matchedCommitHashes = new Set(branchWork.flatMap((bw) => bw.commits.map((c) => c.hash)));
    const remainingCommits = allCommits.filter((c) => !matchedCommitHashes.has(c.hash));

    for (const s of unbranchedSessions) {
      const matched = this.temporalMatch(remainingCommits, [s]);
      if (matched.length > 0) {
        branchWork.push(this.buildBranchWork("(untracked)", projectPath, [s], matched));
        for (const c of matched) matchedCommitHashes.add(c.hash);
      }
    }

    // Sessions that couldn't be correlated at all
    const correlatedSessionIds = new Set(branchWork.flatMap((bw) => bw.sessions.map((s) => s.id)));
    const unmatched = unbranchedSessions.filter((s) => !correlatedSessionIds.has(s.id));

    return { branchWork, unmatchedSessions: unmatched };
  }

  /**
   * Get or build BranchWork for a specific branch name.
   */
  async correlateBranch(
    branchName: string,
    projectPath: string,
    sessions: Session[],
  ): Promise<BranchWork | null> {
    const branchSessions = sessions.filter(
      (s) => s.gitBranch === branchName || s.gitBranch.includes(branchName),
    );

    if (branchSessions.length === 0) return null;

    const isRepo = await this.git.isGitRepo(projectPath);
    let commits: GitCommit[] = [];

    if (isRepo) {
      if (branchName === "main" || branchName === "master") {
        const since = new Date(Math.min(...branchSessions.map((s) => s.startTime.getTime())) - 86400000);
        const until = new Date(Math.max(...branchSessions.map((s) => s.endTime.getTime())) + 86400000);
        commits = await this.git.getCommits(projectPath, { branch: branchName, since, until });
      } else {
        commits = await this.git.getCommitsForBranch(projectPath, branchName);
      }
    }

    return this.buildBranchWork(branchName, projectPath, branchSessions, commits);
  }

  private temporalMatch(commits: GitCommit[], sessions: Session[]): GitCommit[] {
    const matched: GitCommit[] = [];
    const buffer = 2 * 60 * 60 * 1000; // 2 hours

    for (const commit of commits) {
      for (const session of sessions) {
        const start = session.startTime.getTime() - buffer;
        const end = session.endTime.getTime() + buffer;
        if (commit.timestamp.getTime() >= start && commit.timestamp.getTime() <= end) {
          matched.push(commit);
          break;
        }
      }
    }

    return matched;
  }

  private isInTimeWindow(commit: GitCommit, sessions: Session[]): boolean {
    const buffer = 2 * 60 * 60 * 1000;
    const start = Math.min(...sessions.map((s) => s.startTime.getTime())) - buffer;
    const end = Math.max(...sessions.map((s) => s.endTime.getTime())) + buffer;
    return commit.timestamp.getTime() >= start && commit.timestamp.getTime() <= end;
  }

  private buildBranchWork(
    branch: string,
    projectPath: string,
    sessions: Session[],
    commits: GitCommit[],
  ): BranchWork {
    const totalCostUSD = sessions.reduce((s, x) => s + x.estimatedCostUSD, 0);
    const totalLinesChanged = commits.reduce((s, c) => s + c.linesAdded + c.linesRemoved, 0);
    const wastedSessions = sessions.filter((s) => s.outcome === "not_achieved");
    const wastedCost = wastedSessions.reduce((s, x) => s + x.estimatedCostUSD, 0);

    const timestamps = [
      ...sessions.map((s) => s.startTime.getTime()),
      ...sessions.map((s) => s.endTime.getTime()),
      ...commits.map((c) => c.timestamp.getTime()),
    ];

    return {
      branchName: branch,
      projectPath,
      sessions,
      commits,
      totalTokens: sumTokenUsage(sessions.map((s) => s.tokenUsage)),
      totalCostUSD,
      costPerCommit: commits.length > 0 ? totalCostUSD / commits.length : 0,
      costPerLineChanged: totalLinesChanged > 0 ? totalCostUSD / totalLinesChanged : 0,
      wasteRatio: totalCostUSD > 0 ? wastedCost / totalCostUSD : 0,
      timeSpan: {
        start: new Date(Math.min(...timestamps)),
        end: new Date(Math.max(...timestamps)),
      },
    };
  }
}
