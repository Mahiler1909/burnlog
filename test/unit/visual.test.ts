import { describe, it, expect } from "vitest";
import { renderBar, renderSparkline, renderScoreGauge, outcomeIcon, renderOutcomeDistribution } from "../../src/cli/formatters/table.js";
import { createSession } from "../fixtures/factory.js";
import type { SessionOutcome } from "../../src/data/models.js";

describe("renderBar", () => {
  it("returns empty bar for 0", () => {
    const bar = renderBar(0, 10);
    // Should be 10 dim characters (─)
    expect(bar.replace(/\x1b\[[^m]*m/g, "")).toHaveLength(10);
  });

  it("returns full bar for 1", () => {
    const bar = renderBar(1, 10);
    const stripped = bar.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toContain("█");
    expect(stripped.replace(/─/g, "")).toHaveLength(10);
  });

  it("returns partial bar for 0.5", () => {
    const bar = renderBar(0.5, 20);
    const stripped = bar.replace(/\x1b\[[^m]*m/g, "");
    // Should have approximately 10 full blocks + some partial + empty
    expect(stripped.length).toBe(20);
  });

  it("clamps values above 1", () => {
    const bar = renderBar(1.5, 10);
    const stripped = bar.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped.replace(/─/g, "")).toHaveLength(10);
  });

  it("clamps values below 0", () => {
    const bar = renderBar(-0.5, 10);
    const stripped = bar.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toHaveLength(10);
  });
});

describe("renderSparkline", () => {
  it("returns empty string for empty array", () => {
    expect(renderSparkline([])).toBe("");
  });

  it("renders mid-height chars for equal values", () => {
    const spark = renderSparkline([5, 5, 5]);
    const stripped = spark.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toHaveLength(3);
    // All same character
    expect(new Set(stripped.split("")).size).toBe(1);
  });

  it("renders ascending values with increasing height", () => {
    const spark = renderSparkline([0, 50, 100]);
    const stripped = spark.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toHaveLength(3);
    // First char should be lowest, last should be highest
    expect(stripped[0]).toBe("▁");
    expect(stripped[2]).toBe("█");
  });

  it("handles single value", () => {
    const spark = renderSparkline([42]);
    const stripped = spark.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toHaveLength(1);
  });
});

describe("renderScoreGauge", () => {
  it("renders score with gauge", () => {
    const gauge = renderScoreGauge(75, 20);
    const stripped = gauge.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toContain("75/100");
  });

  it("handles score of 0", () => {
    const gauge = renderScoreGauge(0, 10);
    const stripped = gauge.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toContain("0/100");
  });

  it("handles score of 100", () => {
    const gauge = renderScoreGauge(100, 10);
    const stripped = gauge.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toContain("100/100");
  });
});

describe("outcomeIcon", () => {
  it("returns green dot for fully achieved", () => {
    const icon = outcomeIcon("fully_achieved");
    const stripped = icon.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toBe("●");
  });

  it("returns red circle for not achieved", () => {
    const icon = outcomeIcon("not_achieved");
    const stripped = icon.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toBe("○");
  });

  it("returns half circle for partial", () => {
    const icon = outcomeIcon("partially_achieved");
    const stripped = icon.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toBe("◐");
  });

  it("returns open circle for unknown", () => {
    const icon = outcomeIcon("unknown");
    const stripped = icon.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toBe("◌");
  });
});

describe("renderOutcomeDistribution", () => {
  it("counts outcomes correctly", () => {
    const sessions = [
      createSession({ outcome: "fully_achieved" as SessionOutcome }),
      createSession({ outcome: "fully_achieved" as SessionOutcome }),
      createSession({ outcome: "not_achieved" as SessionOutcome }),
      createSession({ outcome: "partially_achieved" as SessionOutcome }),
    ];
    const result = renderOutcomeDistribution(sessions);
    const stripped = result.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toContain("2 OK");
    expect(stripped).toContain("1 fail");
    expect(stripped).toContain("1 partial");
  });

  it("handles empty sessions", () => {
    const result = renderOutcomeDistribution([]);
    const stripped = result.replace(/\x1b\[[^m]*m/g, "");
    expect(stripped).toBe("no sessions");
  });
});
