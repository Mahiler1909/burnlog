import chalk from "chalk";
import Table from "cli-table3";
import type { Session, CostBreakdown, BranchWork, WasteSignal, GitCommit } from "../../data/models.js";
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

export function renderReportHeader(sessions: Session[], periodLabel: string, commitsByProject?: Map<string, number>): void {
  const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUSD, 0);
  const totalSessions = sessions.length;
  const projects = new Set(sessions.map((s) => s.projectName)).size;
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
  const termWidth = process.stdout.columns || 120;
  // Fixed columns: ID(10) + Date(12) + Cost(10) + Tokens(10) + Outcome(9) + borders(~25) = ~76
  const fixedWidth = 76;
  const flexWidth = Math.max(termWidth - fixedWidth, 60);
  // Distribute flex space: project 18%, branch 35%, summary 47%
  const projectW = Math.max(Math.floor(flexWidth * 0.18), 14);
  const branchW = Math.max(Math.floor(flexWidth * 0.35), 20);
  const summaryW = Math.max(flexWidth - projectW - branchW, 20);

  const table = new Table({
    head: ["ID", "Date", "Project", "Branch", "Cost", "Tokens", "Outcome", "Summary"].map((h) =>
      chalk.cyan(h),
    ),
    style: { head: [], border: [] },
    colWidths: [10, 12, projectW, branchW, 10, 10, 9, summaryW],
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

function humanizeWasteType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function cleanPromptForDisplay(raw: string): string {
  if (!raw || raw.length < 80) return raw;

  // 1. Strip XML-like tags and their content
  let text = raw.replace(/<(bash-stdout|bash-stderr|task-notification|system-reminder|command-name|command-message|local-command-stdout)[^>]*>[\s\S]*?<\/\1>/gi, (_match, tag) => {
    return chalk.dim(`[${tag} collapsed]`);
  });

  // 2. Collapse consecutive "noise" lines (paths, errors, indented output, table borders)
  const lines = text.split("\n");
  const result: string[] = [];
  let noiseBuffer: string[] = [];

  const isNoise = (line: string): boolean => {
    const t = line.trim();
    if (!t) return noiseBuffer.length > 0; // blank line is noise only if inside a noise block
    return (
      /^[│├└┌┬┼─╰╭╮╯┐┤┴╰╮]+/.test(t) ||
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
    // Simplify MCP tool names and sort by count
    const simplified = Object.entries(session.toolCounts)
      .map(([k, v]) => {
        const name = k
          .replace(/^mcp__claude-in-chrome__/, "chrome:")
          .replace(/^mcp__atlassian__/, "jira:")
          .replace(/^mcp__figma__/, "figma:")
          .replace(/^mcp__jetbrains__/, "jetbrains:")
          .replace(/^mcp__/, "mcp:");
        return [name, v] as [string, number];
      })
      .sort((a, b) => b[1] - a[1]);
    console.log(`  Tools:     ${simplified.map(([k, v]) => `${k}:${v}`).join(", ")}`);
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

  // Exchanges
  if (session.exchanges.length > 0) {
    console.log();
    console.log(chalk.bold(`Exchanges (${session.exchanges.length})`));
    const indent = 14;

    for (const ex of session.exchanges) {
      console.log();
      console.log(chalk.dim(`  ─── #${ex.sequenceNumber} ───`));
      console.log(`  Cost:       ${formatCurrency(ex.estimatedCostUSD)}`);
      console.log(`  Model:      ${getModelDisplayName(ex.model)}`);
      console.log(`  Category:   ${ex.category}`);
      console.log(`  Tools:      ${ex.toolsUsed.join(", ") || "—"}`);
      console.log(`  Prompt:     ${wrapIndented(cleanPromptForDisplay(ex.userPrompt || "—"), indent)}`);
    }
  }

  console.log();
}

export function renderBranchDetail(bw: BranchWork, warnings?: string[]): void {
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
  console.log();

  // Sessions table
  const sessTable = new Table({
    head: ["ID", "Date", "Cost", "Outcome", "Summary"].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
    colWidths: [10, 12, 10, 10, 40],
    wordWrap: true,
  });

  for (const s of bw.sessions) {
    sessTable.push([
      s.id.slice(0, 8),
      s.startTime.toISOString().slice(0, 10),
      formatCurrency(s.estimatedCostUSD),
      outcomeIcon(s.outcome),
      (s.summary || s.firstPrompt).slice(0, 38),
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
  console.log(`  Estimated Waste:  ${chalk.bold.red(formatCurrency(totalWaste))} (${wastePct}%)`);
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
    head: ["Type", "Wasted", "Count", "% of Waste"].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  for (const [type, data] of [...byType.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
    const pct = totalWaste > 0 ? ((data.cost / totalWaste) * 100).toFixed(1) : "0.0";
    typeTable.push([humanizeWasteType(type), formatCurrency(data.cost), data.count.toString(), `${pct}%`]);
  }

  console.log(chalk.bold("By Waste Type"));
  console.log(typeTable.toString());
  console.log();

  const sigTable = new Table({
    head: ["Session", "Type", "Wasted", "Description"].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
    colWidths: [10, 24, 10, 40],
    wordWrap: true,
  });

  for (const sig of signals.slice(0, 5)) {
    sigTable.push([
      sig.sessionId.slice(0, 8),
      humanizeWasteType(sig.type),
      formatCurrency(sig.estimatedWastedCostUSD),
      sig.description.slice(0, 38),
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

export function renderBranchComparison(a: BranchWork | null, b: BranchWork | null): void {
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

  console.log(table.toString());
  console.log();
}
