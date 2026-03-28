import chalk from "chalk";
import Table from "cli-table3";
import type { Session, CostBreakdown, BranchWork, WasteSignal, GitCommit } from "../../data/models.js";
import { totalTokens } from "../../core/token-ledger.js";
import { getModelDisplayName } from "../../utils/pricing-tables.js";
import type { EfficiencyResult } from "../../core/efficiency-score.js";

// ── Visual Utilities ──────────────────────────────────────────────

const BAR_BLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Render a horizontal bar chart from a 0–1 ratio.
 * Uses 1/8-block Unicode characters for sub-character precision.
 * Empty space uses a subtle dot character for a cleaner look.
 */
export function renderBar(ratio: number, maxWidth = 20): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const fullWidth = clamped * maxWidth;
  const fullBlocks = Math.floor(fullWidth);
  const remainder = fullWidth - fullBlocks;
  const partialIndex = Math.round(remainder * 8);

  let bar = BAR_BLOCKS[8].repeat(fullBlocks);
  if (partialIndex > 0 && fullBlocks < maxWidth) {
    bar += BAR_BLOCKS[partialIndex];
  }
  const empty = maxWidth - fullBlocks - (partialIndex > 0 ? 1 : 0);
  bar += chalk.dim("─").repeat(Math.max(0, empty));
  return bar;
}

/**
 * Render a sparkline from an array of values.
 * Maps each value to one of 8 vertical bar characters.
 */
export function renderSparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;

  return values
    .map((v) => {
      if (range === 0) return SPARK_CHARS[3]; // mid-height if all equal
      const normalized = (v - min) / range;
      const idx = Math.min(7, Math.round(normalized * 7));
      // Color gradient: green (low) → yellow (mid) → red (high)
      const char = SPARK_CHARS[idx];
      if (idx <= 2) return chalk.green(char);
      if (idx <= 4) return chalk.yellow(char);
      return chalk.red(char);
    })
    .join("");
}

/**
 * Render the efficiency score with a colored bar gauge.
 */
export function renderScoreGauge(score: number, width = 20): string {
  const ratio = score / 100;
  const r = Math.round(255 * (1 - ratio));
  const g = Math.round(255 * ratio);
  const filled = Math.ceil(ratio * width);
  const empty = width - filled;
  const filledBar = BAR_BLOCKS[8].repeat(filled);
  const emptyBar = "─".repeat(Math.max(0, empty));
  return `${score}/100 ${chalk.rgb(r, g, 60)(filledBar)}${chalk.dim(emptyBar)}`;
}

// ── Formatting Helpers ────────────────────────────────────────────

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

export function outcomeIcon(outcome: string): string {
  switch (outcome) {
    case "fully_achieved":
      return chalk.green("●");
    case "mostly_achieved":
      return chalk.green("◐");
    case "partially_achieved":
      return chalk.yellow("◐");
    case "not_achieved":
      return chalk.red("○");
    default:
      return chalk.gray("◌");
  }
}

/**
 * Render an outcome distribution as a proportional bar + legend.
 * Instead of N individual dots, shows a fixed-width stacked bar.
 */
export function renderOutcomeDistribution(sessions: Session[]): string {
  const counts = { ok: 0, mostly: 0, partial: 0, fail: 0, unknown: 0 };
  for (const s of sessions) {
    switch (s.outcome) {
      case "fully_achieved": counts.ok++; break;
      case "mostly_achieved": counts.mostly++; break;
      case "partially_achieved": counts.partial++; break;
      case "not_achieved": counts.fail++; break;
      default: counts.unknown++; break;
    }
  }

  const total = sessions.length;
  if (total === 0) return chalk.dim("no sessions");

  // Build a fixed-width proportional bar (20 chars)
  const barWidth = 20;
  const segments: Array<{ count: number; color: (s: string) => string }> = [
    { count: counts.ok, color: chalk.green },
    { count: counts.mostly, color: chalk.greenBright },
    { count: counts.partial, color: chalk.yellow },
    { count: counts.fail, color: chalk.red },
    { count: counts.unknown, color: chalk.gray },
  ];

  let bar = "";
  let allocated = 0;
  for (const seg of segments) {
    if (seg.count === 0) continue;
    const width = Math.max(1, Math.round((seg.count / total) * barWidth));
    const clamped = Math.min(width, barWidth - allocated);
    bar += seg.color("█".repeat(clamped));
    allocated += clamped;
  }
  // Fill any remaining due to rounding
  if (allocated < barWidth) {
    bar += chalk.dim("─".repeat(barWidth - allocated));
  }

  const parts: string[] = [];
  if (counts.ok > 0) parts.push(chalk.green(`${counts.ok} OK`));
  if (counts.mostly > 0) parts.push(chalk.greenBright(`${counts.mostly} mostly`));
  if (counts.partial > 0) parts.push(chalk.yellow(`${counts.partial} partial`));
  if (counts.fail > 0) parts.push(chalk.red(`${counts.fail} fail`));
  if (counts.unknown > 0) parts.push(chalk.gray(`${counts.unknown} unknown`));

  return `${bar} ${parts.join(chalk.dim(" · "))}`;
}

