import chalk from "chalk";
import type { Session } from "../../data/models.js";

// ── Visual Primitives ──────────────────────────────────────────────

const BAR_BLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Render a horizontal bar chart from a 0–1 ratio.
 * Uses 1/8-block Unicode characters for sub-character precision.
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
      if (range === 0) return SPARK_CHARS[3];
      const normalized = (v - min) / range;
      const idx = Math.min(7, Math.round(normalized * 7));
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

// ── Text Helpers ──────────────────────────────────────────────────

export function humanizeType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function cleanPromptForDisplay(raw: string): string {
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

export function wrapIndented(text: string, indent: number): string {
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
