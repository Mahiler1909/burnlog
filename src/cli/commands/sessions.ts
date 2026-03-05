import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { renderSessionsList } from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";
import { totalTokens } from "../../core/token-ledger.js";
import { filterByProject, filterByPeriod } from "../../utils/filters.js";

export async function sessionsCommand(options: {
  project?: string;
  period?: string;
  sort?: string;
  limit?: number;
  all?: boolean;
  format?: string;
}): Promise<void> {
  const provider = new ClaudeCodeProvider();
  let sessions = await provider.loadAllSessions();

  sessions = filterByProject(sessions, options.project);
  sessions = filterByPeriod(sessions, options.period);

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
      sessions.sort((a, b) => totalTokens(b.tokenUsage) - totalTokens(a.tokenUsage));
      break;
  }

  // Limit
  if (!options.all) {
    const limit = options.limit ?? 20;
    sessions = sessions.slice(0, limit);
  }

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  const format = (options.format || "table") as OutputFormat;

  const data = sessions.map((s) => ({
    id: s.id.slice(0, 8),
    date: s.startTime.toISOString().slice(0, 10),
    project: s.projectName,
    branch: s.gitBranch,
    cost: Math.round(s.estimatedCostUSD * 100) / 100,
    tokens: totalTokens(s.tokenUsage),
    outcome: s.outcome,
    summary: s.summary,
  }));

  outputAs(format, data, () => {
    console.log();
    console.log(`Showing ${sessions.length} sessions (sorted by ${sortBy}):`);
    console.log();
    renderSessionsList(sessions);
  });
}
