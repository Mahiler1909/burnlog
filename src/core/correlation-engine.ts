import type { Session, GitCommit, BranchWork, CorrelationResult } from "../data/models.js";
import { sumTokenUsage } from "./token-ledger.js";
import { GitAnalyzer } from "../git/git-analyzer.js";

export class CorrelationEngine {
  constructor(private git: GitAnalyzer) {}

  /**
   * Correlate all sessions with git data, grouped by project then branch.
   */
  async correlate(sessions: Session[]): Promise<CorrelationResult> {
    // Group sessions by project name (not path — same project can have multiple paths)
    const byProjectName = new Map<string, Session[]>();
    for (const s of sessions) {
      const list = byProjectName.get(s.projectName) ?? [];
      list.push(s);
      byProjectName.set(s.projectName, list);
    }

    const allBranchWork: BranchWork[] = [];
    const unmatchedSessions: Session[] = [];

    for (const [, projectSessions] of byProjectName) {
      // Resolve the best git root across all paths for this project
      const gitRoot = await this.resolveGitRootForSessions(projectSessions);
      const effectivePath = gitRoot || projectSessions[0].projectPath;
      const result = await this.correlateProject(effectivePath, projectSessions);
      allBranchWork.push(...result.branchWork);
      unmatchedSessions.push(...result.unmatchedSessions);
    }

    // Sort by cost descending
    allBranchWork.sort((a, b) => b.totalCostUSD - a.totalCostUSD);

    return { branchWork: allBranchWork, unmatchedSessions };
  }

  /**
   * Try to find a valid git root from any of the session paths.
   */
  private async resolveGitRootForSessions(sessions: Session[]): Promise<string | null> {
    const uniquePaths = [...new Set(sessions.map(s => s.projectPath))];
    for (const path of uniquePaths) {
      const root = await this.git.resolveGitRoot(path);
      if (root) return root;
    }
    return null;
  }

