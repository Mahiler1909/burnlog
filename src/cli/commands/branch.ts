import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { GitAnalyzer } from "../../git/git-analyzer.js";
import { CorrelationEngine } from "../../core/correlation-engine.js";
import { renderBranchDetail, renderBranchComparison } from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";
import { filterByProject } from "../../utils/filters.js";
import type { BranchWork } from "../../data/models.js";

export async function branchCommand(
  branches: string[],
  options: { project?: string; format?: string },
): Promise<void> {
  if (branches.length > 2) {
    console.log("Compare supports exactly 2 branches.");
    return;
  }

  const provider = new ClaudeCodeProvider();
  let sessions = await provider.loadAllSessions();

  sessions = filterByProject(sessions, options.project);

  if (sessions.length === 0) {
    console.log(`No sessions found${options.project ? ` for project: ${options.project}` : ""}.`);
    return;
  }

  const git = new GitAnalyzer();
  const engine = new CorrelationEngine(git);

  // Resolve git root from ALL project sessions (some may have stale paths)
  const uniquePaths = [...new Set(sessions.map((s) => s.projectPath))];
  let projectPath = uniquePaths[0];
  let repoFound = false;
  for (const p of uniquePaths) {
    const root = await git.resolveGitRoot(p);
    if (root) {
      projectPath = root;
      repoFound = true;
      break;
    }
  }

  const format = (options.format || "table") as OutputFormat;

  // Compare mode: two branches side-by-side
  if (branches.length === 2) {
    const workA = await engine.correlateBranch(branches[0], projectPath, sessions);
    const workB = await engine.correlateBranch(branches[1], projectPath, sessions);

    if (!workA && !workB) {
      console.log("No sessions found for either branch.");
      return;
    }

    const toBranchData = (bw: BranchWork | null, name: string) => {
      if (!bw) return { branch: name, sessions: 0, commits: 0, cost: 0 };
      const linesAdded = bw.commits.reduce((s, c) => s + c.linesAdded, 0);
      const linesRemoved = bw.commits.reduce((s, c) => s + c.linesRemoved, 0);
      return {
        branch: bw.branchName,
        sessions: bw.sessions.length,
        commits: bw.commits.length,
        cost: Math.round(bw.totalCostUSD * 100) / 100,
        costPerCommit: bw.commits.length > 0 ? Math.round(bw.costPerCommit * 100) / 100 : null,
        linesAdded,
        linesRemoved,
        costPerLine: (linesAdded + linesRemoved) > 0 ? Math.round(bw.costPerLineChanged * 1000) / 1000 : null,
        wasteRatio: Math.round(bw.wasteRatio * 100),
      };
    };

    const data = [toBranchData(workA, branches[0]), toBranchData(workB, branches[1])];

    outputAs(format, data, () => {
      renderBranchComparison(workA, workB);
    });
    return;
  }

  // Single branch detail mode
  const branchName = branches[0];

  // Collect warnings
  const warnings: string[] = [];
  if (!repoFound) {
    warnings.push(`Git repo not found at any known path. Commits cannot be correlated.`);
    for (const p of uniquePaths) {
      warnings.push(`  Tried: ${p}`);
    }
  }

  // Pass ALL sessions — correlateBranch handles HEAD resolution and branch matching
  const branchWork = await engine.correlateBranch(branchName, projectPath, sessions);
  if (!branchWork) {
    console.log(`No sessions found for branch: ${branchName}`);
    return;
  }

  const linesAdded = branchWork.commits.reduce((s, c) => s + c.linesAdded, 0);
  const linesRemoved = branchWork.commits.reduce((s, c) => s + c.linesRemoved, 0);

  const data = {
    branch: branchWork.branchName,
    projectPath: branchWork.projectPath,
    cost: Math.round(branchWork.totalCostUSD * 100) / 100,
    sessions: branchWork.sessions.length,
    commits: branchWork.commits.length,
    linesAdded,
    linesRemoved,
    costPerCommit: branchWork.commits.length > 0 ? Math.round(branchWork.costPerCommit * 100) / 100 : null,
    costPerLine: (linesAdded + linesRemoved) > 0 ? Math.round(branchWork.costPerLineChanged * 1000) / 1000 : null,
    wasteRatio: Math.round(branchWork.wasteRatio * 100),
    sessionList: branchWork.sessions.map((s) => ({
      id: s.id.slice(0, 8),
      date: s.startTime.toISOString().slice(0, 10),
      cost: Math.round(s.estimatedCostUSD * 100) / 100,
      outcome: s.outcome,
    })),
    commitList: branchWork.commits.map((c) => ({
      hash: c.hash.slice(0, 8),
      date: c.timestamp.toISOString().slice(0, 10),
      linesAdded: c.linesAdded,
      linesRemoved: c.linesRemoved,
      message: c.message,
    })),
  };

  outputAs(format, data, () => {
    renderBranchDetail(branchWork, warnings);
  });
}