function humanizeType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Keep backward-compatible alias
const humanizeWasteType = humanizeType;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function cleanPromptForDisplay(raw: string): string {
  if (!raw || raw.length < 80) return raw;

  let text = raw.replace(/<(bash-stdout|bash-stderr|task-notification|system-reminder|command-name|command-message|local-command-stdout)[^>]*>[\s\S]*?<\/\1>/gi, (_match, tag) => {
    return chalk.dim(`[${tag} collapsed]`);
  });

  const lines = text.split("\n");
  const result: string[] = [];
  let noiseBuffer: string[] = [];

  const isNoise = (line: string): boolean => {
    const t = line.trim();
    if (!t) return noiseBuffer.length > 0;
    return (
      /^[│├└┌┬┼─╰╭╮╯┐┤┴]+/.test(t) ||
      /^\/Users\//.test(t) ||
      /^-Users-/.test(t) ||
      /^\s*sessions:\s*\d+/.test(t) ||
      /^\s*last active:/.test(t) ||
      /^(Error|Warning|note|hint|Traceback|×):?\s/.test(t) ||
      /^\s{6,}/.test(line) ||
      /^(Old|To|Done|Changes|Read more):?\s/.test(t) ||
      /^\s*at\s+/.test(t) ||
      /^\s*python3?\s/.test(t) ||
      /^\s*source\s/.test(t) ||
      /^\s*brew\s/.test(t) ||
      /^\s*If you/.test(t)
    );
  };

  const flushNoise = () => {
    if (noiseBuffer.length > 3) {
      result.push(chalk.dim(`[... ${noiseBuffer.length} lines of pasted output ...]`));
    } else {
      result.push(...noiseBuffer);
    }
    noiseBuffer = [];
  };

  for (const line of lines) {
    if (isNoise(line)) {
      noiseBuffer.push(line);
    } else {
      flushNoise();
      result.push(line);
    }
  }
  flushNoise();

  return result.join("\n").trim();
}

function wrapIndented(text: string, indent: number): string {
  const width = (process.stdout.columns || 100) - indent;
  if (text.length <= width) return text;
  const pad = " ".repeat(indent);
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && (current.length + 1 + word.length) > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n" + pad);
}

// ── Report Renderers ──────────────────────────────────────────────

export function renderReportHeader(
  sessions: Session[],
  periodLabel: string,
  opts?: {
    commitsByProject?: Map<string, number>;
    breakdown?: CostBreakdown;
    efficiency?: EfficiencyResult;
  },
): void {
  const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUSD, 0);
  const totalSessions = sessions.length;
  const projects = new Set(sessions.map((s) => s.projectName)).size;
  const commitsByProject = opts?.commitsByProject;
  const totalCommits = commitsByProject
    ? [...commitsByProject.values()].reduce((sum, c) => sum + c, 0)
    : sessions.reduce((sum, s) => sum + s.gitCommits, 0);

  console.log();
  console.log(chalk.bold(`Burnlog Report (${periodLabel})`));
  console.log(chalk.dim("═".repeat(60)));
  console.log(
    `Total: ${chalk.bold.green(formatCurrency(totalCost))}  |  ` +
      `${totalSessions} sessions  |  ` +
      `${projects} projects  |  ` +
      `${totalCommits} commits`,
  );

  // Efficiency score
  if (opts?.efficiency) {
    console.log(`Score: ${renderScoreGauge(opts.efficiency.score)}`);
  }

  // Daily sparkline
  if (opts?.breakdown?.byDay) {
    const dayEntries = Object.entries(opts.breakdown.byDay).sort(([a], [b]) => a.localeCompare(b));
    if (dayEntries.length > 1) {
      const values = dayEntries.map(([, v]) => v);
      const peakIdx = values.indexOf(Math.max(...values));
      const peakDate = dayEntries[peakIdx]?.[0] ?? "";
      const peakCost = values[peakIdx] ?? 0;
      console.log(
        `Daily: ${renderSparkline(values)}  ` +
          chalk.dim(`Peak: ${formatCurrency(peakCost)} on ${peakDate}`),
      );
    }
  }

  // Outcome distribution
  console.log(`Outcomes: ${renderOutcomeDistribution(sessions)}`);
  console.log();
}

