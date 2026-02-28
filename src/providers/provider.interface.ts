import type { Session, Project } from "../data/models.js";

export interface AIToolProvider {
  readonly name: string;

  isAvailable(): boolean;
  listProjects(): Promise<Project[]>;
  loadSessionsForProject(projectEncodedPath: string): Promise<Session[]>;
  loadAllSessions(): Promise<Session[]>;
}
