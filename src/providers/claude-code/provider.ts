import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { AIToolProvider } from "../provider.interface.js";
import type {
  Project,
  Session,
  Exchange,
  ExchangeCategory,
  TokenUsage,
  SessionOutcome,
  Friction,
  JSONLActivityStats,
  RawSessionIndex,
  RawFacets,
  RawSessionMeta,
  RawJSONLMessage,
} from "../../data/models.js";
import { calculateCost } from "../../core/token-ledger.js";

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

      const indexPath = join(projectDir, "sessions-index.json");
      const indexData = await this.readJSON<RawSessionIndex>(indexPath);

      const originalPath = indexData?.originalPath ?? this.decodePath(encodedPath);
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
    const originalPath = indexData?.originalPath || this.decodePath(projectEncodedPath);

    // 1. Load sessions from index
    if (indexData) {
      for (const entry of indexData.entries) {
        const entryPath = indexData.originalPath || entry.projectPath || this.decodePath(projectEncodedPath);
        const session = await this.buildSession(entry, entryPath);
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

      // Build a minimal index entry from the JSONL + meta/facets
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

      const session = await this.buildSession(syntheticEntry, meta?.project_path || originalPath);
      if (session) sessions.push(session);
    }

    return sessions;
  }

  async loadAllSessions(): Promise<Session[]> {
    const projects = await this.listProjects();
    const allSessions: Session[] = [];

    for (const project of projects) {
      const sessions = await this.loadSessionsForProject(project.encodedPath);
      allSessions.push(...sessions);
    }

    return allSessions;
  }

  private async buildSession(
    entry: RawSessionIndex["entries"][0],
    originalPath: string,
  ): Promise<Session | null> {
    const facets = this.facetsCache?.get(entry.sessionId);
    const meta = this.metaCache?.get(entry.sessionId);

    // Parse exchanges from JSONL (source of truth for tokens, files, lines)
    const parseResult = await this.parseJSONL(entry.fullPath);
    const exchanges = parseResult.exchanges;
    const activity = parseResult.activity;

    // Calculate token usage: prefer JSONL exchange-level data, fallback to meta
    let tokenUsage: TokenUsage;
    let estimatedCostUSD: number;

    if (exchanges.length > 0) {
      tokenUsage = exchanges.reduce(
        (acc, ex) => ({
          inputTokens: acc.inputTokens + ex.tokenUsage.inputTokens,
          outputTokens: acc.outputTokens + ex.tokenUsage.outputTokens,
          cacheCreationTokens: acc.cacheCreationTokens + ex.tokenUsage.cacheCreationTokens,
          cacheReadTokens: acc.cacheReadTokens + ex.tokenUsage.cacheReadTokens,
        }),
        { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      );
      estimatedCostUSD = exchanges.reduce((sum, ex) => sum + ex.estimatedCostUSD, 0);
    } else if (meta) {
      tokenUsage = {
        inputTokens: meta.input_tokens,
        outputTokens: meta.output_tokens,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      estimatedCostUSD = 0; // can't calculate without model info
    } else {
      tokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      estimatedCostUSD = 0;
    }

    // Build frictions from facets
    const frictions: Friction[] = [];
    if (facets?.friction_counts) {
      for (const [type, count] of Object.entries(facets.friction_counts)) {
        frictions.push({ type, count, detail: facets.friction_detail || "" });
      }
    }

    const startTime = new Date(entry.created);
    const endTime = new Date(entry.modified);

    return {
      id: entry.sessionId,
      projectPath: originalPath,
      projectName: basename(originalPath),
      summary: entry.summary || facets?.brief_summary || "",
      firstPrompt: this.truncate(entry.firstPrompt, 120),
      gitBranch: entry.gitBranch || parseResult.gitBranch || "",
      startTime,
      endTime,
      durationMinutes: meta?.duration_minutes ?? Math.round((endTime.getTime() - startTime.getTime()) / 60000),
      messageCount: entry.messageCount,
      isSidechain: entry.isSidechain,

      tokenUsage,
      estimatedCostUSD,

      goal: facets?.underlying_goal || "",
      goalCategory: facets ? Object.keys(facets.goal_categories)[0] || "unknown" : "unknown",
      outcome: (facets?.outcome as SessionOutcome) || "unknown",
      helpfulness: facets?.claude_helpfulness || "unknown",
      sessionType: facets?.session_type || "unknown",
      frictions,

      toolCounts: meta?.tool_counts || {},
      languages: meta?.languages || {},
      // Prefer JSONL-derived activity stats (accurate across /compact boundaries)
      // Fallback to session-meta only when JSONL has no data
      linesAdded: activity.linesAdded > 0 ? activity.linesAdded : (meta?.lines_added || 0),
      linesRemoved: activity.linesRemoved > 0 ? activity.linesRemoved : (meta?.lines_removed || 0),
      filesModified: activity.filesModified.size > 0 ? activity.filesModified.size : (meta?.files_modified || 0),
      gitCommits: meta?.git_commits || 0,
      toolErrors: meta?.tool_errors || 0,
      userInterruptions: meta?.user_interruptions || 0,

      exchanges,
    };
  }

  private async parseJSONL(filePath: string): Promise<{
    exchanges: Exchange[];
    gitBranch: string;
    activity: JSONLActivityStats;
  }> {
    const content = await readFile(filePath, "utf-8").catch(() => "");
    if (!content) {
      return {
        exchanges: [],
        gitBranch: "",
        activity: { linesAdded: 0, linesRemoved: 0, filesModified: new Set(), filesRead: new Set(), editCount: 0, writeCount: 0 },
      };
    }

    const exchanges: Exchange[] = [];
    const lines = content.split("\n").filter(Boolean);

    let currentUserPrompt = "";
    let sequenceNumber = 0;
    let gitBranch = "";

    const activity: JSONLActivityStats = {
      linesAdded: 0,
      linesRemoved: 0,
      filesModified: new Set(),
      filesRead: new Set(),
      editCount: 0,
      writeCount: 0,
    };

    for (const line of lines) {
      let msg: RawJSONLMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      // Capture gitBranch from first message that has it
      if (!gitBranch && msg.gitBranch) {
        gitBranch = msg.gitBranch;
      }

      if (msg.type === "user") {
        // Extract user prompt text from various formats
        const rawContent = (msg as any).message?.content ?? msg.content;
        if (typeof rawContent === "string") {
          // Skip system/meta messages, keep actual user prompts
          if (!rawContent.startsWith("<local-command") && !rawContent.startsWith("<task-notification")) {
            currentUserPrompt = this.truncate(rawContent, 200);
          }
        } else if (Array.isArray(rawContent)) {
          const textParts = rawContent
            .filter((c: any) => c.type === "text" && c.text)
            .map((c: any) => c.text as string);
          currentUserPrompt = this.truncate(textParts.join(" "), 200);
        }
        continue;
      }

      if (msg.type === "assistant" && msg.message?.usage) {
        const usage = msg.message.usage;
        const model = msg.message.model || "unknown";
        const contentArr = Array.isArray(msg.message.content) ? msg.message.content : [];

        const toolsUsed: string[] = [];
        const filesRead: string[] = [];
        const filesModified: string[] = [];

        for (const block of contentArr) {
          if (block.type !== "tool_use" || !block.name) continue;
          toolsUsed.push(block.name);

          const input = block.input as Record<string, any> | undefined;
          if (!input) continue;

          const filePath = input.file_path || input.path || "";
          if (!filePath) continue;
          const fileName = typeof filePath === "string" ? filePath.split("/").pop() || filePath : "";

          switch (block.name) {
            case "Read":
              activity.filesRead.add(fileName);
              filesRead.push(fileName);
              break;
            case "Edit": {
              activity.filesModified.add(fileName);
              activity.editCount++;
              filesModified.push(fileName);
              // Calculate lines from old_string/new_string
              const oldStr = typeof input.old_string === "string" ? input.old_string : "";
              const newStr = typeof input.new_string === "string" ? input.new_string : "";
              const oldLines = oldStr ? oldStr.split("\n").length : 0;
              const newLines = newStr ? newStr.split("\n").length : 0;
              activity.linesAdded += Math.max(0, newLines - oldLines);
              activity.linesRemoved += Math.max(0, oldLines - newLines);
              break;
            }
            case "Write": {
              activity.filesModified.add(fileName);
              activity.writeCount++;
              filesModified.push(fileName);
              const writeContent = typeof input.content === "string" ? input.content : "";
              activity.linesAdded += writeContent ? writeContent.split("\n").length : 0;
              break;
            }
            case "Glob":
            case "Grep":
              // These don't have a single file_path
              break;
          }
        }

        const tokenUsage: TokenUsage = {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheCreationTokens: usage.cache_creation_input_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
        };

        const category = this.classifyExchange(toolsUsed, currentUserPrompt);

        exchanges.push({
          sequenceNumber: sequenceNumber++,
          userPrompt: currentUserPrompt,
          tokenUsage,
          estimatedCostUSD: calculateCost(tokenUsage, model),
          model,
          toolsUsed,
          filesRead,
          filesModified,
          timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
          category,
        });

        currentUserPrompt = "";
      }
    }

    return { exchanges, gitBranch, activity };
  }

  private classifyExchange(toolsUsed: string[], _prompt: string): ExchangeCategory {
    if (toolsUsed.length === 0) return "planning";

    const editTools = ["Edit", "Write", "NotebookEdit"];
    const readTools = ["Read", "Glob", "Grep"];

    const hasEdits = toolsUsed.some((t) => editTools.includes(t));
    const hasOnlyReads = toolsUsed.every((t) => readTools.includes(t) || t === "Bash" || t === "Agent");

    if (hasEdits) return "implementation";
    if (hasOnlyReads) return "exploration";

    return "implementation";
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

  private decodePath(encoded: string): string {
    return encoded.replace(/-/g, "/");
  }

  private truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.slice(0, max - 1) + "…";
  }
}
