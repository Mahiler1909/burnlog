import { describe, it, expect } from "vitest";
import { projectSpend, budgetHitDate } from "../../src/core/budget.js";

describe("projectSpend", () => {
  it("projects monthly spend from partial data", () => {
    // Spent $150 in 15 days, projecting to 30 days
    expect(projectSpend(150, 15, 30)).toBe(300);
  });

  it("returns 0 when no days elapsed", () => {
    expect(projectSpend(50, 0, 30)).toBe(0);
  });

  it("handles single day", () => {
    expect(projectSpend(10, 1, 30)).toBe(300);
  });

  it("projects exact when full period elapsed", () => {
    expect(projectSpend(300, 30, 30)).toBe(300);
  });
});

describe("budgetHitDate", () => {
  it("returns date when budget will be hit", () => {
    // $100 spent in 10 days, limit $200, 30-day period starting Mar 1
    const start = new Date("2026-03-01");
    const result = budgetHitDate(100, 10, 200, start, 30);
    expect(result).toBeDefined();
    expect(result).toBe("2026-03-21"); // 10 more days at $10/day
  });

  it("returns undefined when already over budget", () => {
    const start = new Date("2026-03-01");
    const result = budgetHitDate(250, 10, 200, start, 30);
    // daysToLimit is negative
    expect(result).toBeUndefined();
  });

  it("returns undefined when no spend", () => {
    const start = new Date("2026-03-01");
    const result = budgetHitDate(0, 10, 200, start, 30);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no days elapsed", () => {
    const start = new Date("2026-03-01");
    const result = budgetHitDate(50, 0, 200, start, 30);
    expect(result).toBeUndefined();
  });
});
