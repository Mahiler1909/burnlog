import type { Exchange, JSONLActivityStats, RawSessionMeta, SessionOutcome } from "../../data/models.js";

export function inferOutcome(
  exchanges: Exchange[],
  activity: JSONLActivityStats,
  meta: RawSessionMeta | undefined,
): SessionOutcome {
  if (exchanges.length === 0) return "unknown";

  const hasImpl = exchanges.some((e) => e.category === "implementation");
  const producedChanges = activity.linesAdded > 0 || activity.filesModified.size > 0;
  const hasMeta = !!meta;
  const errors = meta?.tool_errors ?? 0;
  const interruptions = meta?.user_interruptions ?? 0;

  if (hasImpl && producedChanges) {
    if (hasMeta && errors === 0 && interruptions === 0) return "fully_achieved";
    if (hasMeta && errors === 0) return "mostly_achieved";
    if (hasMeta) return "partially_achieved";
    return "mostly_achieved";
  }
  const totalCost = exchanges.reduce((s, e) => s + e.estimatedCostUSD, 0);
  if (exchanges.length > 3 && !hasImpl && totalCost > 0.5) {
    return "not_achieved";
  }
  if (errors > 0 && activity.filesModified.size === 0) {
    return "not_achieved";
  }
  return "unknown";
}

export function inferSummary(exchanges: Exchange[]): string {
  if (exchanges.length === 0) return "";

  const rawPrompt = exchanges.find((e) => e.userPrompt)?.userPrompt || "";
  if (!rawPrompt) return "";
  const firstLine = rawPrompt.split(/[\n\r]/)[0].trim();
  const prompt = firstLine.replace(/^\/\w+\s*/, "").trim() || firstLine;

  const files = new Set<string>();
  for (const ex of exchanges) {
    for (const f of ex.filesModified) {
      const basename = f.split("/").pop() || f;
      files.add(basename);
      if (files.size >= 3) break;
    }
    if (files.size >= 3) break;
  }

  const fileStr = files.size > 0 ? ` → ${[...files].join(", ")}` : "";
  return prompt + fileStr;
}

export function inferGoal(exchanges: Exchange[], firstRawPrompt?: string): string {
  if (firstRawPrompt && firstRawPrompt.length > 20) {
    return firstRawPrompt;
  }
  if (exchanges.length === 0) return "";
  const candidates = exchanges.slice(0, 5);
  const substantive = candidates.find((e) => e.userPrompt.length > 20);
  return substantive?.userPrompt || candidates[0]?.userPrompt || "";
}

export function inferGoalCategory(exchanges: Exchange[]): string {
  if (exchanges.length === 0) return "unknown";
  const categories = exchanges.map((e) => e.category);
  const counts: Record<string, number> = {};
  for (const c of categories) {
    counts[c] = (counts[c] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || "unknown";
}
