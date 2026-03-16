import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface BudgetConfig {
  daily?: number;
  weekly?: number;
  monthly?: number;
}

const CONFIG_DIR = join(homedir(), ".config", "burnlog");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface ConfigFile {
  budget?: BudgetConfig;
}

export async function loadBudgetConfig(): Promise<BudgetConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    const config: ConfigFile = JSON.parse(raw);
    return config.budget ?? {};
  } catch {
    return {};
  }
}

export async function saveBudgetConfig(budget: BudgetConfig): Promise<void> {
  let config: ConfigFile = {};
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    config = JSON.parse(raw);
  } catch {
    // New file
  }
  config.budget = budget;
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Compute projection for a budget period.
 */
export function projectSpend(
  currentSpend: number,
  daysElapsed: number,
  totalDaysInPeriod: number,
): number {
  if (daysElapsed <= 0) return 0;
  return (currentSpend / daysElapsed) * totalDaysInPeriod;
}

/**
 * Calculate the date when the budget limit will be hit at current pace.
 */
export function budgetHitDate(
  currentSpend: number,
  daysElapsed: number,
  limit: number,
  periodStartDate: Date,
  totalDaysInPeriod: number,
): string | undefined {
  if (daysElapsed <= 0 || currentSpend <= 0) return undefined;
  const dailyRate = currentSpend / daysElapsed;
  const daysToLimit = (limit - currentSpend) / dailyRate;
  if (daysToLimit < 0 || daysToLimit > totalDaysInPeriod) return undefined;
  const hitDate = new Date(periodStartDate);
  hitDate.setDate(hitDate.getDate() + daysElapsed + Math.ceil(daysToLimit));
  return hitDate.toISOString().slice(0, 10);
}
