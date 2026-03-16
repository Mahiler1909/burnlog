#!/usr/bin/env node

import { Command, InvalidArgumentError, Option } from "commander";
import { reportCommand } from "./cli/commands/report.js";
import { sessionsCommand } from "./cli/commands/sessions.js";
import { sessionCommand } from "./cli/commands/session.js";
import { branchCommand } from "./cli/commands/branch.js";
import { wasteCommand } from "./cli/commands/waste.js";
import { compareCommand } from "./cli/commands/compare.js";
import { todayCommand } from "./cli/commands/today.js";
import { budgetCommand, budgetSetCommand } from "./cli/commands/budget.js";
import { trendsCommand } from "./cli/commands/trends.js";

const program = new Command();

program
  .name("burnlog")
  .description("Correlate AI token usage with real development work")
  .version("0.2.0");

function addFormatOption(cmd: Command): Command {
  return cmd.addOption(
    new Option("-f, --format <format>", "Output format")
      .choices(["table", "json", "csv"])
      .default("table"),
  );
}

addFormatOption(
  program
    .command("report", { isDefault: true })
    .description("Token spend dashboard: where did my tokens go?")
    .option("-p, --period <period>", "Time period (e.g., 7d, 30d, 90d)", "30d")
    .option("--project <path>", "Filter by project name or path"),
).action(reportCommand);

addFormatOption(
  program
    .command("sessions")
    .description("List all sessions with cost and outcome")
    .option("--project <path>", "Filter by project name or path")
    .option("-p, --period <period>", "Time period (e.g., 7d, 30d, 90d)")
    .addOption(new Option("-s, --sort <field>", "Sort by").choices(["date", "cost", "tokens"]).default("date"))
    .option("-l, --limit <n>", "Max sessions to show", (v: string) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n <= 0) throw new InvalidArgumentError("Must be a positive integer.");
      return n;
    }, 20)
    .option("-a, --all", "Show all sessions (no limit)"),
).action(sessionsCommand);

addFormatOption(
  program
    .command("session <id>")
    .description("Deep dive into a single session"),
).action(sessionCommand);

addFormatOption(
  program
    .command("branch <name>")
    .description("Cost breakdown for a feature branch")
    .option("--project <path>", "Filter by project name or path"),
).action(branchCommand);

addFormatOption(
  program
    .command("waste")
    .description("Detect wasted token spend with actionable tips")
    .option("-p, --period <period>", "Time period (e.g., 7d, 30d, 90d)", "30d")
    .option("--project <path>", "Filter by project name or path"),
).action(wasteCommand);

addFormatOption(
  program
    .command("compare <branchA> <branchB>")
    .description("Compare efficiency between two branches (use --project for multi-project)")
    .option("--project <path>", "Filter by project name or path"),
).action(compareCommand);

// ── New v0.2.0 commands ──────────────────────────────────────────

addFormatOption(
  program
    .command("today")
    .description("Quick summary of today's token spend and efficiency"),
).action(todayCommand);

const budgetCmd = program
  .command("budget")
  .description("Track spending against daily/weekly/monthly budget limits");

addFormatOption(budgetCmd).action(budgetCommand);

budgetCmd
  .command("set")
  .description("Set budget limits")
  .option("--daily <amount>", "Daily budget in USD")
  .option("--weekly <amount>", "Weekly budget in USD")
  .option("--monthly <amount>", "Monthly budget in USD")
  .action(budgetSetCommand);

addFormatOption(
  program
    .command("trends")
    .description("Multi-week trend analysis of cost and efficiency")
    .option("-w, --weeks <n>", "Number of weeks to analyze", "4"),
).action(trendsCommand);

program.parse();
