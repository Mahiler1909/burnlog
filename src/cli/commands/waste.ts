import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { InsightsEngine } from "../../core/insights-engine.js";
import { renderWasteReport } from "../formatters/table.js";

function parsePeriodDays(period: string): number {
  const match = period.match(/^(\d+)d$/);
  if (match) return parseInt(match[1], 10);
  if (period.endsWith("w")) return parseInt(period, 10) * 7;
  if (period.endsWith("m")) return parseInt(period, 10) * 30;
  return 30;
}

export async function wasteCommand(options: {
  period?: string;
  project?: string;
}): Promise<void> {
  const provider = new ClaudeCodeProvider();
  let sessions = await provider.loadAllSessions();

  // Filter by period
  const days = parsePeriodDays(options.period || "30d");
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  sessions = sessions.filter((s) => s.startTime >= cutoff);

  // Filter by project
  if (options.project) {
    const filter = options.project.toLowerCase();
    sessions = sessions.filter(
      (s) =>
        s.projectName.toLowerCase().includes(filter) ||
        s.projectPath.toLowerCase().includes(filter),
    );
  }

  if (sessions.length === 0) {
    console.log("No sessions found for the given filters.");
    return;
  }

  const engine = new InsightsEngine();
  const signals = engine.analyze(sessions);

  renderWasteReport(signals, sessions, `Last ${days} days`);
}
