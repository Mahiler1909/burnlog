import { basename } from "node:path";
import type {
  Session,
  TokenUsage,
  SessionOutcome,
  Friction,
  RawSessionIndex,
  RawFacets,
  RawSessionMeta,
} from "../../data/models.js";
import { parseJSONL } from "./jsonl-parser.js";
import { inferOutcome, inferSummary, inferGoal, inferGoalCategory } from "./outcome-inferrer.js";

export async function buildSession(
  entry: RawSessionIndex["entries"][0],
  originalPath: string,
  facets: RawFacets | undefined,
  meta: RawSessionMeta | undefined,
): Promise<Session | null> {
  const parseResult = await parseJSONL(entry.fullPath);
  const exchanges = parseResult.exchanges;
  const activity = parseResult.activity;

  // Calculate token usage: prefer JSONL exchange-level data, fallback to meta
  let tokenUsage: TokenUsage;
  let estimatedCostUSD: number;

  if (exchanges.length > 0) {
    tokenUsage = exchanges.reduce(
      (acc, ex) => ({
        inputTokens: acc.inputTokens + ex.tokenUsage.inputTokens,
        outputTokens: acc.outputTokens + ex.tokenUsage.outputTokens,
        cacheCreationTokens: acc.cacheCreationTokens + ex.tokenUsage.cacheCreationTokens,
        cacheReadTokens: acc.cacheReadTokens + ex.tokenUsage.cacheReadTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    );
    estimatedCostUSD = exchanges.reduce((sum, ex) => sum + ex.estimatedCostUSD, 0);
  } else if (meta) {
    tokenUsage = {
      inputTokens: meta.input_tokens,
      outputTokens: meta.output_tokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    estimatedCostUSD = 0;
  } else {
    tokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    estimatedCostUSD = 0;
  }

  // Build frictions from facets
  const frictions: Friction[] = [];
  if (facets?.friction_counts) {
    for (const [type, count] of Object.entries(facets.friction_counts)) {
      frictions.push({ type, count, detail: facets.friction_detail || "" });
    }
  }

  const startTime = new Date(entry.created);
  const endTime = new Date(entry.modified);

  return {
    id: entry.sessionId,
    projectPath: originalPath,
    projectName: basename(originalPath),
    summary: entry.summary || facets?.brief_summary || inferSummary(exchanges),
    firstPrompt: entry.firstPrompt,
    gitBranch: entry.gitBranch || parseResult.gitBranch || "",
    startTime,
    endTime,
    durationMinutes: meta?.duration_minutes ?? Math.round((endTime.getTime() - startTime.getTime()) / 60000),
    messageCount: entry.messageCount || exchanges.length * 2,
    isSidechain: entry.isSidechain,

    tokenUsage,
    estimatedCostUSD,

    goal: facets?.underlying_goal || inferGoal(exchanges, parseResult.firstRawPrompt),
    goalCategory: facets ? Object.keys(facets.goal_categories)[0] || "unknown" : inferGoalCategory(exchanges),
    outcome: (facets?.outcome as SessionOutcome) || inferOutcome(exchanges, activity, meta),
    helpfulness: facets?.claude_helpfulness || "unknown",
    sessionType: facets?.session_type || "unknown",
    frictions,

    toolCounts: Object.keys(activity.toolCounts).length > 0 ? activity.toolCounts : (meta?.tool_counts || {}),
    languages: meta?.languages || {},
    linesAdded: activity.linesAdded > 0 ? activity.linesAdded : (meta?.lines_added || 0),
    linesRemoved: activity.linesRemoved > 0 ? activity.linesRemoved : (meta?.lines_removed || 0),
    filesModified: activity.filesModified.size > 0 ? activity.filesModified.size : (meta?.files_modified || 0),
    gitCommits: meta?.git_commits || 0,
    toolErrors: meta?.tool_errors || 0,
    userInterruptions: meta?.user_interruptions || 0,

    exchanges,
  };
}
