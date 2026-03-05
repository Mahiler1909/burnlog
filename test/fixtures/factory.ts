import type {
  TokenUsage,
  Exchange,
  Session,
  GitCommit,
  ExchangeCategory,
  SessionOutcome,
} from "../../src/data/models.js";

export function createTokenUsage(overrides?: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: 500,
    outputTokens: 300,
    cacheCreationTokens: 100,
    cacheReadTokens: 100,
    ...overrides,
  };
}

export function createExchange(overrides?: Partial<Exchange>): Exchange {
  return {
    sequenceNumber: 0,
    userPrompt: "fix the bug in auth.ts",
    tokenUsage: createTokenUsage(),
    estimatedCostUSD: 0.05,
    model: "claude-sonnet-4-5",
    toolsUsed: ["Edit"],
    filesRead: [],
    filesModified: ["auth.ts"],
    timestamp: new Date("2026-03-01T10:00:00Z"),
    category: "implementation" as ExchangeCategory,
    ...overrides,
  };
}

export function createSession(overrides?: Partial<Session>): Session {
  const defaults: Session = {
    id: "test-session-001",
    projectPath: "/Users/test/projects/my-app",
    projectName: "my-app",
    summary: "Fix authentication bug",
    firstPrompt: "fix the bug in auth.ts",
    gitBranch: "fix/auth-bug",
    startTime: new Date("2026-03-01T09:00:00Z"),
    endTime: new Date("2026-03-01T10:00:00Z"),
    durationMinutes: 60,
    messageCount: 10,
    isSidechain: false,
    tokenUsage: createTokenUsage({
      inputTokens: 5000,
      outputTokens: 3000,
      cacheCreationTokens: 1000,
      cacheReadTokens: 1000,
    }),
    estimatedCostUSD: 1.0,
    goal: "Fix authentication bug",
    goalCategory: "bug_fix",
    outcome: "fully_achieved" as SessionOutcome,
    helpfulness: "very_helpful",
    sessionType: "coding",
    frictions: [],
    toolCounts: { Edit: 5, Read: 10 },
    languages: { typescript: 15 },
    linesAdded: 50,
    linesRemoved: 20,
    filesModified: 3,
    gitCommits: 2,
    toolErrors: 0,
    userInterruptions: 0,
    exchanges: [createExchange()],
  };

  return { ...defaults, ...overrides };
}

export function createGitCommit(overrides?: Partial<GitCommit>): GitCommit {
  return {
    hash: "abc1234567890",
    message: "fix: resolve auth token validation",
    timestamp: new Date("2026-03-01T09:30:00Z"),
    branch: "fix/auth-bug",
    filesChanged: ["src/auth.ts", "src/middleware.ts"],
    linesAdded: 30,
    linesRemoved: 10,
    author: "Test User",
    ...overrides,
  };
}
