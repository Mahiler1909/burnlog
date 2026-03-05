import { buildCostBreakdown } from "../../core/token-ledger.js";
import { CorrelationEngine } from "../../core/correlation-engine.js";
import { GitAnalyzer } from "../../git/git-analyzer.js";
import {
  renderReportHeader,
  renderByProject,
  renderByModel,
  renderByCategory,
  renderByOutcome,
} from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";
import { parsePeriodDays } from "../../utils/period.js";
import { loadAndFilterSessions } from "../../utils/filters.js";

export async function reportCommand(options: { period?: string; project?: string; format?: string }): Promise<void> {
  const days = parsePeriodDays(options.period || "30d");
  const sessions = await loadAndFilterSessions(options);

  if (sessions.length === 0) {
    console.log("No sessions found for the given filters.");
    return;
  }

  // Run git correlation to get real commit counts
  const git = new GitAnalyzer();
  const engine = new CorrelationEngine(git);
  const correlation = await engine.correlate(sessions);

  // Build commit counts per project from correlation results
  const commitsByProject = new Map<string, number>();
  for (const bw of correlation.branchWork) {
    const projectName = bw.sessions[0]?.projectName ?? "unknown";
    const current = commitsByProject.get(projectName) ?? 0;
    commitsByProject.set(projectName, current + bw.commits.length);
  }

  const format = (options.format || "table") as OutputFormat;

  // Build exportable data
  const grouped = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = grouped.get(s.projectName) ?? [];
    list.push(s);
    grouped.set(s.projectName, list);
  }

  const byProject = [...grouped.entries()].map(([name, projectSessions]) => {
    const cost = projectSessions.reduce((s, x) => s + x.estimatedCostUSD, 0);
    const commits = commitsByProject.get(name) ?? 0;
    const linesAdded = projectSessions.reduce((s, x) => s + x.linesAdded, 0);
    const linesRemoved = projectSessions.reduce((s, x) => s + x.linesRemoved, 0);
    const totalLines = linesAdded + linesRemoved;
    const achieved = projectSessions.filter((x) => x.outcome === "fully_achieved").length;
    return {
      project: name,
      cost: Math.round(cost * 100) / 100,
      sessions: projectSessions.length,
      commits,
      linesAdded,
      linesRemoved,
      costPerCommit: commits > 0 ? Math.round((cost / commits) * 100) / 100 : null,
      costPerLine: totalLines > 0 ? Math.round((cost / totalLines) * 1000) / 1000 : null,
      achieved,
      total: projectSessions.length,
    };
  });

  const breakdown = buildCostBreakdown(sessions);
  const totalCost = sessions.reduce((s, x) => s + x.estimatedCostUSD, 0);
  const totalCommits = [...commitsByProject.values()].reduce((s, c) => s + c, 0);

  const periodLabel = `Last ${days} days`;

  const data = format === "csv"
    ? byProject
    : {
        period: periodLabel,
        summary: {
          totalCost: Math.round(totalCost * 100) / 100,
          sessions: sessions.length,
          projects: new Set(sessions.map((s) => s.projectName)).size,
          commits: totalCommits,
        },
        byProject,
        byModel: breakdown.byModel,
        byCategory: breakdown.byCategory,
        byOutcome: breakdown.byOutcome,
      };

  outputAs(format, data, () => {
    renderReportHeader(sessions, periodLabel, commitsByProject);
    renderByProject(sessions, commitsByProject);
    renderByModel(breakdown);
    renderByCategory(breakdown);
    renderByOutcome(breakdown);
  });
}
