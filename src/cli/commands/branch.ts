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

  // Find sessions matching the branch (exact or partial match)
  const branchSessions = sessions.filter(
    (s) => s.gitBranch === branchName || s.gitBranch.includes(branchName),
  );

  if (branchSessions.length === 0) {
    console.log(`No sessions found for branch: ${branchName}`);
    return;
  }

  const git = new GitAnalyzer();
  const engine = new CorrelationEngine(git);
  const projectPath = branchSessions[0].projectPath;

  const branchWork = await engine.correlateBranch(branchName, projectPath, branchSessions);
  if (!branchWork) {
    console.log("Could not correlate branch data.");
    return;
  }

  renderBranchDetail(branchWork);
}