  /**
   * Correlate sessions for a single project with its git data.
   */
  async correlateProject(
    projectPath: string,
    sessions: Session[],
  ): Promise<CorrelationResult> {
    // Resolve actual git root (handles stale/moved paths)
    const gitRoot = await this.git.resolveGitRoot(projectPath);
    const effectivePath = gitRoot || projectPath;

    const isRepo = await this.git.isGitRepo(effectivePath);
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
    const allCommits = await this.git.getCommits(effectivePath, { since, until });

    // Resolve HEAD sessions to the repo's current branch
    const currentBranch = await this.git.getCurrentBranch(effectivePath);

    // Tier 1: Group sessions by branch name
    const branchGroups = new Map<string, Session[]>();
    const unbranchedSessions: Session[] = [];

    for (const s of sessions) {
      // Resolve HEAD to the repo's current branch
      const branch = (s.gitBranch === "HEAD" && currentBranch) ? currentBranch : s.gitBranch;
      if (branch && branch !== "HEAD") {
        const list = branchGroups.get(branch) ?? [];
        list.push(s);
        branchGroups.set(branch, list);
      } else {
        unbranchedSessions.push(s);
      }
    }

    const branchWork: BranchWork[] = [];

    // Process each branch group — feature branches first, main/master last
    const mainBranches: [string, Session[]][] = [];

    for (const [branch, branchSessions] of branchGroups) {
      if (branch === "main" || branch === "master") {
        mainBranches.push([branch, branchSessions]);
        continue;
      }

      // Feature branch: get exclusive commits
      const branchCommits = await this.git.getCommitsForBranch(effectivePath, branch);
      // Also try temporal match if branch had no exclusive commits
      const matched = branchCommits.length > 0
        ? branchCommits
        : this.temporalMatch(allCommits, branchSessions);

      branchWork.push(this.buildBranchWork(branch, effectivePath, branchSessions, matched));
    }

    // Process main/master sessions AFTER feature branches:
    // Use temporal+file overlap to attribute commits from ANY branch
    // (handles sessions opened on main but work committed on feature branches)
    for (const [branch, branchSessions] of mainBranches) {
      const alreadyMatched = new Set(branchWork.flatMap((bw) => bw.commits.map((c) => c.hash)));
      const candidates = allCommits.filter((c) => !alreadyMatched.has(c.hash));
      const temporalMatched = this.temporalMatch(candidates, branchSessions);
      const fileMatched = this.fileOverlapMatch(candidates, branchSessions);

      // Merge temporal and file matches (deduplicated)
      const matchedHashes = new Set([
        ...temporalMatched.map(c => c.hash),
        ...fileMatched.map(c => c.hash),
      ]);
      const matched = candidates.filter(c => matchedHashes.has(c.hash));

      branchWork.push(this.buildBranchWork(branch, effectivePath, branchSessions, matched));
    }

    // Tier 2: Temporal match for sessions without branch
    const matchedCommitHashes = new Set(branchWork.flatMap((bw) => bw.commits.map((c) => c.hash)));
    const remainingCommits = allCommits.filter((c) => !matchedCommitHashes.has(c.hash));

    for (const s of unbranchedSessions) {
      const matched = this.temporalMatch(remainingCommits, [s]);
      if (matched.length > 0) {
        branchWork.push(this.buildBranchWork("(untracked)", effectivePath, [s], matched));
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
    // Resolve actual git root first (needed for HEAD resolution)
    const gitRoot = await this.git.resolveGitRoot(projectPath)
      || await this.resolveGitRootForSessions(sessions);
    const effectivePath = gitRoot || projectPath;

    // Resolve HEAD sessions: if searching for "main" and repo's current branch is "main",
    // include sessions with gitBranch=HEAD
    const currentBranch = await this.git.getCurrentBranch(effectivePath);
    const branchSessions = sessions.filter((s) => {
      const resolved = (s.gitBranch === "HEAD" && currentBranch) ? currentBranch : s.gitBranch;
      return resolved === branchName || resolved.includes(branchName);
    });

    if (branchSessions.length === 0) return null;

    const isRepo = await this.git.isGitRepo(effectivePath);
    let commits: GitCommit[] = [];

    if (isRepo) {
      // Resolve the actual git branch name (user may pass partial like "US-411"
      // but the real branch is "fix/US-411/dashboard-metrics")
      const resolvedBranch = await this.resolveGitBranchName(effectivePath, branchName, branchSessions);

      if (resolvedBranch === "main" || resolvedBranch === "master") {
        // For main: get ALL commits in time window (from any branch),
        // then use temporal+file overlap to attribute cross-branch work
        const since = new Date(Math.min(...branchSessions.map((s) => s.startTime.getTime())) - 86400000);
        const until = new Date(Math.max(...branchSessions.map((s) => s.endTime.getTime())) + 86400000);
        const allCommits = await this.git.getCommits(effectivePath, { since, until });
        const temporal = this.temporalMatch(allCommits, branchSessions);
        const fileMatch = this.fileOverlapMatch(allCommits, branchSessions);
        const hashes = new Set([...temporal.map(c => c.hash), ...fileMatch.map(c => c.hash)]);
        commits = allCommits.filter(c => hashes.has(c.hash));
      } else {
        commits = await this.git.getCommitsForBranch(effectivePath, resolvedBranch);
      }
    }

    return this.buildBranchWork(branchName, effectivePath, branchSessions, commits);
  }

  /**
   * Resolve a possibly-partial branch name to an actual git branch.
   * Priority: exact match in git > session gitBranch > partial match in git > original.
   */
  private async resolveGitBranchName(
    repoPath: string,
    branchName: string,
    sessions: Session[],
  ): Promise<string> {
    const gitBranches = await this.git.getBranches(repoPath);

    // 1. Exact match in git
    if (gitBranches.includes(branchName)) return branchName;

    // 2. Use the most common full branch name from sessions (they already matched)
    const sessionBranches = sessions.map(s => s.gitBranch).filter(Boolean);
    const branchCounts = new Map<string, number>();
    for (const b of sessionBranches) {
      branchCounts.set(b, (branchCounts.get(b) || 0) + 1);
    }
    const mostCommonSessionBranch = [...branchCounts.entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    // Check if the session branch exists in git
    if (mostCommonSessionBranch && gitBranches.includes(mostCommonSessionBranch)) {
      return mostCommonSessionBranch;
    }

    // 3. Partial match in git branches
    const partialMatch = gitBranches.find(b => b.includes(branchName));
    if (partialMatch) return partialMatch;

    // 4. Fallback to whatever sessions report (even if not in git — merged/deleted branch)
    return mostCommonSessionBranch || branchName;
  }

  /**
   * Match commits to sessions by file overlap (basename match).
   * If a commit touches files that a session also modified, it's a match.
   */
  private fileOverlapMatch(commits: GitCommit[], sessions: Session[]): GitCommit[] {
    // Collect all basenames modified across sessions
    const sessionFiles = new Set<string>();
    for (const s of sessions) {
      for (const ex of s.exchanges) {
        for (const f of ex.filesModified) {
          // Extract basename for comparison
          const basename = f.split("/").pop() || f;
          sessionFiles.add(basename.toLowerCase());
        }
      }
    }

    if (sessionFiles.size === 0) return [];

    return commits.filter((commit) => {
      for (const f of commit.filesChanged) {
        const basename = (f.split("/").pop() || f).toLowerCase();
        if (sessionFiles.has(basename)) return true;
      }
      return false;
    });
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
