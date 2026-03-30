import type { ExchangeCategory } from "../../data/models.js";

export const EDIT_TOOLS = ["Edit", "Write", "NotebookEdit"];
export const READ_TOOLS = ["Read", "Glob", "Grep"];
export const META_TOOLS = [
  "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskOutput",
  "AskUserQuestion", "ExitPlanMode", "EnterPlanMode", "EnterWorktree",
];

export function isReadOnlyMCP(t: string): boolean {
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
