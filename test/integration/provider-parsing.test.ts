import { describe, it, expect } from "vitest";
import { classifyExchangeCategory } from "../../src/providers/claude-code/provider.js";

describe("Exchange classification patterns", () => {
  it("classifies no-tools exchange as planning", () => {
    expect(classifyExchangeCategory([])).toBe("planning");
  });

  it("classifies Edit/Write as implementation", () => {
    expect(classifyExchangeCategory(["Edit"])).toBe("implementation");
    expect(classifyExchangeCategory(["Write"])).toBe("implementation");
    expect(classifyExchangeCategory(["Read", "Edit"])).toBe("implementation");
  });

  it("classifies Read/Grep/Glob-only as exploration", () => {
    expect(classifyExchangeCategory(["Read"])).toBe("exploration");
    expect(classifyExchangeCategory(["Grep"])).toBe("exploration");
    expect(classifyExchangeCategory(["Read", "Glob", "Grep"])).toBe("exploration");
    expect(classifyExchangeCategory(["Bash"])).toBe("exploration");
  });

  it("classifies browser MCP actions as debugging", () => {
    expect(classifyExchangeCategory(["mcp__claude-in-chrome__computer"])).toBe("debugging");
    expect(classifyExchangeCategory(["mcp__claude-in-chrome__navigate"])).toBe("debugging");
    expect(classifyExchangeCategory(["mcp__claude-in-chrome__form_input"])).toBe("debugging");
  });

  it("classifies meta-only tools as planning", () => {
    expect(classifyExchangeCategory(["TaskCreate"])).toBe("planning");
    expect(classifyExchangeCategory(["AskUserQuestion"])).toBe("planning");
    expect(classifyExchangeCategory(["ExitPlanMode"])).toBe("planning");
  });
});
