import type { Session, WasteSignal } from "../data/models.js";

export interface EfficiencyInput {
  sessions: Session[];
  wasteSignals: WasteSignal[];
  totalCommits: number;
}

export interface EfficiencyResult {
  score: number; // 0–100
  components: {
    outcomeRatio: number;   // 0–1
    wasteRatio: number;     // 0–1 (inverted: 1 = no waste)
    costEfficiency: number; // 0–1
    cacheHitRate: number;   // 0–1
  };
}

/**
 * Compute a composite efficiency score (0–100) from session data.
 *
 * Weights:
 *   Outcome ratio   35%
 *   Waste ratio     25%  (inverted: lower waste = higher score)
 *   Cost efficiency  20%  (normalized $/commit)
 *   Cache hit rate   20%
 */
export function computeEfficiency(input: EfficiencyInput): EfficiencyResult {
  const { sessions, wasteSignals, totalCommits } = input;

  if (sessions.length === 0) {
    return { score: 0, components: { outcomeRatio: 0, wasteRatio: 1, costEfficiency: 0, cacheHitRate: 0 } };
  }

  // 1. Outcome ratio (35%)
  const outcomeWeights: Record<string, number> = {
    fully_achieved: 1.0,
    mostly_achieved: 0.7,
    partially_achieved: 0.3,
    not_achieved: 0,
    unknown: 0.5,
  };
  const outcomeSum = sessions.reduce((sum, s) => sum + (outcomeWeights[s.outcome] ?? 0.5), 0);
  const outcomeRatio = outcomeSum / sessions.length;

  // 2. Waste ratio (25%) — inverted: 1 means no waste
  const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUSD, 0);
  const totalWaste = wasteSignals.reduce((sum, w) => sum + w.estimatedWastedCostUSD, 0);
  const wasteRatio = totalCost > 0 ? Math.max(0, 1 - totalWaste / totalCost) : 1;

  // 3. Cost efficiency (20%) — normalized $/commit
  //    $5/commit → 1.0, $50/commit → 0.0, clamped
  let costEfficiency = 0.5; // default when no commits
  if (totalCommits > 0 && totalCost > 0) {
    const costPerCommit = totalCost / totalCommits;
    costEfficiency = Math.max(0, Math.min(1, 1 - (costPerCommit - 5) / 45));
  }

  // 4. Cache hit rate (20%)
  const totalInput = sessions.reduce((sum, s) => sum + s.tokenUsage.inputTokens, 0);
  const totalCacheRead = sessions.reduce((sum, s) => sum + s.tokenUsage.cacheReadTokens, 0);
  const cacheHitRate = (totalInput + totalCacheRead) > 0
    ? totalCacheRead / (totalInput + totalCacheRead)
    : 0;

  const score = Math.round(
    (outcomeRatio * 35 + wasteRatio * 25 + costEfficiency * 20 + cacheHitRate * 20),
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    components: { outcomeRatio, wasteRatio, costEfficiency, cacheHitRate },
  };
}
