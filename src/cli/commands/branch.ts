import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { GitAnalyzer } from "../../git/git-analyzer.js";
import { CorrelationEngine } from "../../core/correlation-engine.js";
import { renderBranchDetail } from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";

export async function branchCommand(
  branchName: string,
  options: { project?: string; format?: string },
): Promise<void> {
  const provider = new ClaudeCodeProvider();
  let sessions = await provider.loadAllSessions();

  // Filter by project if specified
  if (options.project) {
    const filter = options.project.toLowerCase();
    sessions = sessions.filter(
      (s) =>
        s.projectName.toLowerCase().includes(filter) ||
        s.projectPath.toLowerCase().includes(filter),
    );
  }

  if (sessions.length === 0) {
    console.log(`No sessions found${options.project ? ` for project: ${options.project}` : ""}`);
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

  const format = (options.format || "table") as OutputFormat;

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