export function renderByProject(sessions: Session[], commitsByProject?: Map<string, number>): void {
  const grouped = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = grouped.get(s.projectName) ?? [];
    list.push(s);
    grouped.set(s.projectName, list);
  }

  const table = new Table({
    head: ["Project", "Cost", "Sessions", "Commits", "Lines +/-", "$/Commit", "$/Line", "Outcome"].map((h) =>
      chalk.cyan(h),
    ),
    style: { head: [], border: [] },
  });

  const sorted = [...grouped.entries()].sort((a, b) => {
    const costA = a[1].reduce((s, x) => s + x.estimatedCostUSD, 0);
    const costB = b[1].reduce((s, x) => s + x.estimatedCostUSD, 0);
    return costB - costA;
  });

  for (const [name, projectSessions] of sorted) {
    const cost = projectSessions.reduce((s, x) => s + x.estimatedCostUSD, 0);
    const commits = commitsByProject ? (commitsByProject.get(name) ?? 0) : projectSessions.reduce((s, x) => s + x.gitCommits, 0);
    const linesAdded = projectSessions.reduce((s, x) => s + x.linesAdded, 0);
    const linesRemoved = projectSessions.reduce((s, x) => s + x.linesRemoved, 0);
    const totalLines = linesAdded + linesRemoved;
    const achieved = projectSessions.filter((x) => x.outcome === "fully_achieved").length;

    const costPerCommit = commits > 0 ? formatCurrency(cost / commits) : "—";
    const costPerLine = totalLines > 0 ? "$" + (cost / totalLines).toFixed(3) : "—";

    table.push([
      name,
      formatCurrency(cost),
      projectSessions.length.toString(),
      commits.toString(),
      `+${linesAdded} / -${linesRemoved}`,
      costPerCommit,
      costPerLine,
      `${achieved}/${projectSessions.length}`,
    ]);
  }

  console.log(chalk.bold("By Project"));
  console.log(table.toString());
  console.log();
}

