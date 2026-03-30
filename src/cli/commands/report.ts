import chalk from "chalk";
import { buildCostBreakdown } from "../../core/token-ledger.js";
import { CorrelationEngine } from "../../core/correlation-engine.js";
import { GitAnalyzer } from "../../git/git-analyzer.js";
import { InsightsEngine } from "../../core/insights-engine.js";
import { computeEfficiency } from "../../core/efficiency-score.js";
import {
  renderReportHeader,
  renderByProject,
  renderByModel,
  renderByCategory,
  renderByOutcome,
  renderToday,
} from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";
import { parsePeriodDays } from "../../utils/period.js";
import { loadAndFilterSessions } from "../../utils/filters.js";

export async function reportCommand(options: { period?: string; project?: string; format?: string; today?: boolean }): Promise<void> {
  // Today mode: quick daily summary with yesterday comparison
  if (options.today) {
    return runTodayReport(options);
  }

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

  const totalCommits = [...commitsByProject.values()].reduce((s, c) => s + c, 0);

  // Waste + efficiency
  const insights = new InsightsEngine();
  const wasteSignals = insights.analyze(sessions);
  const efficiency = computeEfficiency({ sessions, wasteSignals, totalCommits });

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
          efficiencyScore: efficiency.score,
        },
        byProject,
        byModel: breakdown.byModel,
        byCategory: breakdown.byCategory,
        byOutcome: breakdown.byOutcome,
      };

  outputAs(format, data, () => {
    renderReportHeader(sessions, periodLabel, { commitsByProject, breakdown, efficiency });
    renderByProject(sessions, commitsByProject);
    renderByModel(breakdown);
    renderByCategory(breakdown);
    renderByOutcome(breakdown);
  });
}

async function runTodayReport(options: { format?: string }): Promise<void> {
  // Load 7 days to find recent activity even if today is empty
  const allSessions = await loadAndFilterSessions({ period: "7d" });

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const todaySessions = allSessions.filter(
    (s) => s.startTime.toISOString().slice(0, 10) === todayStr,
  );
  const yesterdaySessions = allSessions.filter(
    (s) => s.startTime.toISOString().slice(0, 10) === yesterdayStr,
  );

  if (todaySessions.length === 0) {
    // Find the most recent day with activity
    const byDate = new Map<string, typeof allSessions>();
    for (const s of allSessions) {
      const date = s.startTime.toISOString().slice(0, 10);
      const list = byDate.get(date) ?? [];
      list.push(s);
      byDate.set(date, list);
    }
    const sortedDates = [...byDate.keys()].sort().reverse();

    if (sortedDates.length === 0) {
      console.log("No sessions found in the last 7 days.");
      return;
    }

    const lastDate = sortedDates[0];
    const lastSessions = byDate.get(lastDate)!;
    const lastCost = lastSessions.reduce((s, x) => s + x.estimatedCostUSD, 0);
    const lastProjects = [...new Set(lastSessions.map((s) => s.projectName))];

    console.log(chalk.dim("No sessions today."));
    console.log();
    console.log(`  Last activity: ${chalk.bold(lastDate)} (${lastSessions.length} session${lastSessions.length > 1 ? "s" : ""}, ${chalk.green("$" + lastCost.toFixed(2))})`);
    console.log(`  Projects:      ${lastProjects.join(", ")}`);
    console.log();
    return;
  }

  const insights = new InsightsEngine();

  // Git correlation for today's commits
  const git = new GitAnalyzer();
  const engine = new CorrelationEngine(git);
  const correlation = await engine.correlate(todaySessions);
  const totalCommits = correlation.branchWork.reduce((sum, bw) => sum + bw.commits.length, 0);

  const todayWaste = insights.analyze(todaySessions);
  const todayEfficiency = computeEfficiency({
    sessions: todaySessions,
    wasteSignals: todayWaste,
    totalCommits,
  });

  // Yesterday comparison
  let yesterdayData: { cost: number; score: number; wastePct: number } | undefined;
  if (yesterdaySessions.length > 0) {
    const yWaste = insights.analyze(yesterdaySessions);
    const yCorrelation = await engine.correlate(yesterdaySessions);
    const yCommits = yCorrelation.branchWork.reduce((sum, bw) => sum + bw.commits.length, 0);
    const yEfficiency = computeEfficiency({
      sessions: yesterdaySessions,
      wasteSignals: yWaste,
      totalCommits: yCommits,
    });
    const yCost = yesterdaySessions.reduce((sum, s) => sum + s.estimatedCostUSD, 0);
    const yTotalWaste = yWaste.reduce((sum, w) => sum + w.estimatedWastedCostUSD, 0);
    yesterdayData = {
      cost: yCost,
      score: yEfficiency.score,
      wastePct: yCost > 0 ? (yTotalWaste / yCost) * 100 : 0,
    };
  }

  const format = (options.format || "table") as OutputFormat;

  const totalCost = todaySessions.reduce((sum, s) => sum + s.estimatedCostUSD, 0);
  const totalWaste = todayWaste.reduce((sum, w) => sum + w.estimatedWastedCostUSD, 0);

  const data = {
    date: todayStr,
    cost: Math.round(totalCost * 100) / 100,
    sessions: todaySessions.length,
    commits: totalCommits,
    linesAdded: todaySessions.reduce((sum, s) => sum + s.linesAdded, 0),
    linesRemoved: todaySessions.reduce((sum, s) => sum + s.linesRemoved, 0),
    efficiencyScore: todayEfficiency.score,
    wasteCost: Math.round(totalWaste * 100) / 100,
    wastePct: totalCost > 0 ? Math.round((totalWaste / totalCost) * 100) : 0,
  };

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateLabel = `${dayNames[now.getDay()]} ${monthNames[now.getMonth()]} ${now.getDate()}`;

  outputAs(format, data, () => {
    renderToday(todaySessions, dateLabel, todayEfficiency, todayWaste, totalCommits, yesterdayData);
  });
}
