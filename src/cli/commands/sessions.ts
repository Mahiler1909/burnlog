import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { renderSessionsList } from "../formatters/table.js";

export async function sessionsCommand(options: {
  project?: string;
  sort?: string;
  limit?: string;
}): Promise<void> {
  const provider = new ClaudeCodeProvider();
  let sessions = await provider.loadAllSessions();

  // Filter by project
  if (options.project) {
    const projectFilter = options.project.toLowerCase();
    sessions = sessions.filter(
      (s) =>
        s.projectName.toLowerCase().includes(projectFilter) ||
        s.projectPath.toLowerCase().includes(projectFilter),
    );
  }

  // Sort
  const sortBy = options.sort || "date";
  switch (sortBy) {
    case "cost":
      sessions.sort((a, b) => b.estimatedCostUSD - a.estimatedCostUSD);
      break;
    case "date":
      sessions.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
      break;
    case "tokens":
      sessions.sort((a, b) => {
        const ta =
          a.tokenUsage.inputTokens +
          a.tokenUsage.outputTokens +
          a.tokenUsage.cacheCreationTokens +
          a.tokenUsage.cacheReadTokens;
        const tb =
          b.tokenUsage.inputTokens +
          b.tokenUsage.outputTokens +
          b.tokenUsage.cacheCreationTokens +
          b.tokenUsage.cacheReadTokens;
        return tb - ta;
      });
      break;
  }

  // Limit
  const limit = options.limit ? parseInt(options.limit, 10) : 20;
  sessions = sessions.slice(0, limit);

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  console.log();
  console.log(`Showing ${sessions.length} sessions (sorted by ${sortBy}):`);
  console.log();
  renderSessionsList(sessions);
}
