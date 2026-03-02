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

  // Find sessions for each branch
  const sessionsA = sessions.filter(
    (s) => s.gitBranch === branchA || s.gitBranch.includes(branchA),
  );
  const sessionsB = sessions.filter(
    (s) => s.gitBranch === branchB || s.gitBranch.includes(branchB),
  );

  if (sessionsA.length === 0 && sessionsB.length === 0) {
    console.log(`No sessions found for either branch.`);
    return;
  }

  const projectPath = sessionsA[0]?.projectPath || sessionsB[0]?.projectPath;

  const workA = await engine.correlateBranch(branchA, projectPath, sessionsA);
  const workB = await engine.correlateBranch(branchB, projectPath, sessionsB);

  if (!workA && !workB) {
    console.log("Could not correlate either branch.");
    return;
  }

  renderBranchComparison(workA, workB);
}
