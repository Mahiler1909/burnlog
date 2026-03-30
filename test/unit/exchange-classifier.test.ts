import { describe, it, expect } from "vitest";
import {
  classifyExchangeCategory,
  EDIT_TOOLS,
  READ_TOOLS,
  META_TOOLS,
  isReadOnlyMCP,
} from "../../src/providers/claude-code/exchange-classifier.js";

describe("classifyExchangeCategory", () => {
  it("returns planning when no tools used", () => {
    expect(classifyExchangeCategory([])).toBe("planning");
  });

  it("returns planning when only meta tools used", () => {
    expect(classifyExchangeCategory(["TaskCreate", "AskUserQuestion"])).toBe("planning");
  });

  it("returns implementation when Edit is used", () => {
    expect(classifyExchangeCategory(["Read", "Edit"])).toBe("implementation");
  });

  it("returns implementation when Write is used", () => {
    expect(classifyExchangeCategory(["Write"])).toBe("implementation");
  });

  it("returns exploration when only Read/Glob/Grep/Bash", () => {
    expect(classifyExchangeCategory(["Read", "Glob", "Grep"])).toBe("exploration");
    expect(classifyExchangeCategory(["Bash"])).toBe("exploration");
    expect(classifyExchangeCategory(["Read", "Bash"])).toBe("exploration");
  });

  it("returns exploration for read-only MCP tools", () => {
    expect(classifyExchangeCategory(["mcp__server__get_data"])).toBe("exploration");
    expect(classifyExchangeCategory(["mcp__server__list_items"])).toBe("exploration");
    expect(classifyExchangeCategory(["mcp__chrome__tabs_context_mcp"])).toBe("exploration");
  });

  it("returns debugging for browser MCP actions", () => {
    expect(classifyExchangeCategory(["mcp__chrome__computer"])).toBe("debugging");
    expect(classifyExchangeCategory(["mcp__chrome__navigate"])).toBe("debugging");
    expect(classifyExchangeCategory(["mcp__chrome__form_input"])).toBe("debugging");
  });

  it("returns implementation as default for unknown tools", () => {
    expect(classifyExchangeCategory(["SomeUnknownTool"])).toBe("implementation");
  });

  it("ignores meta tools in classification", () => {
    // Meta + Read = exploration (meta ignored)
    expect(classifyExchangeCategory(["TaskCreate", "Read"])).toBe("exploration");
    // Meta + Edit = implementation (meta ignored)
    expect(classifyExchangeCategory(["TaskUpdate", "Edit"])).toBe("implementation");
  });
});

describe("isReadOnlyMCP", () => {
  it("returns true for get/list/read/search/find/tabs/context prefixed MCP tools", () => {
    expect(isReadOnlyMCP("mcp__server__get_data")).toBe(true);
    expect(isReadOnlyMCP("mcp__server__list_items")).toBe(true);
    expect(isReadOnlyMCP("mcp__server__search_docs")).toBe(true);
  });

  it("returns false for non-MCP tools", () => {
    expect(isReadOnlyMCP("Read")).toBe(false);
    expect(isReadOnlyMCP("Edit")).toBe(false);
  });

  it("returns false for write MCP tools", () => {
    expect(isReadOnlyMCP("mcp__server__create_item")).toBe(false);
    expect(isReadOnlyMCP("mcp__server__update_item")).toBe(false);
  });
});

describe("tool constants", () => {
  it("EDIT_TOOLS contains expected tools", () => {
    expect(EDIT_TOOLS).toContain("Edit");
    expect(EDIT_TOOLS).toContain("Write");
    expect(EDIT_TOOLS).toContain("NotebookEdit");
  });

  it("READ_TOOLS contains expected tools", () => {
    expect(READ_TOOLS).toContain("Read");
    expect(READ_TOOLS).toContain("Glob");
    expect(READ_TOOLS).toContain("Grep");
  });

  it("META_TOOLS contains task tools", () => {
    expect(META_TOOLS).toContain("TaskCreate");
    expect(META_TOOLS).toContain("AskUserQuestion");
  });
});
