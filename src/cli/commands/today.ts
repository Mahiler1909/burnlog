import { InsightsEngine } from "../../core/insights-engine.js";
import { computeEfficiency } from "../../core/efficiency-score.js";
import { CorrelationEngine } from "../../core/correlation-engine.js";
import { GitAnalyzer } from "../../git/git-analyzer.js";
import { renderToday } from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";
import { loadAndFilterSessions } from "../../utils/filters.js";

export async function todayCommand(options: { format?: string }): Promise<void> {
  // Load 2 days to compute "vs yesterday"
  const allSessions = await loadAndFilterSessions({ period: "2d" });

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
    console.log("No sessions found for today.");
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
