import chalk from "chalk";
import Table from "cli-table3";
import type { Session, CostBreakdown } from "../../data/models.js";
import { totalTokens } from "../../core/token-ledger.js";
import { getModelDisplayName } from "../../utils/pricing-tables.js";

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function outcomeIcon(outcome: string): string {
  switch (outcome) {
    case "fully_achieved":
      return chalk.green("OK");
    case "mostly_achieved":
      return chalk.green("MOSTLY");
    case "partially_achieved":
      return chalk.yellow("PARTIAL");
    case "not_achieved":
      return chalk.red("FAIL");
    default:
      return chalk.gray("—");
  }
}

export function renderReportHeader(sessions: Session[], periodLabel: string): void {
  const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUSD, 0);
  const totalSessions = sessions.length;
  const projects = new Set(sessions.map((s) => s.projectName)).size;
  const totalCommits = sessions.reduce((sum, s) => sum + s.gitCommits, 0);

  console.log();
  console.log(chalk.bold(`Burnlog Report (${periodLabel})`));
  console.log(chalk.dim("═".repeat(60)));
  console.log(
    `Total: ${chalk.bold.green(formatCurrency(totalCost))}  |  ` +
      `${totalSessions} sessions  |  ` +
      `${projects} projects  |  ` +
      `${totalCommits} commits`,
  );
  console.log();
}

