#!/usr/bin/env node

import { Command } from "commander";
import { reportCommand } from "./cli/commands/report.js";
import { sessionsCommand } from "./cli/commands/sessions.js";
import { sessionCommand } from "./cli/commands/session.js";
import { branchCommand } from "./cli/commands/branch.js";
import { wasteCommand } from "./cli/commands/waste.js";
import { compareCommand } from "./cli/commands/compare.js";

const program = new Command();

program
  .name("burnlog")
  .description("Correlate AI token usage with real development work")
  .version("0.1.0");

program
  .command("report")
  .description("Token spend dashboard: where did my tokens go?")
  .option("-p, --period <period>", "Time period (e.g., 7d, 30d, 90d)", "30d")
  .option("--project <path>", "Filter by project name or path")
  .action(reportCommand);

program
  .command("sessions")
  .description("List all sessions with cost and outcome")
  .option("--project <path>", "Filter by project name or path")
  .option("-s, --sort <field>", "Sort by: date, cost, tokens", "date")
  .option("-l, --limit <n>", "Max sessions to show", "20")
  .action(sessionsCommand);

program
  .command("session <id>")
  .description("Deep dive into a single session")
  .action(sessionCommand);

program
  .command("branch <name>")
  .description("Cost breakdown for a feature branch")
  .option("--project <path>", "Filter by project name or path")
  .action(branchCommand);

program
  .command("waste")
  .description("Detect wasted token spend with actionable tips")
  .option("-p, --period <period>", "Time period (e.g., 7d, 30d, 90d)", "30d")
  .option("--project <path>", "Filter by project name or path")
  .action(wasteCommand);

program
  .command("compare <branchA> <branchB>")
  .description("Compare efficiency between two branches")
  .action(compareCommand);

program.parse();
