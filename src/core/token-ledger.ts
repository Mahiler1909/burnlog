import type { TokenUsage, Session, CostBreakdown } from "../data/models.js";
import { getModelPricing } from "../utils/pricing-tables.js";

export function calculateCost(usage: TokenUsage, model: string): number {
  const pricing = getModelPricing(model);
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion +
    (usage.cacheCreationTokens / 1_000_000) * pricing.cacheWritePerMillion +
    (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion
  );
}

export function sumTokenUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + u.cacheCreationTokens,
      cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  );
}

export function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
}

const CATEGORY_ALIASES: Record<string, string> = {
  fix_bug: "bug_fix",
  code_implementation: "implementation",
  documentation_creation: "documentation",
  documentation_cleanup: "documentation",
  documentation_generation: "documentation",
};

function normalizeCategory(category: string): string {
  return CATEGORY_ALIASES[category] ?? category;
}

export function buildCostBreakdown(sessions: Session[]): CostBreakdown {
  const byProject: Record<string, number> = {};
  const byBranch: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};

  for (const s of sessions) {
    const projectKey = s.projectName;
    byProject[projectKey] = (byProject[projectKey] ?? 0) + s.estimatedCostUSD;

    const branchKey = s.gitBranch || "(no branch)";
    byBranch[branchKey] = (byBranch[branchKey] ?? 0) + s.estimatedCostUSD;

    const dayKey = s.startTime.toISOString().slice(0, 10);
    byDay[dayKey] = (byDay[dayKey] ?? 0) + s.estimatedCostUSD;

    const outcomeKey = s.outcome;
    byOutcome[outcomeKey] = (byOutcome[outcomeKey] ?? 0) + s.estimatedCostUSD;

    const catKey = normalizeCategory(s.goalCategory || "unknown");
    byCategory[catKey] = (byCategory[catKey] ?? 0) + s.estimatedCostUSD;

    for (const ex of s.exchanges) {
      const modelKey = ex.model || "unknown";
      byModel[modelKey] = (byModel[modelKey] ?? 0) + ex.estimatedCostUSD;
    }
  }

  return { byProject, byBranch, byCategory, byModel, byDay, byOutcome };
}
