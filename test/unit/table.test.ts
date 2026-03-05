import { describe, it, expect } from "vitest";
import { formatCurrency, formatTokens } from "../../src/cli/formatters/table.js";

describe("formatCurrency", () => {
  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats positive amounts", () => {
    expect(formatCurrency(1234.5)).toBe("$1234.50");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatCurrency(1.999)).toBe("$2.00");
  });

  it("formats small amounts", () => {
    expect(formatCurrency(0.05)).toBe("$0.05");
  });
});

describe("formatTokens", () => {
  it("formats small counts as-is", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands as K", () => {
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(999999)).toBe("1000.0K");
  });

  it("formats millions as M", () => {
    expect(formatTokens(2_000_000)).toBe("2.0M");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("formats zero", () => {
    expect(formatTokens(0)).toBe("0");
  });
});
