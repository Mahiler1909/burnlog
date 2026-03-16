import { InsightsEngine } from "../../core/insights-engine.js";
import { computeEfficiency } from "../../core/efficiency-score.js";
import { renderTrends, type WeekBucket } from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";
import { loadAndFilterSessions } from "../../utils/filters.js";

export async function trendsCommand(options: { weeks?: string; format?: string }): Promise<void> {
  const numWeeks = options.weeks ? parseInt(options.weeks, 10) : 4;
  const days = numWeeks * 7;

  const sessions = await loadAndFilterSessions({ period: `${days}d` });

  if (sessions.length === 0) {
    console.log("No sessions found for the given period.");
    return;
  }

  const insights = new InsightsEngine();
  const now = new Date();

  // Build week buckets (most recent last)
  const weeks: WeekBucket[] = [];
  for (let w = numWeeks - 1; w >= 0; w--) {
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - w * 7);
    weekEnd.setHours(23, 59, 59, 999);

    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const weekSessions = sessions.filter(
      (s) => s.startTime >= weekStart && s.startTime <= weekEnd,
    );

    const weekWaste = insights.analyze(weekSessions);
    const weekCost = weekSessions.reduce((sum, s) => sum + s.estimatedCostUSD, 0);
    const totalWaste = weekWaste.reduce((sum, s) => sum + s.estimatedWastedCostUSD, 0);

    // Commits approximated from session metadata
    const weekCommits = weekSessions.reduce((sum, s) => sum + s.gitCommits, 0);

    const efficiency = computeEfficiency({
      sessions: weekSessions,
      wasteSignals: weekWaste,
      totalCommits: weekCommits,
    });

    // Daily values for sparkline (7 days)
    const dailyValues: number[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + d);
      const dayStr = day.toISOString().slice(0, 10);
      const dayCost = weekSessions
        .filter((s) => s.startTime.toISOString().slice(0, 10) === dayStr)
        .reduce((sum, s) => sum + s.estimatedCostUSD, 0);
      dailyValues.push(dayCost);
    }

    const startLabel = weekStart.toISOString().slice(5, 10).replace("-", "/");
    const endLabel = weekEnd.toISOString().slice(5, 10).replace("-", "/");

    weeks.push({
      label: `${startLabel}–${endLabel}`,
      cost: weekCost,
      sessions: weekSessions.length,
      score: efficiency.score,
      wastePct: weekCost > 0 ? (totalWaste / weekCost) * 100 : 0,
      dailyValues,
    });
  }

  const format = (options.format || "table") as OutputFormat;

  const data = format === "csv"
    ? weeks.map((w) => ({
        week: w.label,
        cost: Math.round(w.cost * 100) / 100,
        sessions: w.sessions,
        score: w.score,
        wastePct: Math.round(w.wastePct),
      }))
    : {
        weeks: weeks.map((w) => ({
          week: w.label,
          cost: Math.round(w.cost * 100) / 100,
          sessions: w.sessions,
          score: w.score,
          wastePct: Math.round(w.wastePct),
        })),
      };

  outputAs(format, data, () => {
    renderTrends(weeks, `${numWeeks} weeks`);
  });
}
