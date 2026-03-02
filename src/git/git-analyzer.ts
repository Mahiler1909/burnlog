import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitCommit } from "../data/models.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT = 15_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_COUNT = 500;

// NUL byte separator for git log format (avoids issues with pipes/special chars)
const LOG_FORMAT = "%H%x00%ae%x00%aI%x00%s";
const FIELD_SEP = "\0";

async function runGit(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

export class GitAnalyzer {
  private repoCache = new Map<string, boolean>();
  private commitsCache = new Map<string, GitCommit[]>();

  async isGitRepo(projectPath: string): Promise<boolean> {
    if (this.repoCache.has(projectPath)) return this.repoCache.get(projectPath)!;
    const result = await runGit(projectPath, ["rev-parse", "--git-dir"]);
    const isRepo = result.length > 0;
    this.repoCache.set(projectPath, isRepo);
    return isRepo;
  }

  async getBranches(projectPath: string): Promise<string[]> {
    const output = await runGit(projectPath, ["branch", "--list", "--format=%(refname:short)"]);
    if (!output) return [];
    return output.split("\n").filter(Boolean);
  }

  async getCommits(
    projectPath: string,
    opts: { branch?: string; since?: Date; until?: Date; maxCount?: number } = {},
  ): Promise<GitCommit[]> {
    const cacheKey = `${projectPath}:${opts.branch || "all"}:${opts.since?.toISOString() || ""}:${opts.until?.toISOString() || ""}`;
    if (this.commitsCache.has(cacheKey)) return this.commitsCache.get(cacheKey)!;

    if (!(await this.isGitRepo(projectPath))) return [];

    const args = ["log", `--format=${LOG_FORMAT}`, "--numstat", `--max-count=${opts.maxCount || DEFAULT_MAX_COUNT}`];
    if (opts.branch) args.push(opts.branch);
    if (opts.since) args.push(`--since=${opts.since.toISOString()}`);
    if (opts.until) args.push(`--until=${opts.until.toISOString()}`);

    const output = await runGit(projectPath, args);
    const commits = this.parseGitLog(output);
    this.commitsCache.set(cacheKey, commits);
    return commits;
  }

  /**
   * Get commits exclusive to a branch (not on baseBranch).
   * Falls back to all branch commits if baseBranch doesn't exist.
   */
  async getCommitsForBranch(
    projectPath: string,
    branch: string,
    baseBranch = "main",
  ): Promise<GitCommit[]> {
    if (!(await this.isGitRepo(projectPath))) return [];

    // Try exclusive commits: branch --not baseBranch
    const args = [
      "log",
      `--format=${LOG_FORMAT}`,
      "--numstat",
      `--max-count=${DEFAULT_MAX_COUNT}`,
      branch,
      "--not",
      baseBranch,
    ];

    let output = await runGit(projectPath, args);

    // If branch doesn't exist locally, try with origin/ prefix
    if (!output) {
      args[args.length - 2] = `origin/${branch}`;
      output = await runGit(projectPath, args);
    }

    // If still nothing, fall back to all commits on the branch
    if (!output) {
      return this.getCommits(projectPath, { branch });
    }

    return this.parseGitLog(output);
  }

  private parseGitLog(output: string): GitCommit[] {
    if (!output) return [];

    const commits: GitCommit[] = [];
    const lines = output.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.includes(FIELD_SEP)) {
        i++;
        continue;
      }

      const parts = line.split(FIELD_SEP);
      if (parts.length < 4) {
        i++;
        continue;
      }

      const [hash, author, dateStr, message] = parts;
      const filesChanged: string[] = [];
      let linesAdded = 0;
      let linesRemoved = 0;

      i++;
      // Skip empty line between header and numstat
      if (i < lines.length && lines[i] === "") i++;

      // Parse numstat lines (additions\tdeletions\tfilename)
      while (i < lines.length) {
        const numstatLine = lines[i];
        if (numstatLine === "" || numstatLine.includes(FIELD_SEP)) break;

        const numParts = numstatLine.split("\t");
        if (numParts.length >= 3) {
          const added = parseInt(numParts[0], 10);
          const removed = parseInt(numParts[1], 10);
          const fileName = numParts[2];

          if (!isNaN(added)) linesAdded += added;
          if (!isNaN(removed)) linesRemoved += removed;
          if (fileName) filesChanged.push(fileName);
        }
        i++;
      }

      commits.push({
        hash,
        message,
        timestamp: new Date(dateStr),
        branch: "", // filled by caller
        filesChanged,
        linesAdded,
        linesRemoved,
        author,
      });
    }

    return commits;
  }
}
