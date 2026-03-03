import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { GitAnalyzer } from "../../git/git-analyzer.js";
import { CorrelationEngine } from "../../core/correlation-engine.js";
import { renderBranchComparison } from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";

export async function compareCommand(
  branchA: string,
  branchB: string,
  options: { project?: string; format?: string },
): Promise<void> {
  const provider = new ClaudeCodeProvider();
  let sessions = await provider.loadAllSessions();

  if (options.project) {
    const filter = options.project.toLowerCase();
    sessions = sessions.filter(
      (s) =>
        s.projectName.toLowerCase().includes(filter) ||
        s.projectPath.toLowerCase().includes(filter),
    );
  }

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  const git = new GitAnalyzer();
  const engine = new CorrelationEngine(git);

  // Resolve git root from all session paths
  const uniquePaths = [...new Set(sessions.map((s) => s.projectPath))];
  let projectPath = uniquePaths[0] || "";
  for (const p of uniquePaths) {
    const root = await git.resolveGitRoot(p);
    if (root) {
      projectPath = root;
      break;
    }
  }

  // Pass ALL sessions — correlateBranch handles HEAD resolution and branch matching
  const workA = await engine.correlateBranch(branchA, projectPath, sessions);
  const workB = await engine.correlateBranch(branchB, projectPath, sessions);

  if (!workA && !workB) {
    console.log(`No sessions found for either branch.`);
    return;
  }

  const format = (options.format || "table") as OutputFormat;

  const toBranchData = (bw: typeof workA, name: string) => {
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

  const data = [toBranchData(workA, branchA), toBranchData(workB, branchB)];

  outputAs(format, data, () => {
    renderBranchComparison(workA, workB);
  });
}
