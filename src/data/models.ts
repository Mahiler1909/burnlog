export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface Exchange {
  sequenceNumber: number;
  userPrompt: string;
  tokenUsage: TokenUsage;
  estimatedCostUSD: number;
  model: string;
  toolsUsed: string[];
  filesRead: string[];
  filesModified: string[];
  timestamp: Date;
  category: ExchangeCategory;
}

export interface JSONLActivityStats {
  linesAdded: number;
  linesRemoved: number;
  filesModified: Set<string>;
  filesRead: Set<string>;
  editCount: number;
  writeCount: number;
  toolCounts: Record<string, number>;
}

export type ExchangeCategory =
  | "exploration"
  | "implementation"
  | "debugging"
  | "planning"
  | "wasted";

export type SessionOutcome =
  | "fully_achieved"
  | "mostly_achieved"
  | "partially_achieved"
  | "not_achieved"
  | "unknown";

export interface Friction {
  type: string;
  count: number;
  detail: string;
}

export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  summary: string;
  firstPrompt: string;
  gitBranch: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  messageCount: number;
  isSidechain: boolean;

  // Token economics
  tokenUsage: TokenUsage;
  estimatedCostUSD: number;

  // Quality (from facets)
  goal: string;
  goalCategory: string;
  outcome: SessionOutcome;
  helpfulness: string;
  sessionType: string;
  frictions: Friction[];

  // Activity (from session-meta)
  toolCounts: Record<string, number>;
  languages: Record<string, number>;
  linesAdded: number;
  linesRemoved: number;
  filesModified: number;
  gitCommits: number;
  toolErrors: number;
  userInterruptions: number;

  // Exchanges (prompt-level granularity)
  exchanges: Exchange[];
}

export interface GitCommit {
  hash: string;
  message: string;
  timestamp: Date;
  branch: string;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  author: string;
}

export interface BranchWork {
  branchName: string;
  projectPath: string;
  sessions: Session[];
  commits: GitCommit[];
  totalTokens: TokenUsage;
  totalCostUSD: number;
  costPerCommit: number;
  costPerLineChanged: number;
  wasteRatio: number;
  timeSpan: { start: Date; end: Date };
}

export interface Project {
  id: string;
  path: string;
  name: string;
  encodedPath: string;
  sessions: Session[];
}

export type WasteCategory = "platform_overhead" | "avoidable";

export interface WasteSignal {
  type: WasteType;
  category: WasteCategory;
  sessionId: string;
  estimatedWastedCostUSD: number;
  description: string;
  suggestion: string;
}

export type WasteType =
  | "retry_loop"
  | "abandoned_session"
  | "context_rebuild"
  | "wrong_approach"
  | "excessive_exploration"
  | "error_cascade"
  | "debugging_loop"
  | "high_cost_per_line"
  | "stalled_exploration";

export interface CorrelationResult {
  branchWork: BranchWork[];
  unmatchedSessions: Session[];
}

export interface CostBreakdown {
  byProject: Record<string, number>;
  byBranch: Record<string, number>;
  byCategory: Record<string, number>;
  byModel: Record<string, number>;
  byDay: Record<string, number>;
  byOutcome: Record<string, number>;
}

// Raw data shapes from Claude Code files

export interface RawSessionIndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

export interface RawSessionIndex {
  version: number;
  entries: RawSessionIndexEntry[];
  originalPath: string;
}

export interface RawFacets {
  underlying_goal: string;
  goal_categories: Record<string, number>;
  outcome: string;
  user_satisfaction_counts: Record<string, number>;
  claude_helpfulness: string;
  session_type: string;
  friction_counts: Record<string, number>;
  friction_detail: string;
  primary_success: string;
  brief_summary: string;
  session_id: string;
}

export interface RawSessionMeta {
  session_id: string;
  project_path: string;
  start_time: string;
  duration_minutes: number;
  user_message_count: number;
  assistant_message_count: number;
  tool_counts: Record<string, number>;
  languages: Record<string, number>;
  git_commits: number;
  git_pushes: number;
  input_tokens: number;
  output_tokens: number;
  first_prompt: string;
  user_interruptions: number;
  tool_errors: number;
  tool_error_categories: Record<string, number>;
  lines_added: number;
  lines_removed: number;
  files_modified: number;
  message_hours: number[];
  user_message_timestamps: string[];
}

export interface RawJSONLMessage {
  type: "user" | "assistant" | "system" | "file-history-snapshot" | "progress" | "summary";
  subtype?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
      cache_creation?: {
        ephemeral_5m_input_tokens: number;
        ephemeral_1h_input_tokens: number;
      };
      service_tier?: string;
    };
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
    }>;
    stop_reason?: string;
  };
  content?: string;
  cwd?: string;
  sessionId?: string;
  gitBranch?: string;
  timestamp?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  // Compact/meta markers
  isCompactSummary?: boolean;
  isMeta?: boolean;
  compactMetadata?: {
    trigger: "auto" | "manual";
    preTokens: number;
  };
}
