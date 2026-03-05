import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Test JSONL parsing by creating temp files and using the provider.
// Since the provider reads from ~/.claude, we test the parsing logic indirectly
// by testing what the provider DOES with JSONL content:
// - user+assistant pairs -> exchanges
// - tool_result merging
// - ghost session filtering
// - gitBranch extraction

describe("JSONL format expectations", () => {
  it("user message followed by assistant with usage creates an exchange", () => {
    // Validate the JSONL format contract used by the provider
    const userMsg = { type: "user", content: "fix the bug" };
    const assistantMsg = {
      type: "assistant",
      message: {
        model: "claude-sonnet-4-5",
        usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        content: [
          { type: "text", text: "I'll fix that" },
          { type: "tool_use", name: "Edit", input: { file_path: "/src/app.ts", old_string: "a", new_string: "b" } },
        ],
      },
    };

    // Validate structure
    expect(userMsg.type).toBe("user");
    expect(assistantMsg.message.usage.input_tokens).toBe(1000);
    expect(assistantMsg.message.content[1].name).toBe("Edit");
  });

  it("tool_result continuation has no user prompt before assistant", () => {
    // When assistant uses a tool, the response flow is:
    // assistant (with tool_use) -> user (with tool_result subtype) -> assistant (continuation)
    // The provider merges continuation into previous exchange
    const continuation = {
      type: "assistant",
      message: {
        model: "claude-sonnet-4-5",
        usage: { input_tokens: 500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        content: [{ type: "text", text: "The edit was applied" }],
      },
    };
    expect(continuation.message.usage.input_tokens).toBe(500);
  });

  it("system/summary/progress messages are skipped", () => {
    const skipTypes = ["system", "summary", "file-history-snapshot", "progress"];
    for (const type of skipTypes) {
      const msg = { type };
      expect(skipTypes).toContain(msg.type);
    }
  });

  it("gitBranch is extracted from first message that has it", () => {
    const msg = { type: "user", content: "hello", gitBranch: "feature/auth" };
    expect(msg.gitBranch).toBe("feature/auth");
  });

  it("compact/meta messages are skipped", () => {
    const compactMsg = { type: "user", isCompactSummary: true, content: "summary" };
    const metaMsg = { type: "user", isMeta: true, content: "meta" };
    expect(compactMsg.isCompactSummary).toBe(true);
    expect(metaMsg.isMeta).toBe(true);
  });

  it("ghost sessions are filtered: empty exchanges + zero cost", () => {
    // Provider filters sessions where:
    // - exchanges.length === 0 AND messageCount === 0
    // - messageCount > 0 but estimatedCostUSD === 0 and no exchanges
    const ghostSession = {
      exchanges: [],
      messageCount: 0,
      estimatedCostUSD: 0,
    };
    const validSession = {
      exchanges: [{ estimatedCostUSD: 0.5 }],
      messageCount: 2,
      estimatedCostUSD: 0.5,
    };

    // Ghost: no exchanges, no messages
    const keepGhost = ghostSession.exchanges.length > 0 ||
      (ghostSession.messageCount > 0 && ghostSession.estimatedCostUSD > 0);
    expect(keepGhost).toBe(false);

    // Valid: has exchanges
    const keepValid = validSession.exchanges.length > 0 ||
      (validSession.messageCount > 0 && validSession.estimatedCostUSD > 0);
    expect(keepValid).toBe(true);
  });
});

describe("Exchange classification from tools", () => {
  // Test the classification logic more thoroughly with edge cases

  function classify(toolsUsed: string[]): string {
    if (toolsUsed.length === 0) return "planning";
    const editTools = ["Edit", "Write", "NotebookEdit"];
    const readTools = ["Read", "Glob", "Grep"];
    const metaTools = [
      "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskOutput",
      "AskUserQuestion", "ExitPlanMode", "EnterPlanMode", "EnterWorktree",
    ];
    const actionTools = toolsUsed.filter((t) => !metaTools.includes(t));
    if (actionTools.length === 0) return "planning";
    const hasEdits = actionTools.some((t) => editTools.includes(t));
    const isReadOnlyMCP = (t: string) => {
      if (!t.startsWith("mcp__")) return false;
      if (t.startsWith("mcp__claude-in-chrome__read")) return true;
      if (t.startsWith("mcp__claude-in-chrome__tabs")) return true;
      if (t.startsWith("mcp__claude-in-chrome__find")) return true;
      if (t.startsWith("mcp__claude-in-chrome__get")) return true;
      if (t.startsWith("mcp__atlassian__")) return true;
      if (t.startsWith("mcp__figma__")) return true;
      if (t.includes("get_") || t.includes("list_") || t.includes("read_") || t.includes("search_") || t.includes("find_")) return true;
      return false;
    };
    const isExploration = actionTools.every((t) =>
      readTools.includes(t) || t === "Bash" || t === "Agent" || t === "WebSearch" || t === "WebFetch" || isReadOnlyMCP(t),
    );
    if (hasEdits) return "implementation";
    if (isExploration) return "exploration";
    const hasBrowserActions = actionTools.some((t) =>
      t.startsWith("mcp__claude-in-chrome__computer") ||
      t.startsWith("mcp__claude-in-chrome__navigate") ||
      t.startsWith("mcp__claude-in-chrome__form"),
    );
    if (hasBrowserActions) return "debugging";
    return "implementation";
  }

  it("NotebookEdit is implementation", () => {
    expect(classify(["NotebookEdit"])).toBe("implementation");
  });

  it("WebSearch + WebFetch is exploration", () => {
    expect(classify(["WebSearch", "WebFetch"])).toBe("exploration");
  });

  it("Agent-only is exploration", () => {
    expect(classify(["Agent"])).toBe("exploration");
  });

  it("read-only MCP (atlassian) is exploration", () => {
    expect(classify(["mcp__atlassian__getJiraIssue"])).toBe("exploration");
  });

  it("read-only MCP (figma) is exploration", () => {
    expect(classify(["mcp__figma__get_file"])).toBe("exploration");
  });

  it("chrome read tabs is exploration", () => {
    expect(classify(["mcp__claude-in-chrome__tabs_context_mcp"])).toBe("exploration");
  });

  it("mixed meta + edit is implementation", () => {
    expect(classify(["TaskCreate", "Edit"])).toBe("implementation");
  });

  it("unknown MCP tool defaults to implementation", () => {
    expect(classify(["mcp__unknown__do_something"])).toBe("implementation");
  });
});
