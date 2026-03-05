export function parsePeriodDays(period: string): number {
  const match = period.match(/^(\d+)([dwm])$/);
  if (!match) {
    console.error(`Invalid period format: "${period}". Use a number followed by d (days), w (weeks), or m (months). Examples: 7d, 2w, 3m`);
    process.exit(1);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "w") return value * 7;
  if (unit === "m") return value * 30;
  return value;
}
