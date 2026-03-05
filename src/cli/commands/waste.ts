import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { InsightsEngine } from "../../core/insights-engine.js";
import { renderWasteReport } from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";
import { parsePeriodDays } from "../../utils/period.js";
import { filterByProject, filterByPeriod } from "../../utils/filters.js";

export async function wasteCommand(options: {
  period?: string;
  project?: string;
  format?: string;
}): Promise<void> {
  const provider = new ClaudeCodeProvider();
  let sessions = await provider.loadAllSessions();

  const days = parsePeriodDays(options.period || "30d");
  sessions = filterByPeriod(sessions, options.period || "30d");
  sessions = filterByProject(sessions, options.project);

  if (sessions.length === 0) {
    console.log("No sessions found for the given filters.");
    return;
  }

  const engine = new InsightsEngine();
  const signals = engine.analyze(sessions);
  const format = (options.format || "table") as OutputFormat;

  const totalCost = sessions.reduce((s, x) => s + x.estimatedCostUSD, 0);
  const totalWaste = signals.reduce((s, x) => s + x.estimatedWastedCostUSD, 0);

  const data = signals.map((s) => ({
    sessionId: s.sessionId.slice(0, 8),
    type: s.type,
    wastedCost: Math.round(s.estimatedWastedCostUSD * 100) / 100,
    description: s.description,
    suggestion: s.suggestion,
  }));

  outputAs(format, data, () => {
    renderWasteReport(signals, sessions, `Last ${days} days`);
  });
}
