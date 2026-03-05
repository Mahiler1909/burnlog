import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
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

const EDIT_TOOLS = ["Edit", "Write", "NotebookEdit"];
const READ_TOOLS = ["Read", "Glob", "Grep"];
const META_TOOLS = [
  "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskOutput",
  "AskUserQuestion", "ExitPlanMode", "EnterPlanMode", "EnterWorktree",
];

function isReadOnlyMCP(t: string): boolean {
  if (!t.startsWith("mcp__")) return false;
  const toolName = t.replace(/^mcp__[^_]+__/, "");
  return /^(get|list|read|search|find|tabs|context)/.test(toolName);
}

export function classifyExchangeCategory(toolsUsed: string[]): ExchangeCategory {
  if (toolsUsed.length === 0) return "planning";

  const actionTools = toolsUsed.filter((t) => !META_TOOLS.includes(t));
  if (actionTools.length === 0) return "planning";

  const hasEdits = actionTools.some((t) => EDIT_TOOLS.includes(t));

  const isExploration = actionTools.every((t) =>
    READ_TOOLS.includes(t) ||
    t === "Bash" ||
    t === "Agent" ||
    t === "WebSearch" ||
    t === "WebFetch" ||
    isReadOnlyMCP(t),
  );

  if (hasEdits) return "implementation";
  if (isExploration) return "exploration";

  const hasBrowserActions = actionTools.some((t) => {
    if (!t.startsWith("mcp__")) return false;
    const toolName = t.replace(/^mcp__[^_]+__/, "");
    return /^(computer|navigate|form|click|type|input|submit)/.test(toolName);
  });
  if (hasBrowserActions) return "debugging";

  return "implementation";
}

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

      const originalPath = await this.resolveProjectPath(encodedPath);
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
    const originalPath = await this.resolveProjectPath(projectEncodedPath);

    // 1. Load sessions from index
    if (indexData) {
      for (const entry of indexData.entries) {
        const entryPath = indexData.originalPath || entry.projectPath || originalPath;
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

    // Filter out empty/ghost sessions:
    // - No exchanges AND no messages = deleted JSONL
    // - Has messageCount but 0 cost and no exchanges = opened and closed without use
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

    // Resolve "HEAD" branch names to actual branch for display
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
        // Not a git repo or path doesn't exist — leave as "HEAD"
      }
    }
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
      summary: entry.summary || facets?.brief_summary || this.inferSummary(exchanges),
      firstPrompt: entry.firstPrompt,
      gitBranch: entry.gitBranch || parseResult.gitBranch || "",
      startTime,
      endTime,
      durationMinutes: meta?.duration_minutes ?? Math.round((endTime.getTime() - startTime.getTime()) / 60000),
      messageCount: entry.messageCount || exchanges.length * 2,
      isSidechain: entry.isSidechain,

      tokenUsage,
      estimatedCostUSD,

      goal: facets?.underlying_goal || this.inferGoal(exchanges, parseResult.firstRawPrompt),
      goalCategory: facets ? Object.keys(facets.goal_categories)[0] || "unknown" : this.inferGoalCategory(exchanges),
      outcome: (facets?.outcome as SessionOutcome) || this.inferOutcome(exchanges, activity, meta),
      helpfulness: facets?.claude_helpfulness || "unknown",
      sessionType: facets?.session_type || "unknown",
      frictions,

      // Prefer JSONL-derived tool counts (session-meta undercounts after /compact)
      toolCounts: Object.keys(activity.toolCounts).length > 0 ? activity.toolCounts : (meta?.tool_counts || {}),
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
    firstRawPrompt: string;
  }> {
    const content = await readFile(filePath, "utf-8").catch(() => "");
    if (!content) {
      return {
        exchanges: [],
        gitBranch: "",
        activity: { linesAdded: 0, linesRemoved: 0, filesModified: new Set(), filesRead: new Set(), editCount: 0, writeCount: 0, toolCounts: {} },
        firstRawPrompt: "",
      };
    }

    const exchanges: Exchange[] = [];
    const lines = content.split("\n").filter(Boolean);

    let currentUserPrompt = "";
    let firstRawPrompt = "";
    let sequenceNumber = 0;
    let gitBranch = "";

    const activity: JSONLActivityStats = {
      linesAdded: 0,
      linesRemoved: 0,
      filesModified: new Set(),
      filesRead: new Set(),
      editCount: 0,
      writeCount: 0,
      toolCounts: {},
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

      // Skip non-conversation messages
      if (msg.type === "system" || msg.type === "summary" || msg.type === "file-history-snapshot" || msg.type === "progress") {
        continue;
      }

      if (msg.type === "user") {
        // Skip synthetic/meta messages that are not real user prompts
        if (msg.isCompactSummary || msg.isMeta) continue;

        // Extract user prompt text from various formats
        const rawContent = (msg as any).message?.content ?? msg.content;
        if (typeof rawContent === "string") {
          // Skip system/command/output messages, keep actual user prompts
          if (
            rawContent.startsWith("<local-command") ||
            rawContent.startsWith("<task-notification") ||
            rawContent.startsWith("<command-name>")
          ) {
            continue;
          }
          currentUserPrompt = rawContent;
          if (!firstRawPrompt && rawContent.length > 10) firstRawPrompt = rawContent.split(/[\n\r]/)[0].trim();
        } else if (Array.isArray(rawContent)) {
          const textParts = rawContent
            .filter((c: any) => c.type === "text" && c.text)
            .map((c: any) => c.text as string);
          const joined = textParts.join(" ");
          currentUserPrompt = joined;
          if (!firstRawPrompt && joined.length > 10) firstRawPrompt = joined.split(/[\n\r]/)[0].trim();
        }
        continue;
      }

      if (msg.type === "assistant" && msg.message?.usage) {
        const usage = msg.message.usage;
        const model = msg.message.model || "unknown";

        // Skip synthetic/summary messages (context compression, not real exchanges)
        if (model.startsWith("<synthetic>") || msg.type === "summary" as any) continue;
        const contentArr = Array.isArray(msg.message.content) ? msg.message.content : [];

        const toolsUsed: string[] = [];
        const filesRead: string[] = [];
        const filesModified: string[] = [];

        for (const block of contentArr) {
          if (block.type !== "tool_use" || !block.name) continue;
          toolsUsed.push(block.name);
          activity.toolCounts[block.name] = (activity.toolCounts[block.name] || 0) + 1;

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

        // If no new user prompt, this is a tool_result continuation of the previous exchange.
        // Merge tokens, tools, files into the previous exchange instead of creating a new one.
        if (!currentUserPrompt && exchanges.length > 0) {
          const prev = exchanges[exchanges.length - 1];
          prev.tokenUsage.inputTokens += tokenUsage.inputTokens;
          prev.tokenUsage.outputTokens += tokenUsage.outputTokens;
          prev.tokenUsage.cacheCreationTokens += tokenUsage.cacheCreationTokens;
          prev.tokenUsage.cacheReadTokens += tokenUsage.cacheReadTokens;
          prev.estimatedCostUSD += calculateCost(tokenUsage, model);
          for (const t of toolsUsed) {
            if (!prev.toolsUsed.includes(t)) prev.toolsUsed.push(t);
          }
          for (const f of filesRead) {
            if (!prev.filesRead.includes(f)) prev.filesRead.push(f);
          }
          for (const f of filesModified) {
            if (!prev.filesModified.includes(f)) prev.filesModified.push(f);
          }
          // Re-classify with merged tool list
          prev.category = this.classifyExchange(prev.toolsUsed, prev.userPrompt);
          continue;
        }

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

    return { exchanges, gitBranch, activity, firstRawPrompt };
  }

  private classifyExchange(toolsUsed: string[], _prompt: string): ExchangeCategory {
    return classifyExchangeCategory(toolsUsed);
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

  /**
   * Resolve the real project path from an encoded directory name.
   * Strategy: check session-meta and JSONL for actual paths, fallback to
   * filesystem probing, then encoded path as last resort.
   */
  private async resolveProjectPath(encodedPath: string): Promise<string> {
    const projectDir = join(PROJECTS_DIR, encodedPath);

    // 1. Check sessions-index originalPath
    const indexPath = join(projectDir, "sessions-index.json");
    const indexData = await this.readJSON<RawSessionIndex>(indexPath);
    if (indexData?.originalPath) return indexData.originalPath;

    // 2. Check session-meta for any session in this project
    await this.ensureCaches();
    if (this.metaCache) {
      for (const meta of this.metaCache.values()) {
        if (meta.project_path) {
          // Match by checking if the encoded path corresponds to this meta path
          const metaEncoded = meta.project_path.replace(/\//g, "-").replace(/^-/, "-");
          if (encodedPath === metaEncoded || meta.project_path.endsWith(this.lastPathSegments(encodedPath))) {
            return meta.project_path;
          }
        }
      }
    }

    // 3. Check first JSONL file for cwd
    const files = await readdir(projectDir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const firstLine = await this.readFirstLine(join(projectDir, file));
      if (firstLine) {
        try {
          const msg = JSON.parse(firstLine);
          if (msg.cwd) return msg.cwd;
        } catch { /* ignore */ }
      }
      break; // only check first JSONL
    }

    // 4. Try filesystem probing: walk from the root trying to find a real path
    const parts = encodedPath.replace(/^-/, "").split("-");
    let current = "/";
    for (let i = 0; i < parts.length; i++) {
      const candidates = [parts[i]];
      // Try joining with next parts using hyphens
      for (let j = i + 1; j < parts.length; j++) {
        candidates.push(parts.slice(i, j + 1).join("-"));
      }
      // Try longest match first
      let found = false;
      for (const candidate of candidates.reverse()) {
        const testPath = join(current, candidate);
        const s = await stat(testPath).catch(() => null);
        if (s?.isDirectory()) {
          current = testPath;
          i += candidate.split("-").length - 1;
          found = true;
          break;
        }
      }
      if (!found) {
        current = join(current, parts[i]);
      }
    }
    if (current !== "/") {
      const s = await stat(current).catch(() => null);
      if (s?.isDirectory()) return current;
    }

    // 5. Fallback: naive decode
    return "/" + encodedPath.replace(/^-/, "").replace(/-/g, "/");
  }

  private lastPathSegments(encoded: string): string {
    // Get last 2-3 meaningful segments for matching
    const parts = encoded.replace(/^-/, "").split("-");
    return parts.slice(-3).join("-");
  }

  private async readFirstLine(filePath: string): Promise<string | null> {
    try {
      const content = await readFile(filePath, "utf-8");
      const newlineIdx = content.indexOf("\n");
      return newlineIdx > 0 ? content.slice(0, newlineIdx) : content;
    } catch {
      return null;
    }
  }

  private inferOutcome(
    exchanges: Exchange[],
    activity: JSONLActivityStats,
    meta: RawSessionMeta | undefined,
  ): SessionOutcome {
    if (exchanges.length === 0) return "unknown";

    const hasImpl = exchanges.some((e) => e.category === "implementation");
    const producedChanges = activity.linesAdded > 0 || activity.filesModified.size > 0;
    const errors = meta?.tool_errors ?? 0;
    const interruptions = meta?.user_interruptions ?? 0;

    if (hasImpl && producedChanges && errors === 0 && interruptions === 0) {
      return "fully_achieved";
    }
    if (hasImpl && producedChanges && errors === 0) {
      return "mostly_achieved";
    }
    if (hasImpl && producedChanges) {
      return "partially_achieved";
    }
    const totalCost = exchanges.reduce((s, e) => s + e.estimatedCostUSD, 0);
    if (exchanges.length > 3 && !hasImpl && totalCost > 0.5) {
      return "not_achieved";
    }
    if (errors > 0 && activity.filesModified.size === 0) {
      return "not_achieved";
    }
    return "unknown";
  }

  private inferSummary(exchanges: Exchange[]): string {
    if (exchanges.length === 0) return "";

    // Get first user prompt — clean to single line
    const rawPrompt = exchanges.find((e) => e.userPrompt)?.userPrompt || "";
    if (!rawPrompt) return "";
    const firstLine = rawPrompt.split(/[\n\r]/)[0].trim();
    // Remove common prefixes like slash commands
    const prompt = firstLine.replace(/^\/\w+\s*/, "").trim() || firstLine;

    // Collect top modified file basenames (deduplicated)
    const files = new Set<string>();
    for (const ex of exchanges) {
      for (const f of ex.filesModified) {
        const basename = f.split("/").pop() || f;
        files.add(basename);
        if (files.size >= 3) break;
      }
      if (files.size >= 3) break;
    }

    const fileStr = files.size > 0 ? ` → ${[...files].join(", ")}` : "";
    return prompt + fileStr;
  }

  private inferGoal(exchanges: Exchange[], firstRawPrompt?: string): string {
    // Prefer firstRawPrompt — captures interrupted prompts that never became exchanges
    if (firstRawPrompt && firstRawPrompt.length > 20) {
      return firstRawPrompt;
    }
    if (exchanges.length === 0) return "";
    // Find the first substantive prompt (>20 chars) among the first 5 exchanges
    const candidates = exchanges.slice(0, 5);
    const substantive = candidates.find((e) => e.userPrompt.length > 20);
    return substantive?.userPrompt || candidates[0]?.userPrompt || "";
  }

  private inferGoalCategory(exchanges: Exchange[]): string {
    if (exchanges.length === 0) return "unknown";
    const categories = exchanges.map((e) => e.category);
    const counts: Record<string, number> = {};
    for (const c of categories) {
      counts[c] = (counts[c] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || "unknown";
  }
}
