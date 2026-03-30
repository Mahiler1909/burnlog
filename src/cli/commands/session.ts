import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { InsightsEngine } from "../../core/insights-engine.js";
import { GitAnalyzer } from "../../git/git-analyzer.js";
import { CorrelationEngine } from "../../core/correlation-engine.js";
import type { GitCommit } from "../../data/models.js";
import { renderSessionDetail } from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";
import { totalTokens } from "../../core/token-ledger.js";

export async function sessionCommand(sessionId: string, options: { format?: string }): Promise<void> {
  const provider = new ClaudeCodeProvider();
  const allSessions = await provider.loadAllSessions();

  // Find session by full ID or prefix match
  const session = allSessions.find(
    (s) => s.id === sessionId || s.id.startsWith(sessionId),
  );

  if (!session) {
    console.log(`Session not found: ${sessionId}`);
    console.log("Use 'burnlog sessions' to list available sessions.");
    return;
  }

  // Waste signals for this session
  const insights = new InsightsEngine();
  const wasteSignals = insights.analyze([session]);

  // Correlated commits
  let commits: GitCommit[] = [];
  if (session.gitBranch) {
    const git = new GitAnalyzer();
    const engine = new CorrelationEngine(git);
    const root = await git.resolveGitRoot(session.projectPath);
    if (root) {
      // Resolve HEAD to actual branch name
      let branchName = session.gitBranch;
      if (branchName === "HEAD") {
        branchName = await git.getCurrentBranch(root) || branchName;
      }
      const projectSessions = allSessions.filter(s => s.projectName === session.projectName);
      const bw = await engine.correlateBranch(branchName, root, projectSessions);
      if (bw) commits = bw.commits;
    }
  }

  const format = (options.format || "table") as OutputFormat;

  const data = {
    id: session.id,
    project: session.projectName,
    projectPath: session.projectPath,
    branch: session.gitBranch,
    startTime: session.startTime.toISOString(),
    endTime: session.endTime.toISOString(),
    durationMinutes: session.durationMinutes,
    messageCount: session.messageCount,
    cost: Math.round(session.estimatedCostUSD * 100) / 100,
    outcome: session.outcome,
    summary: session.summary,
    linesAdded: session.linesAdded,
    linesRemoved: session.linesRemoved,
    filesModified: session.filesModified,
    tokens: totalTokens(session.tokenUsage),
    tokenBreakdown: {
      input: session.tokenUsage.inputTokens,
      output: session.tokenUsage.outputTokens,
      cacheCreation: session.tokenUsage.cacheCreationTokens,
      cacheRead: session.tokenUsage.cacheReadTokens,
    },
    wasteSignals: wasteSignals.map((w) => ({
      type: w.type,
      category: w.category,
      cost: Math.round(w.estimatedWastedCostUSD * 100) / 100,
      description: w.description,
    })),
    commits: commits.map((c) => ({
      hash: c.hash.slice(0, 8),
      date: c.timestamp.toISOString().slice(0, 10),
      message: c.message,
      linesAdded: c.linesAdded,
      linesRemoved: c.linesRemoved,
    })),
    exchanges: session.exchanges.map((e) => ({
      seq: e.sequenceNumber,
      cost: Math.round(e.estimatedCostUSD * 100) / 100,
      model: e.model,
      category: e.category,
      tools: e.toolsUsed.join(", "),
      prompt: e.userPrompt.slice(0, 80),
    })),
  };

  outputAs(format, data, () => {
    renderSessionDetail(session, wasteSignals, commits);
  });
}
