import { describe, it, expect } from "vitest";
import { parsePeriodDays } from "../../src/utils/period.js";

describe("parsePeriodDays", () => {
  it.each([
    ["7d", 7],
    ["1d", 1],
    ["365d", 365],
    ["2w", 14],
    ["1w", 7],
    ["3m", 90],
    ["1m", 30],
    ["12m", 360],
  ])("parses %s to %d days", (input, expected) => {
    expect(parsePeriodDays(input)).toBe(expected);
  });

  it.each(["invalid", "abc", "7x", "", "d", "w", "7", "-1d"])(
    "exits on invalid input: %s",
    (input) => {
      expect(() => parsePeriodDays(input)).toThrow("process.exit");
    },
  );
});
