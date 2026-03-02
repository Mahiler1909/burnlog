import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { GitAnalyzer } from "../../git/git-analyzer.js";
import { CorrelationEngine } from "../../core/correlation-engine.js";
import { renderBranchDetail } from "../formatters/table.js";

export async function branchCommand(
  branchName: string,
  options: { project?: string },
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
  const uniquePaths = [...new Set(sessions.map(s => s.projectPath))];
  let projectPath = uniquePaths[0];
  let repoFound = false;
  for (const p of uniquePaths) {
    const root = await git.resolveGitRoot(p);
    if (root) { projectPath = root; repoFound = true; break; }
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

  renderBranchDetail(branchWork, warnings);
}
