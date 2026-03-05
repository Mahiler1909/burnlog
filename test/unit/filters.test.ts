import { describe, it, expect } from "vitest";
import { filterByProject, filterByPeriod } from "../../src/utils/filters.js";
import { createSession } from "../fixtures/factory.js";

describe("filterByProject", () => {
  const sessions = [
    createSession({ projectName: "my-app", projectPath: "/Users/test/projects/my-app" }),
    createSession({ projectName: "burnlog", projectPath: "/Users/test/projects/burnlog" }),
    createSession({ projectName: "My-App-V2", projectPath: "/Users/test/projects/my-app-v2" }),
  ];

  it("returns all sessions when project is undefined", () => {
    expect(filterByProject(sessions)).toHaveLength(3);
  });

  it("filters by partial name match (case-insensitive)", () => {
    expect(filterByProject(sessions, "my-app")).toHaveLength(2);
  });

  it("filters by path match", () => {
    expect(filterByProject(sessions, "burnlog")).toHaveLength(1);
  });

  it("returns empty when no match", () => {
    expect(filterByProject(sessions, "nonexistent")).toHaveLength(0);
  });
});

describe("filterByPeriod", () => {
  const now = new Date();
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d;
  };

  const sessions = [
    createSession({ startTime: daysAgo(1) }),
    createSession({ startTime: daysAgo(5) }),
    createSession({ startTime: daysAgo(15) }),
    createSession({ startTime: daysAgo(60) }),
  ];

  it("returns all sessions when period is undefined", () => {
    expect(filterByPeriod(sessions)).toHaveLength(4);
  });

  it("filters to last 7 days", () => {
    expect(filterByPeriod(sessions, "7d")).toHaveLength(2);
  });

  it("filters to last 2 weeks", () => {
    // 2w = 14 days, session at 15 days ago is excluded
    expect(filterByPeriod(sessions, "2w")).toHaveLength(2);
  });

  it("filters to last 3 months", () => {
    expect(filterByPeriod(sessions, "3m")).toHaveLength(4);
  });

  it("returns empty array for empty input", () => {
    expect(filterByPeriod([], "7d")).toHaveLength(0);
  });
});