export function renderByModel(breakdown: CostBreakdown): void {
  const table = new Table({
    head: ["Model", "Cost", "% Total", ""].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  const total = Object.values(breakdown.byModel).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(breakdown.byModel)
    .filter(([, cost]) => cost > 0.001)
    .sort((a, b) => b[1] - a[1]);

  for (const [model, cost] of sorted) {
    const ratio = total > 0 ? cost / total : 0;
    const pct = (ratio * 100).toFixed(1);
    table.push([getModelDisplayName(model), formatCurrency(cost), `${pct}%`, chalk.cyan(renderBar(ratio, 15))]);
  }

  console.log(chalk.bold("By Model"));
  console.log(table.toString());
  console.log();
}

export function renderByCategory(breakdown: CostBreakdown): void {
  const table = new Table({
    head: ["Category", "Cost", "% Total", ""].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  const total = Object.values(breakdown.byCategory).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(breakdown.byCategory)
    .filter(([, cost]) => cost > 0.001)
    .sort((a, b) => b[1] - a[1]);

  const TOP_N = 5;
  const top = sorted.slice(0, TOP_N);
  const rest = sorted.slice(TOP_N);

  for (const [cat, cost] of top) {
    const ratio = total > 0 ? cost / total : 0;
    const pct = (ratio * 100).toFixed(1);
    table.push([humanizeType(cat), formatCurrency(cost), `${pct}%`, chalk.cyan(renderBar(ratio, 15))]);
  }

  if (rest.length > 0) {
    const otherCost = rest.reduce((s, [, c]) => s + c, 0);
    const ratio = total > 0 ? otherCost / total : 0;
    const pct = (ratio * 100).toFixed(1);
    table.push([chalk.dim(`Other (${rest.length} more)`), formatCurrency(otherCost), `${pct}%`, chalk.cyan(renderBar(ratio, 15))]);
  }

  console.log(chalk.bold("By Goal Category"));
  console.log(table.toString());
  console.log();
}

export function renderByOutcome(breakdown: CostBreakdown): void {
  const total = Object.values(breakdown.byOutcome).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(breakdown.byOutcome)
    .filter(([, cost]) => cost > 0.001)
    .sort((a, b) => b[1] - a[1]);

  // If one outcome dominates (>90%), show inline instead of a full table
  if (sorted.length > 0 && total > 0) {
    const topRatio = sorted[0][1] / total;
    if (topRatio >= 0.9) {
      const [topOutcome, topCost] = sorted[0];
      const pct = (topRatio * 100).toFixed(0);
      console.log(`${chalk.bold("Outcomes:")} ${outcomeIcon(topOutcome)} ${pct}% ${topOutcome.replace(/_/g, " ")} (${formatCurrency(topCost)})`);
      console.log();
      return;
    }
  }

  const table = new Table({
    head: ["Outcome", "Cost", "% Total", ""].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  for (const [outcome, cost] of sorted) {
    const ratio = total > 0 ? cost / total : 0;
    const pct = (ratio * 100).toFixed(1);
    const barColor = outcome === "fully_achieved" || outcome === "mostly_achieved"
      ? chalk.green
      : outcome === "not_achieved" ? chalk.red : chalk.yellow;
    table.push([outcomeIcon(outcome) + " " + outcome, formatCurrency(cost), `${pct}%`, barColor(renderBar(ratio, 15))]);
  }

  console.log(chalk.bold("By Outcome"));
  console.log(table.toString());
  console.log();
}

export function renderSessionsList(sessions: Session[]): void {
  // Outcome distribution above the table
  console.log(`  ${renderOutcomeDistribution(sessions)}`);
  console.log();

  const termWidth = process.stdout.columns || 120;
  const fixedWidth = 76;
  const flexWidth = Math.max(termWidth - fixedWidth, 60);
  const projectW = Math.max(Math.floor(flexWidth * 0.18), 14);
  const branchW = Math.max(Math.floor(flexWidth * 0.35), 20);
  const summaryW = Math.max(flexWidth - projectW - branchW, 20);

  const table = new Table({
    head: ["ID", "Date", "Project", "Branch", "Cost", "Tokens", "", "Summary"].map((h) =>
      chalk.cyan(h),
    ),
    style: { head: [], border: [] },
    colWidths: [10, 12, projectW, branchW, 10, 10, 3, summaryW],
    wordWrap: true,
  });

  for (const s of sessions) {
    table.push([
      s.id.slice(0, 8),
      s.startTime.toISOString().slice(0, 10),
      truncate(s.projectName, projectW - 2),
      truncate(s.gitBranch || "—", branchW - 2),
      s.estimatedCostUSD > 0 ? formatCurrency(s.estimatedCostUSD) : chalk.dim("n/a"),
      totalTokens(s.tokenUsage) > 0 ? formatTokens(totalTokens(s.tokenUsage)) : chalk.dim("n/a"),
      outcomeIcon(s.outcome),
      truncate((s.summary || s.firstPrompt) || "—", summaryW - 2),
    ]);
  }

  console.log(table.toString());
}

export function renderSessionDetail(session: Session, wasteSignals?: WasteSignal[], commits?: GitCommit[]): void {
  console.log();
  console.log(chalk.bold(`Session: ${session.id}`));
  console.log(chalk.dim("═".repeat(60)));
  console.log(`Project:    ${session.projectName} (${session.projectPath})`);
  console.log(`Branch:     ${session.gitBranch || "—"}`);
  console.log(`Date:       ${session.startTime.toISOString().slice(0, 10)} → ${session.endTime.toISOString().slice(0, 10)}`);
  console.log(`Duration:   ${session.durationMinutes} min`);
  console.log(`Messages:   ${session.messageCount}`);
  console.log(`Cost:       ${chalk.bold.green(formatCurrency(session.estimatedCostUSD))}`);
  console.log(`Outcome:    ${outcomeIcon(session.outcome)} ${session.outcome}`);
  console.log(`Goal:       ${wrapIndented(session.goal || "—", 12)}`);
  console.log(`Category:   ${session.goalCategory}`);
  console.log(`Type:       ${session.sessionType}`);
  console.log();

  // Activity
  console.log(chalk.bold("Activity"));
  console.log(`  Lines:     +${session.linesAdded} / -${session.linesRemoved}`);
  console.log(`  Files:     ${session.filesModified} modified`);
  console.log(`  Commits:   ${commits?.length ?? session.gitCommits}`);
  console.log(`  Errors:    ${session.toolErrors}`);
  console.log(`  Interrupts: ${session.userInterruptions}`);

  if (Object.keys(session.toolCounts).length > 0) {
    const simplified = Object.entries(session.toolCounts)
      .map(([k, v]) => {
        const name = k.replace(/^mcp__([^_]+)__(.+)$/, "$1:$2").replace(/^mcp__/, "mcp:");
        return [name, v] as [string, number];
      })
      .sort((a, b) => b[1] - a[1]);
    console.log(`  Tools:     ${simplified.map(([k, v]) => `${k}:${v}`).join(", ")}`);
  }
  if (Object.keys(session.languages).length > 0) {
    console.log(`  Languages: ${Object.entries(session.languages).map(([k, v]) => `${k}:${v}`).join(", ")}`);
  }

  const allModifiedFiles = new Set<string>();
  const allReadFiles = new Set<string>();
  for (const ex of session.exchanges) {
    for (const f of ex.filesModified) allModifiedFiles.add(f);
    for (const f of ex.filesRead) allReadFiles.add(f);
  }
  if (allModifiedFiles.size > 0) {
    console.log(`  Modified:  ${[...allModifiedFiles].join(", ")}`);
  }

  // Frictions
  if (session.frictions.length > 0) {
    console.log();
    console.log(chalk.bold.yellow("Frictions"));
    for (const f of session.frictions) {
      console.log(`  ${chalk.yellow("!")} ${f.type} (x${f.count}): ${f.detail}`);
    }
  }

  // Waste Signals
  if (wasteSignals && wasteSignals.length > 0) {
    console.log();
    console.log(chalk.bold.red(`Waste Signals (${wasteSignals.length})`));
    for (const sig of wasteSignals) {
      console.log(`  ${chalk.red("$")} ${humanizeWasteType(sig.type)}: ${sig.description} (${formatCurrency(sig.estimatedWastedCostUSD)} wasted)`);
      console.log(`    ${chalk.dim(sig.suggestion)}`);
    }
  }

  // Correlated Commits
  if (commits && commits.length > 0) {
    console.log();
    console.log(chalk.bold(`Correlated Commits (${commits.length})`));
    const msgW = Math.max((process.stdout.columns || 100) - 42, 30);
    const commitTable = new Table({
      head: ["Hash", "Date", "+/-", "Message"].map((h) => chalk.cyan(h)),
      style: { head: [], border: [] },
      colWidths: [10, 12, 14, msgW],
      wordWrap: true,
    });
    for (const c of commits) {
      commitTable.push([
        c.hash.slice(0, 8),
        c.timestamp.toISOString().slice(0, 10),
        `+${c.linesAdded} / -${c.linesRemoved}`,
        c.message,
      ]);
    }
    console.log(commitTable.toString());
  }

  // Tokens
  console.log();
  console.log(chalk.bold("Token Usage"));
  console.log(`  Input:        ${formatTokens(session.tokenUsage.inputTokens)}`);
  console.log(`  Output:       ${formatTokens(session.tokenUsage.outputTokens)}`);
  console.log(`  Cache Write:  ${formatTokens(session.tokenUsage.cacheCreationTokens)}`);
  console.log(`  Cache Read:   ${formatTokens(session.tokenUsage.cacheReadTokens)}`);
  console.log(`  Total:        ${formatTokens(totalTokens(session.tokenUsage))}`);

  // Exchanges — show top 15 by cost to keep output manageable
  if (session.exchanges.length > 0) {
    const MAX_EXCHANGES = 15;
    const sorted = [...session.exchanges].sort((a, b) => b.estimatedCostUSD - a.estimatedCostUSD);
    const shown = sorted.slice(0, MAX_EXCHANGES);
    const omitted = session.exchanges.length - shown.length;

    console.log();
    console.log(chalk.bold(`Exchanges (${session.exchanges.length} total, showing top ${shown.length} by cost)`));
    const indent = 14;

    // Show in original sequence order for readability
    const shownSet = new Set(shown.map((e) => e.sequenceNumber));
    for (const ex of session.exchanges) {
      if (!shownSet.has(ex.sequenceNumber)) continue;
      console.log();
      console.log(chalk.dim(`  ─── #${ex.sequenceNumber} ───`));
      console.log(`  Cost:       ${formatCurrency(ex.estimatedCostUSD)}`);
      console.log(`  Model:      ${getModelDisplayName(ex.model)}`);
      console.log(`  Category:   ${ex.category}`);
      console.log(`  Tools:      ${ex.toolsUsed.join(", ") || "—"}`);
      console.log(`  Prompt:     ${wrapIndented(cleanPromptForDisplay(ex.userPrompt || "—"), indent)}`);
    }

    if (omitted > 0) {
      const omittedCost = sorted.slice(MAX_EXCHANGES).reduce((s, e) => s + e.estimatedCostUSD, 0);
      console.log();
      console.log(chalk.dim(`  ... and ${omitted} more exchanges (${formatCurrency(omittedCost)} total)`));
    }
  }

  console.log();
}

export function renderBranchDetail(bw: BranchWork, warnings?: string[], efficiency?: EfficiencyResult): void {
  const linesAdded = bw.commits.reduce((s, c) => s + c.linesAdded, 0);
  const linesRemoved = bw.commits.reduce((s, c) => s + c.linesRemoved, 0);
  const totalLines = linesAdded + linesRemoved;
  const days = Math.max(1, Math.round((bw.timeSpan.end.getTime() - bw.timeSpan.start.getTime()) / 86400000));

  console.log();
  console.log(chalk.bold(`Branch: ${bw.branchName}`));
  console.log(chalk.dim(`Project: ${bw.projectPath}`));
  console.log(chalk.dim("═".repeat(60)));
  console.log(`  Cost:           ${chalk.bold.green(formatCurrency(bw.totalCostUSD))}          Commits:     ${bw.commits.length}`);
  console.log(`  Sessions:       ${bw.sessions.length}               Lines:       +${linesAdded} / -${linesRemoved}`);
  console.log(`  Duration:       ${days} days            Cost/Commit: ${bw.commits.length > 0 ? formatCurrency(bw.costPerCommit) : "—"}`);
  console.log(`  Waste Ratio:    ${Math.round(bw.wasteRatio * 100)}%              Cost/Line:   ${totalLines > 0 ? "$" + bw.costPerLineChanged.toFixed(3) : "—"}`);
  if (efficiency) {
    console.log(`  Score:          ${renderScoreGauge(efficiency.score)}`);
  }
  console.log();

  // Sessions table
  const sessTable = new Table({
    head: ["ID", "Date", "Cost", "", "Summary"].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
    colWidths: [10, 12, 10, 3, 40],
    wordWrap: true,
  });

  for (const s of bw.sessions) {
    sessTable.push([
      s.id.slice(0, 8),
      s.startTime.toISOString().slice(0, 10),
      formatCurrency(s.estimatedCostUSD),
      outcomeIcon(s.outcome),
      truncate(s.summary || s.firstPrompt, 38),
    ]);
  }

  console.log(chalk.bold("Sessions"));
  console.log(sessTable.toString());
  console.log();

  // Commits table
  if (bw.commits.length > 0) {
    const msgW2 = Math.max((process.stdout.columns || 100) - 42, 30);
    const commitTable = new Table({
      head: ["Hash", "Date", "+/-", "Message"].map((h) => chalk.cyan(h)),
      style: { head: [], border: [] },
      colWidths: [10, 12, 14, msgW2],
      wordWrap: true,
    });

    for (const c of bw.commits) {
      commitTable.push([
        c.hash.slice(0, 8),
        c.timestamp.toISOString().slice(0, 10),
        `+${c.linesAdded} / -${c.linesRemoved}`,
        c.message,
      ]);
    }

    console.log(chalk.bold("Commits"));
    console.log(commitTable.toString());
  } else {
    console.log(chalk.dim("  No git commits found for this branch."));
  }

  if (warnings && warnings.length > 0) {
    console.log();
    for (const w of warnings) {
      console.log(chalk.yellow(`  ⚠ ${w}`));
    }
  }

  console.log();
}

export function renderWasteReport(signals: WasteSignal[], sessions: Session[], periodLabel: string): void {
  const totalSpend = sessions.reduce((s, x) => s + x.estimatedCostUSD, 0);
  const totalWaste = signals.reduce((s, x) => s + x.estimatedWastedCostUSD, 0);
  const wastePct = totalSpend > 0 ? ((totalWaste / totalSpend) * 100).toFixed(1) : "0.0";

  const byType = new Map<string, { cost: number; count: number }>();
  for (const sig of signals) {
    const entry = byType.get(sig.type) ?? { cost: 0, count: 0 };
    entry.cost += sig.estimatedWastedCostUSD;
    entry.count++;
    byType.set(sig.type, entry);
  }

  const topType = [...byType.entries()].sort((a, b) => b[1].cost - a[1].cost)[0];

  console.log();
  console.log(chalk.bold(`Burnlog Waste Report (${periodLabel})`));
  console.log(chalk.dim("═".repeat(60)));
  console.log(`  Total Spend:      ${chalk.bold.green(formatCurrency(totalSpend))}`);
  console.log(`  Estimated Waste:  ${chalk.bold.red(formatCurrency(totalWaste))} (${wastePct}%) ${chalk.red(renderBar(totalSpend > 0 ? totalWaste / totalSpend : 0, 15))}`);
  if (topType) {
    console.log(`  Top Waste Type:   ${humanizeWasteType(topType[0])} (${formatCurrency(topType[1].cost)})`);
  }
  console.log();

  if (signals.length === 0) {
    console.log(chalk.green("  No waste signals detected."));
    console.log();
    return;
  }

  const typeTable = new Table({
    head: ["Type", "Wasted", "Count", "% of Waste", ""].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  for (const [type, data] of [...byType.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
    const ratio = totalWaste > 0 ? data.cost / totalWaste : 0;
    const pct = (ratio * 100).toFixed(1);
    typeTable.push([humanizeWasteType(type), formatCurrency(data.cost), data.count.toString(), `${pct}%`, chalk.red(renderBar(ratio, 12))]);
  }

  console.log(chalk.bold("By Waste Type"));
  console.log(typeTable.toString());
  console.log();

  const sigTable = new Table({
    head: ["Session", "Type", "Wasted", "Description"].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
    colWidths: [10, 24, 10, 62],
    wordWrap: true,
  });

  for (const sig of signals.slice(0, 5)) {
    sigTable.push([
      sig.sessionId.slice(0, 8),
      humanizeWasteType(sig.type),
      formatCurrency(sig.estimatedWastedCostUSD),
      truncate(sig.description, 60),
    ]);
  }

  console.log(chalk.bold("Top Waste Signals"));
  console.log(sigTable.toString());
  console.log();

  console.log(chalk.bold("Tips"));
  const seenTypes = new Set<string>();
  for (const sig of signals) {
    if (seenTypes.has(sig.type)) continue;
    seenTypes.add(sig.type);
    console.log(`  ${chalk.yellow("!")} ${chalk.bold(humanizeWasteType(sig.type))}: ${sig.suggestion}`);
  }
  console.log();
}

export function renderBranchComparison(a: BranchWork | null, b: BranchWork | null, scoreA?: number, scoreB?: number): void {
  const nameA = a?.branchName || "(none)";
  const nameB = b?.branchName || "(none)";

  console.log();
  console.log(chalk.bold("Branch Comparison"));
  console.log(chalk.dim("═".repeat(60)));

  const metric = (label: string, valA: string, valB: string) => [chalk.bold(label), valA, valB];
  const lA = a ? a.commits.reduce((s, c) => s + c.linesAdded, 0) : 0;
  const lrA = a ? a.commits.reduce((s, c) => s + c.linesRemoved, 0) : 0;
  const lB = b ? b.commits.reduce((s, c) => s + c.linesAdded, 0) : 0;
  const lrB = b ? b.commits.reduce((s, c) => s + c.linesRemoved, 0) : 0;

  const table = new Table({
    head: ["", chalk.cyan(nameA.slice(0, 25)), chalk.cyan(nameB.slice(0, 25))],
    style: { head: [], border: [] },
    colWidths: [14, 26, 26],
  });

  table.push(metric("Sessions", String(a?.sessions.length ?? 0), String(b?.sessions.length ?? 0)));
  table.push(metric("Commits", String(a?.commits.length ?? 0), String(b?.commits.length ?? 0)));
  table.push(metric("Cost", a ? formatCurrency(a.totalCostUSD) : "—", b ? formatCurrency(b.totalCostUSD) : "—"));
  table.push(metric("Cost/Commit", a && a.commits.length > 0 ? formatCurrency(a.costPerCommit) : "—", b && b.commits.length > 0 ? formatCurrency(b.costPerCommit) : "—"));
  table.push(metric("Lines", lA + lrA > 0 ? `+${lA}/-${lrA}` : "—", lB + lrB > 0 ? `+${lB}/-${lrB}` : "—"));
  table.push(metric("Cost/Line", a && a.costPerLineChanged > 0 ? "$" + a.costPerLineChanged.toFixed(3) : "—", b && b.costPerLineChanged > 0 ? "$" + b.costPerLineChanged.toFixed(3) : "—"));
  table.push(metric("Waste", a ? `${Math.round(a.wasteRatio * 100)}%` : "—", b ? `${Math.round(b.wasteRatio * 100)}%` : "—"));
  if (scoreA !== undefined || scoreB !== undefined) {
    table.push(metric("Score", scoreA !== undefined ? `${scoreA}/100` : "—", scoreB !== undefined ? `${scoreB}/100` : "—"));
  }

  console.log(table.toString());
  console.log();
}

// ── Today Renderer ────────────────────────────────────────────────

export function renderToday(
  sessions: Session[],
  dateLabel: string,
  efficiency: EfficiencyResult,
  wasteSignals: WasteSignal[],
  totalCommits: number,
  yesterday?: { cost: number; score: number; wastePct: number },
): void {
  const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUSD, 0);
  const linesAdded = sessions.reduce((sum, s) => sum + s.linesAdded, 0);
  const linesRemoved = sessions.reduce((sum, s) => sum + s.linesRemoved, 0);
  const totalWaste = wasteSignals.reduce((sum, w) => sum + w.estimatedWastedCostUSD, 0);
  const wastePct = totalCost > 0 ? (totalWaste / totalCost) * 100 : 0;

  console.log();
  console.log(chalk.bold(`Burnlog Today (${dateLabel})`));
  console.log(chalk.dim("═".repeat(60)));
  console.log(
    `  Spent: ${chalk.bold.green(formatCurrency(totalCost))} (${sessions.length} sessions)` +
      `    Score: ${renderScoreGauge(efficiency.score, 15)}`,
  );
  console.log(
    `  Lines: +${linesAdded} / -${linesRemoved} (${totalCommits} commits)` +
      `  Waste: ${chalk.red(formatCurrency(totalWaste))} (${wastePct.toFixed(0)}%)`,
  );

  if (sessions.length > 0) {
    console.log();
    for (const s of sessions) {
      const time = s.startTime.toTimeString().slice(0, 5);
      const summary = truncate((s.summary || s.firstPrompt) || "—", 40);
      console.log(
        `  ${outcomeIcon(s.outcome)} ${chalk.dim(time)}  ${truncate(s.projectName, 12)}  ` +
          `${chalk.dim(truncate(s.gitBranch || "—", 18))}  ${formatCurrency(s.estimatedCostUSD)}  ` +
          `${chalk.dim(`"${summary}"`)}`,
      );
    }
  }

  if (yesterday) {
    console.log();
    const costDelta = yesterday.cost > 0 ? ((totalCost - yesterday.cost) / yesterday.cost) * 100 : 0;
    const scoreDelta = efficiency.score - yesterday.score;
    const wasteDelta = wastePct - yesterday.wastePct;

    const arrow = (val: number, invert = false) => {
      const isGood = invert ? val < 0 : val > 0;
      if (Math.abs(val) < 0.5) return chalk.gray("→");
      return isGood ? chalk.green("▼" + Math.abs(val).toFixed(0)) : chalk.red("▲" + Math.abs(val).toFixed(0));
    };

    console.log(
      `  vs Yesterday: Cost ${arrow(-costDelta, true)}%  Score ${arrow(scoreDelta)}pts  Waste ${arrow(-wasteDelta, true)}%`,
    );
  }

  console.log();
}

// ── Trends Renderer ───────────────────────────────────────────────

export interface WeekBucket {
  label: string;
  cost: number;
  sessions: number;
  score: number;
  wastePct: number;
  dailyValues: number[];
}

export function renderTrends(weeks: WeekBucket[], totalLabel: string): void {
  console.log();
  console.log(chalk.bold(`Burnlog Trends (${totalLabel})`));
  console.log(chalk.dim("═".repeat(60)));

  const table = new Table({
    head: ["Week", "Cost", "Sessions", "Score", "Waste", "Daily"].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
    colWidths: [16, 10, 10, 8, 8, 16],
  });

  for (const w of weeks) {
    table.push([
      w.label,
      formatCurrency(w.cost),
      w.sessions.toString(),
      `${w.score}`,
      `${w.wastePct.toFixed(0)}%`,
      renderSparkline(w.dailyValues),
    ]);
  }

  console.log(table.toString());

  // Trend arrows: compare first and last week
  if (weeks.length >= 2) {
    const current = weeks[weeks.length - 1];
    const prev = weeks[weeks.length - 2];
    const costDelta = prev.cost > 0 ? ((current.cost - prev.cost) / prev.cost) * 100 : 0;
    const scoreDelta = current.score - prev.score;
    const wasteDelta = current.wastePct - prev.wastePct;

    const trendStr = (val: number, suffix: string, invert = false) => {
      const isGood = invert ? val < 0 : val > 0;
      if (Math.abs(val) < 0.5) return chalk.gray(`→0${suffix}`);
      const arrow = val > 0 ? "▲" : "▼";
      const color = isGood ? chalk.green : chalk.red;
      return color(`${arrow}${Math.abs(val).toFixed(0)}${suffix}`);
    };

    console.log();
    console.log(
      `  Trends: Cost ${trendStr(costDelta, "%", true)}  |  ` +
        `Score ${trendStr(scoreDelta, "pts")}  |  ` +
        `Waste ${trendStr(wasteDelta, "%", true)}`,
    );
  }

  // Most expensive day of week
  const dayTotals: Record<string, { cost: number; count: number }> = {};
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (const w of weeks) {
    // dailyValues has 7 entries (Mon-Sun) — approximate day mapping
    for (let i = 0; i < w.dailyValues.length && i < 7; i++) {
      const dayName = dayNames[(i + 1) % 7]; // offset: index 0 = Monday
      const entry = dayTotals[dayName] ?? { cost: 0, count: 0 };
      if (w.dailyValues[i] > 0) {
        entry.cost += w.dailyValues[i];
        entry.count++;
      }
      dayTotals[dayName] = entry;
    }
  }
  const expensiveDay = Object.entries(dayTotals)
    .filter(([, d]) => d.count > 0)
    .map(([name, d]) => ({ name, avg: d.cost / d.count }))
    .sort((a, b) => b.avg - a.avg)[0];

  if (expensiveDay) {
    console.log(`  Most expensive day: ${expensiveDay.name} (${formatCurrency(expensiveDay.avg)} avg)`);
  }

  console.log();
}

// ── Budget Renderer ───────────────────────────────────────────────

export interface BudgetGauge {
  label: string;
  spent: number;
  limit: number;
}

export function renderBudgetStatus(
  gauges: BudgetGauge[],
  projection?: { monthly: number; limit: number; hitDate?: string },
): void {
  console.log();
  console.log(chalk.bold("Budget Status"));
  console.log(chalk.dim("═".repeat(60)));

  for (const g of gauges) {
    const ratio = g.limit > 0 ? g.spent / g.limit : 0;
    const pct = Math.round(ratio * 100);
    const color = ratio > 0.9 ? chalk.red : ratio > 0.7 ? chalk.yellow : chalk.green;
    console.log(
      `  ${g.label.padEnd(10)} ${formatCurrency(g.spent).padStart(8)} / ${formatCurrency(g.limit)}  ` +
        `${color(renderBar(ratio, 18))}  ${pct}%`,
    );
  }

  if (projection) {
    console.log();
    const within = projection.monthly <= projection.limit;
    const icon = within ? chalk.green("✓") : chalk.red("✗");
    console.log(`  Projected monthly: ${formatCurrency(projection.monthly)} ${icon} ${within ? "within budget" : "over budget"}`);
    if (!within && projection.hitDate) {
      console.log(`  At current pace, you'll hit the monthly limit on ${chalk.red(projection.hitDate)}`);
    }
  }

  console.log();
}
