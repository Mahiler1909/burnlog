import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import type { AIToolProvider } from "../provider.interface.js";
import type { Project, Session, RawSessionIndex, RawFacets, RawSessionMeta } from "../../data/models.js";
import { resolveProjectPath } from "./path-resolver.js";
import { buildSession } from "./session-builder.js";

// Re-export for backward compatibility
export { classifyExchangeCategory } from "./exchange-classifier.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const FACETS_DIR = join(CLAUDE_DIR, "usage-data", "facets");
const SESSION_META_DIR = join(CLAUDE_DIR, "usage-data", "session-meta");

export class ClaudeCodeProvider implements AIToolProvider {
  readonly name = "claude-code";

  private facetsCache: Map<string, RawFacets> | null = null;
  private metaCache: Map<string, RawSessionMeta> | null = null;

  isAvailable(): boolean {
    try {
      return require("node:fs").existsSync(CLAUDE_DIR);
    } catch {
      return false;
    }
  }

  async listProjects(): Promise<Project[]> {
    const entries = await readdir(PROJECTS_DIR).catch(() => []);
    const projects: Project[] = [];

    for (const encodedPath of entries) {
      const projectDir = join(PROJECTS_DIR, encodedPath);
      const s = await stat(projectDir).catch(() => null);
      if (!s?.isDirectory()) continue;

      await this.ensureCaches();
      const originalPath = await resolveProjectPath(encodedPath, projectDir, this.metaCache);
      projects.push({
        id: encodedPath,
        path: originalPath,
        name: basename(originalPath),
        encodedPath,
        sessions: [],
      });
    }

    return projects;
  }

  async loadSessionsForProject(projectEncodedPath: string): Promise<Session[]> {
    const projectDir = join(PROJECTS_DIR, projectEncodedPath);
    const indexPath = join(projectDir, "sessions-index.json");
    const indexData = await this.readJSON<RawSessionIndex>(indexPath);

    await this.ensureCaches();

    const sessions: Session[] = [];
    const indexedSessionIds = new Set<string>();
    const originalPath = await resolveProjectPath(projectEncodedPath, projectDir, this.metaCache);

    // 1. Load sessions from index
    if (indexData) {
      for (const entry of indexData.entries) {
        const entryPath = indexData.originalPath || entry.projectPath || originalPath;
        const facets = this.facetsCache?.get(entry.sessionId);
        const meta = this.metaCache?.get(entry.sessionId);
        const session = await buildSession(entry, entryPath, facets, meta);
        if (session) sessions.push(session);
        indexedSessionIds.add(entry.sessionId);
      }
    }

    // 2. Discover orphaned JSONL files not in the index
    const files = await readdir(projectDir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const sessionId = file.replace(".jsonl", "");
      if (indexedSessionIds.has(sessionId)) continue;

      const fullPath = join(projectDir, file);
      const meta = this.metaCache?.get(sessionId);
      const facets = this.facetsCache?.get(sessionId);
      const fileStat = await stat(fullPath).catch(() => null);

      const syntheticEntry: RawSessionIndex["entries"][0] = {
        sessionId,
        fullPath,
        fileMtime: fileStat?.mtimeMs ?? 0,
        firstPrompt: meta?.first_prompt || facets?.brief_summary || "",
        summary: facets?.brief_summary || "",
        messageCount: (meta?.user_message_count ?? 0) + (meta?.assistant_message_count ?? 0),
        created: meta?.start_time || fileStat?.birthtime?.toISOString() || new Date().toISOString(),
        modified: fileStat?.mtime?.toISOString() || new Date().toISOString(),
        gitBranch: "",
        projectPath: meta?.project_path || originalPath,
        isSidechain: false,
      };

      const session = await buildSession(syntheticEntry, meta?.project_path || originalPath, facets, meta);
      if (session) sessions.push(session);
    }

    // Filter out empty/ghost sessions
    return sessions.filter((s) => {
      if (s.exchanges.length > 0) return true;
      return s.messageCount > 0 && s.estimatedCostUSD > 0;
    });
  }

  async loadAllSessions(): Promise<Session[]> {
    const projects = await this.listProjects();
    const allSessions: Session[] = [];

    for (const project of projects) {
      const sessions = await this.loadSessionsForProject(project.encodedPath);
      allSessions.push(...sessions);
    }

    this.resolveHeadBranches(allSessions);
    return allSessions;
  }

  private resolveHeadBranches(sessions: Session[]): void {
    const headSessions = sessions.filter((s) => s.gitBranch === "HEAD");
    if (headSessions.length === 0) return;

    const branchByPath = new Map<string, string>();
    for (const s of headSessions) {
      if (branchByPath.has(s.projectPath)) {
        s.gitBranch = branchByPath.get(s.projectPath)!;
        continue;
      }
      try {
        const branch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: s.projectPath,
          timeout: 5000,
          encoding: "utf-8",
        }).trim();
        if (branch && branch !== "HEAD") {
          branchByPath.set(s.projectPath, branch);
          s.gitBranch = branch;
        }
      } catch {
        // Not a git repo or path doesn't exist
      }
    }
  }

  private async ensureCaches(): Promise<void> {
    if (!this.facetsCache) {
      this.facetsCache = new Map();
      const files = await readdir(FACETS_DIR).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const data = await this.readJSON<RawFacets>(join(FACETS_DIR, file));
        if (data?.session_id) this.facetsCache.set(data.session_id, data);
      }
    }

    if (!this.metaCache) {
      this.metaCache = new Map();
      const files = await readdir(SESSION_META_DIR).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const data = await this.readJSON<RawSessionMeta>(join(SESSION_META_DIR, file));
        if (data?.session_id) this.metaCache.set(data.session_id, data);
      }
    }
  }

  private async readJSON<T>(path: string): Promise<T | null> {
    try {
      const content = await readFile(path, "utf-8");
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }
}
