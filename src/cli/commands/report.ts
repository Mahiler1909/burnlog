import { ClaudeCodeProvider } from "../../providers/claude-code/provider.js";
import { buildCostBreakdown } from "../../core/token-ledger.js";
import {
  renderReportHeader,
  renderByProject,
  renderByModel,
  renderByCategory,
  renderByOutcome,
} from "../formatters/table.js";

function parsePeriodDays(period: string): number {
  const match = period.match(/^(\d+)d$/);
  if (match) return parseInt(match[1], 10);
  if (period.endsWith("w")) return parseInt(period, 10) * 7;
  if (period.endsWith("m")) return parseInt(period, 10) * 30;
  return 30;
}

export async function reportCommand(options: { period?: string; project?: string }): Promise<void> {
  const provider = new ClaudeCodeProvider();
  let sessions = await provider.loadAllSessions();

  // Filter by period
  const days = parsePeriodDays(options.period || "30d");
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  sessions = sessions.filter((s) => s.startTime >= cutoff);

  // Filter by project
  if (options.project) {
    const projectFilter = options.project.toLowerCase();
    sessions = sessions.filter(
      (s) =>
        s.projectName.toLowerCase().includes(projectFilter) ||
        s.projectPath.toLowerCase().includes(projectFilter),
    );
  }

  if (sessions.length === 0) {
    console.log("No sessions found for the given filters.");
    return;
  }

  const periodLabel = `Last ${days} days`;
  renderReportHeader(sessions, periodLabel);
  renderByProject(sessions);

  const breakdown = buildCostBreakdown(sessions);
  renderByModel(breakdown);
  renderByCategory(breakdown);
  renderByOutcome(breakdown);
}
