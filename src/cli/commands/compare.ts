import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { GitAnalyzer } from "../../git/git-analyzer.js";
import { CorrelationEngine } from "../../core/correlation-engine.js";
import { renderBranchComparison } from "../formatters/table.js";

export async function compareCommand(
  branchA: string,
  branchB: string,
): Promise<void> {
  const provider = new ClaudeCodeProvider();
  const sessions = await provider.loadAllSessions();

  const git = new GitAnalyzer();
  const engine = new CorrelationEngine(git);

  // Resolve git root from all session paths
  const uniquePaths = [...new Set(sessions.map(s => s.projectPath))];
  let projectPath = uniquePaths[0] || "";
  for (const p of uniquePaths) {
    const root = await git.resolveGitRoot(p);
    if (root) { projectPath = root; break; }
  }

  // Pass ALL sessions — correlateBranch handles HEAD resolution and branch matching
  const workA = await engine.correlateBranch(branchA, projectPath, sessions);
  const workB = await engine.correlateBranch(branchB, projectPath, sessions);

  if (!workA && !workB) {
    console.log(`No sessions found for either branch.`);
    return;
  }

  renderBranchComparison(workA, workB);
}
