import { InsightsEngine } from "../../core/insights-engine.js";
import { renderWasteReport } from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";
import { parsePeriodDays } from "../../utils/period.js";
import { loadAndFilterSessions } from "../../utils/filters.js";

export async function wasteCommand(options: {
  period?: string;
  project?: string;
  format?: string;
}): Promise<void> {
  const days = parsePeriodDays(options.period || "30d");
  const sessions = await loadAndFilterSessions(options);

  if (sessions.length === 0) {
    console.log("No sessions found for the given filters.");
    return;
  }

  const engine = new InsightsEngine();
  const signals = engine.analyze(sessions);
  const format = (options.format || "table") as OutputFormat;

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
