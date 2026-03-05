import type { Session } from "../data/models.js";
import { ClaudeCodeProvider } from "../providers/claude-code/provider.js";
import { parsePeriodDays } from "./period.js";

export function filterByProject(sessions: Session[], project?: string): Session[] {
  if (!project) return sessions;
  const filter = project.toLowerCase();
  return sessions.filter(
    (s) =>
      s.projectName.toLowerCase().includes(filter) ||
      s.projectPath.toLowerCase().includes(filter),
  );
}

export function filterByPeriod(sessions: Session[], period?: string): Session[] {
  if (!period) return sessions;
  const days = parsePeriodDays(period);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return sessions.filter((s) => s.startTime >= cutoff);
}

export async function loadAndFilterSessions(options: {
  period?: string;
  project?: string;
}): Promise<Session[]> {
  const provider = new ClaudeCodeProvider();
  let sessions = await provider.loadAllSessions();
  sessions = filterByPeriod(sessions, options.period || "30d");
  sessions = filterByProject(sessions, options.project);
  return sessions;
}
