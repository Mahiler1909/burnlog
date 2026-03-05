import type { Session } from "../data/models.js";
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