export function renderByProject(sessions: Session[]): void {
  const grouped = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = grouped.get(s.projectName) ?? [];
    list.push(s);
    grouped.set(s.projectName, list);
  }

  const table = new Table({
    head: ["Project", "Cost", "Sessions", "Commits", "Lines +/-", "Outcome"].map((h) =>
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
    const commits = projectSessions.reduce((s, x) => s + x.gitCommits, 0);
    const linesAdded = projectSessions.reduce((s, x) => s + x.linesAdded, 0);
    const linesRemoved = projectSessions.reduce((s, x) => s + x.linesRemoved, 0);
    const achieved = projectSessions.filter((x) => x.outcome === "fully_achieved").length;

    table.push([
      name,
      formatCurrency(cost),
      projectSessions.length.toString(),
      commits.toString(),
      `+${linesAdded} / -${linesRemoved}`,
      `${achieved}/${projectSessions.length}`,
    ]);
  }

  console.log(chalk.bold("By Project"));
  console.log(table.toString());
  console.log();
}

export function renderByModel(breakdown: CostBreakdown): void {
  const table = new Table({
    head: ["Model", "Cost", "% Total"].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  const total = Object.values(breakdown.byModel).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(breakdown.byModel)
    .filter(([, cost]) => cost > 0.001)
    .sort((a, b) => b[1] - a[1]);

  for (const [model, cost] of sorted) {
    const pct = total > 0 ? ((cost / total) * 100).toFixed(1) : "0.0";
    table.push([getModelDisplayName(model), formatCurrency(cost), `${pct}%`]);
  }

  console.log(chalk.bold("By Model"));
  console.log(table.toString());
  console.log();
}

export function renderByCategory(breakdown: CostBreakdown): void {
  const table = new Table({
    head: ["Category", "Cost", "% Total"].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  const total = Object.values(breakdown.byCategory).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(breakdown.byCategory)
    .filter(([, cost]) => cost > 0.001)
    .sort((a, b) => b[1] - a[1]);

  for (const [cat, cost] of sorted) {
    const pct = total > 0 ? ((cost / total) * 100).toFixed(1) : "0.0";
    table.push([cat, formatCurrency(cost), `${pct}%`]);
  }

  console.log(chalk.bold("By Goal Category"));
  console.log(table.toString());
  console.log();
}

export function renderByOutcome(breakdown: CostBreakdown): void {
  const table = new Table({
    head: ["Outcome", "Cost", "% Total"].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  const total = Object.values(breakdown.byOutcome).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(breakdown.byOutcome)
    .filter(([, cost]) => cost > 0.001)
    .sort((a, b) => b[1] - a[1]);

  for (const [outcome, cost] of sorted) {
    const pct = total > 0 ? ((cost / total) * 100).toFixed(1) : "0.0";
    table.push([outcomeIcon(outcome) + " " + outcome, formatCurrency(cost), `${pct}%`]);
  }

  console.log(chalk.bold("By Outcome"));
  console.log(table.toString());
  console.log();
}

export function renderSessionsList(sessions: Session[]): void {
  const table = new Table({
    head: ["ID", "Date", "Project", "Branch", "Cost", "Tokens", "Outcome", "Summary"].map((h) =>
      chalk.cyan(h),
    ),
    style: { head: [], border: [] },
    colWidths: [10, 12, 20, 16, 8, 10, 10, 36],
    wordWrap: true,
  });

  for (const s of sessions) {
    table.push([
      s.id.slice(0, 8),
      s.startTime.toISOString().slice(0, 10),
      s.projectName.slice(0, 18),
      (s.gitBranch || "—").slice(0, 14),
      s.estimatedCostUSD > 0 ? formatCurrency(s.estimatedCostUSD) : chalk.dim("n/a"),
      totalTokens(s.tokenUsage) > 0 ? formatTokens(totalTokens(s.tokenUsage)) : chalk.dim("n/a"),
      outcomeIcon(s.outcome),
      (s.summary || s.firstPrompt).slice(0, 34),
    ]);
  }

  console.log(table.toString());
}

export function renderSessionDetail(session: Session): void {
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
  console.log(`Goal:       ${session.goal || "—"}`);
  console.log(`Category:   ${session.goalCategory}`);
  console.log(`Type:       ${session.sessionType}`);
  console.log();

  // Activity
  console.log(chalk.bold("Activity"));
  console.log(`  Lines:     +${session.linesAdded} / -${session.linesRemoved}`);
  console.log(`  Files:     ${session.filesModified} modified`);
  console.log(`  Commits:   ${session.gitCommits}`);
  console.log(`  Errors:    ${session.toolErrors}`);
  console.log(`  Interrups: ${session.userInterruptions}`);

  if (Object.keys(session.toolCounts).length > 0) {
    console.log(`  Tools:     ${Object.entries(session.toolCounts).map(([k, v]) => `${k}:${v}`).join(", ")}`);
  }
  if (Object.keys(session.languages).length > 0) {
    console.log(`  Languages: ${Object.entries(session.languages).map(([k, v]) => `${k}:${v}`).join(", ")}`);
  }

  // Files modified (derived from exchanges)
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

  // Tokens
  console.log();
  console.log(chalk.bold("Token Usage"));
  console.log(`  Input:        ${formatTokens(session.tokenUsage.inputTokens)}`);
  console.log(`  Output:       ${formatTokens(session.tokenUsage.outputTokens)}`);
  console.log(`  Cache Write:  ${formatTokens(session.tokenUsage.cacheCreationTokens)}`);
  console.log(`  Cache Read:   ${formatTokens(session.tokenUsage.cacheReadTokens)}`);
  console.log(`  Total:        ${formatTokens(totalTokens(session.tokenUsage))}`);

  // Exchanges
  if (session.exchanges.length > 0) {
    console.log();
    console.log(chalk.bold(`Exchanges (${session.exchanges.length})`));

    const exTable = new Table({
      head: ["#", "Cost", "Model", "Category", "Tools", "Prompt"].map((h) => chalk.cyan(h)),
      style: { head: [], border: [] },
      colWidths: [4, 8, 12, 16, 20, 40],
      wordWrap: true,
    });

    for (const ex of session.exchanges) {
      exTable.push([
        ex.sequenceNumber.toString(),
        formatCurrency(ex.estimatedCostUSD),
        getModelDisplayName(ex.model),
        ex.category,
        ex.toolsUsed.slice(0, 3).join(", ") || "—",
        ex.userPrompt.slice(0, 38) || "—",
      ]);
    }

    console.log(exTable.toString());
  }

  console.log();
}
