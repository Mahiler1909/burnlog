import {
  loadBudgetConfig,
  saveBudgetConfig,
  projectSpend,
  budgetHitDate,
  type BudgetConfig,
} from "../../core/budget.js";
import { renderBudgetStatus, type BudgetGauge } from "../formatters/table.js";
import { outputAs, type OutputFormat } from "../formatters/export.js";
import { loadAndFilterSessions } from "../../utils/filters.js";

export async function budgetSetCommand(options: {
  daily?: string;
  weekly?: string;
  monthly?: string;
}): Promise<void> {
  const current = await loadBudgetConfig();

  const budget: BudgetConfig = {
    daily: options.daily ? parseFloat(options.daily) : current.daily,
    weekly: options.weekly ? parseFloat(options.weekly) : current.weekly,
    monthly: options.monthly ? parseFloat(options.monthly) : current.monthly,
  };

  // Remove undefined/NaN entries
  if (!budget.daily || isNaN(budget.daily)) delete budget.daily;
  if (!budget.weekly || isNaN(budget.weekly)) delete budget.weekly;
  if (!budget.monthly || isNaN(budget.monthly)) delete budget.monthly;

  await saveBudgetConfig(budget);
  console.log("Budget saved:");
  if (budget.daily) console.log(`  Daily:   $${budget.daily}`);
  if (budget.weekly) console.log(`  Weekly:  $${budget.weekly}`);
  if (budget.monthly) console.log(`  Monthly: $${budget.monthly}`);
}

export async function budgetCommand(options: { format?: string }): Promise<void> {
  const budget = await loadBudgetConfig();

  if (!budget.daily && !budget.weekly && !budget.monthly) {
    console.log("No budget configured. Use: burnlog budget set --daily 20 --weekly 100 --monthly 400");
    return;
  }

  const now = new Date();

  // Load sessions for current month
  const sessions = await loadAndFilterSessions({ period: "30d" });
  const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUSD, 0);

  // Daily spend (today)
  const todayStr = now.toISOString().slice(0, 10);
  const todayCost = sessions
    .filter((s) => s.startTime.toISOString().slice(0, 10) === todayStr)
    .reduce((sum, s) => sum + s.estimatedCostUSD, 0);

  // Weekly spend (current week, Monday-based)
  const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon, 6=Sun
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  const weeklyCost = sessions
    .filter((s) => s.startTime >= weekStart)
    .reduce((sum, s) => sum + s.estimatedCostUSD, 0);

  // Monthly spend
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyCost = sessions
    .filter((s) => s.startTime >= monthStart)
    .reduce((sum, s) => sum + s.estimatedCostUSD, 0);

  const gauges: BudgetGauge[] = [];
  if (budget.daily) gauges.push({ label: "Daily", spent: todayCost, limit: budget.daily });
  if (budget.weekly) gauges.push({ label: "Weekly", spent: weeklyCost, limit: budget.weekly });
  if (budget.monthly) gauges.push({ label: "Monthly", spent: monthlyCost, limit: budget.monthly });

  // Projection for monthly
  let projection: { monthly: number; limit: number; hitDate?: string } | undefined;
  if (budget.monthly) {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();
    const projected = projectSpend(monthlyCost, daysElapsed, daysInMonth);
    const hitDate = budgetHitDate(monthlyCost, daysElapsed, budget.monthly, monthStart, daysInMonth);
    projection = { monthly: projected, limit: budget.monthly, hitDate };
  }

  const format = (options.format || "table") as OutputFormat;

  const data = {
    gauges: gauges.map((g) => ({
      label: g.label,
      spent: Math.round(g.spent * 100) / 100,
      limit: g.limit,
      pct: g.limit > 0 ? Math.round((g.spent / g.limit) * 100) : 0,
    })),
    projection: projection
      ? {
          monthly: Math.round(projection.monthly * 100) / 100,
          limit: projection.limit,
          withinBudget: projection.monthly <= projection.limit,
          hitDate: projection.hitDate,
        }
      : undefined,
  };

  outputAs(format, data, () => {
    renderBudgetStatus(gauges, projection);
  });
}
