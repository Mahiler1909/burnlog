import type { Session, WasteSignal } from "../data/models.js";

export class InsightsEngine {
  analyze(sessions: Session[]): WasteSignal[] {
    const signals: WasteSignal[] = [];

    for (const session of sessions) {
      signals.push(...detectRetryLoops(session));
      const abandoned = detectAbandonedSession(session);
      if (abandoned) signals.push(abandoned);
      signals.push(...detectContextRebuilds(session));
      const excessive = detectExcessiveExploration(session);
      if (excessive) signals.push(excessive);
      const cascade = detectErrorCascade(session);
      if (cascade) signals.push(cascade);
      signals.push(...detectKnownFrictions(session));
    }

    // Sort by wasted cost descending
    signals.sort((a, b) => b.estimatedWastedCostUSD - a.estimatedWastedCostUSD);
    return signals;
  }
}

/**
 * Detect 3+ consecutive exchanges editing the same files with similar prompts.
 */
function detectRetryLoops(session: Session): WasteSignal[] {
  const signals: WasteSignal[] = [];
  if (session.exchanges.length < 3) return signals;

  let streak = 1;
  let streakCost = 0;
  let streakFiles: string[] = [];

  for (let i = 1; i < session.exchanges.length; i++) {
    const prev = session.exchanges[i - 1];
    const curr = session.exchanges[i];

    const fileOverlap = curr.filesModified.length > 0 &&
      curr.filesModified.some((f) => prev.filesModified.includes(f));
    const wordSim = jaccardSimilarity(
      prev.userPrompt.toLowerCase().split(/\s+/),
      curr.userPrompt.toLowerCase().split(/\s+/),
    );

    if (fileOverlap && wordSim > 0.4) {
      streak++;
      streakCost += curr.estimatedCostUSD;
      streakFiles = [...new Set([...streakFiles, ...curr.filesModified])];
    } else {
      if (streak >= 3) {
        signals.push({
          type: "retry_loop",
          sessionId: session.id,
          estimatedWastedCostUSD: streakCost,
          description: `${streak} consecutive retries on ${streakFiles.join(", ")}`,
          suggestion: "Break the problem into smaller steps or provide more context upfront",
        });
      }
      streak = 1;
      streakCost = 0;
      streakFiles = [];
    }
  }

  if (streak >= 3) {
    signals.push({
      type: "retry_loop",
      sessionId: session.id,
      estimatedWastedCostUSD: streakCost,
      description: `${streak} consecutive retries on ${streakFiles.join(", ")}`,
      suggestion: "Break the problem into smaller steps or provide more context upfront",
    });
  }

  return signals;
}

/**
 * Detect sessions with outcome=not_achieved, no commits, and non-trivial cost.
 */
function detectAbandonedSession(session: Session): WasteSignal | null {
  if (session.outcome !== "not_achieved") return null;
  if (session.gitCommits > 0) return null;
  if (session.estimatedCostUSD < 0.50) return null;

  return {
    type: "abandoned_session",
    sessionId: session.id,
    estimatedWastedCostUSD: session.estimatedCostUSD,
    description: `Session ended with no commits and outcome: not_achieved`,
    suggestion: "Start with a smaller scope or validate the approach in a cheaper planning session",
  };
}

/**
 * Detect cache rebuild spikes: high cacheCreationTokens after exchanges with high cacheReadTokens.
 */
function detectContextRebuilds(session: Session): WasteSignal[] {
  const signals: WasteSignal[] = [];
  let lastHadCacheRead = false;

  for (const ex of session.exchanges) {
    const totalInput = ex.tokenUsage.inputTokens + ex.tokenUsage.cacheReadTokens;
    const cacheWriteRatio = totalInput > 0
      ? ex.tokenUsage.cacheCreationTokens / totalInput
      : 0;

    if (lastHadCacheRead && cacheWriteRatio > 0.3 && ex.tokenUsage.cacheCreationTokens > 50_000) {
      // Estimate rebuild cost using average cache write pricing ($3.75/M for Sonnet)
      const rebuildCost = (ex.tokenUsage.cacheCreationTokens / 1_000_000) * 3.75;
      signals.push({
        type: "context_rebuild",
        sessionId: session.id,
        estimatedWastedCostUSD: rebuildCost,
        description: `Cache rebuilt at exchange #${ex.sequenceNumber} (${formatK(ex.tokenUsage.cacheCreationTokens)} cache write tokens)`,
        suggestion: "Split long sessions to avoid context compaction overhead",
      });
    }

    lastHadCacheRead = ex.tokenUsage.cacheReadTokens > 10_000;
  }

  return signals;
}

/**
 * Detect sessions where >70% of exchanges are read-only with no implementation.
 */
function detectExcessiveExploration(session: Session): WasteSignal | null {
  if (session.exchanges.length <= 5) return null;

  const exploration = session.exchanges.filter((e) => e.category === "exploration").length;
  const implementation = session.exchanges.filter((e) => e.category === "implementation").length;
  const ratio = exploration / session.exchanges.length;

  if (ratio > 0.70 && implementation === 0) {
    return {
      type: "excessive_exploration",
      sessionId: session.id,
      estimatedWastedCostUSD: session.estimatedCostUSD * 0.3,
      description: `${Math.round(ratio * 100)}% of exchanges were read-only with no edits (${exploration}/${session.exchanges.length})`,
      suggestion: "Provide a clearer goal or break exploration into a separate planning session",
    };
  }

  return null;
}

/**
 * Detect sessions with many tool errors and long debugging streaks.
 */
function detectErrorCascade(session: Session): WasteSignal | null {
  if (session.toolErrors <= 3) return null;

  let maxStreak = 0;
  let currentStreak = 0;
  let streakCost = 0;
  let maxStreakCost = 0;

  for (const ex of session.exchanges) {
    if (ex.category === "debugging") {
      currentStreak++;
      streakCost += ex.estimatedCostUSD;
    } else {
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
        maxStreakCost = streakCost;
      }
      currentStreak = 0;
      streakCost = 0;
    }
  }
  if (currentStreak > maxStreak) {
    maxStreak = currentStreak;
    maxStreakCost = streakCost;
  }

  if (maxStreak >= 3) {
    return {
      type: "error_cascade",
      sessionId: session.id,
      estimatedWastedCostUSD: maxStreakCost * 0.5,
      description: `${maxStreak} consecutive debugging exchanges with ${session.toolErrors} total tool errors`,
      suggestion: "Persistent errors suggest a fundamental problem. Stop and re-evaluate the approach",
    };
  }

  return null;
}

/**
 * Detect known frictions from facets data (wrong_approach, etc).
 */
function detectKnownFrictions(session: Session): WasteSignal[] {
  const signals: WasteSignal[] = [];

  for (const friction of session.frictions) {
    if (friction.type === "wrong_approach" || friction.type === "misunderstanding") {
      const wastedCost = Math.min(
        session.estimatedCostUSD * 0.15 * friction.count,
        session.estimatedCostUSD * 0.5,
      );
      if (wastedCost < 0.10) continue;
      signals.push({
        type: "wrong_approach",
        sessionId: session.id,
        estimatedWastedCostUSD: wastedCost,
        description: `${friction.count}x ${friction.type}: ${friction.detail}`,
        suggestion: "Use /plan mode to validate approach before implementation",
      });
    }
  }

  return signals;
}

// --- Utilities ---

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a.filter((w) => w.length > 2));
  const setB = new Set(b.filter((w) => w.length > 2));
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
