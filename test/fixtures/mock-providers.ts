// noinspection JSUnusedGlobalSymbols

import type { Session } from "../../src/data/models.js";

export let testSessions: Session[] = [];

export function setTestSessions(sessions: Session[]): void {
  testSessions = sessions;
}

export function clearTestSessions(): void {
  testSessions = [];
}

export function createMockProvider() {
  return {
    ClaudeCodeProvider: class {
      name = "claude-code";
      isAvailable() { return true; }
      async listProjects() { return []; }
      async loadSessionsForProject() { return []; }
      async loadAllSessions() { return testSessions; }
    },
  };
}

export function createMockGitAnalyzer() {
  return {
    GitAnalyzer: class {
      async isGitRepo() { return false; }
      async resolveGitRoot() { return null; }
      async getCurrentBranch() { return "main"; }
      async getCommits() { return []; }
      async getCommitsForBranch() { return []; }
      async getBranches() { return []; }
    },
  };
}
