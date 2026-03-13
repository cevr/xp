import { describe, expect, test } from "bun:test";
import { compareMetrics, shouldKeep } from "../../src/scoring.js";

describe("compareMetrics", () => {
  test("min direction — lower is better", () => {
    expect(compareMetrics(10, 20, "min")).toBe("better");
    expect(compareMetrics(20, 10, "min")).toBe("worse");
    expect(compareMetrics(10, 10, "min")).toBe("equal");
  });

  test("max direction — higher is better", () => {
    expect(compareMetrics(20, 10, "max")).toBe("better");
    expect(compareMetrics(10, 20, "max")).toBe("worse");
    expect(compareMetrics(10, 10, "max")).toBe("equal");
  });
});

describe("shouldKeep", () => {
  test("keeps when min and current is lower", () => {
    expect(shouldKeep("min", 5, 10)).toBe(true);
  });

  test("discards when min and current is higher", () => {
    expect(shouldKeep("min", 15, 10)).toBe(false);
  });

  test("keeps when max and current is higher", () => {
    expect(shouldKeep("max", 15, 10)).toBe(true);
  });

  test("discards when max and current is lower", () => {
    expect(shouldKeep("max", 5, 10)).toBe(false);
  });

  test("discards when equal", () => {
    expect(shouldKeep("min", 10, 10)).toBe(false);
    expect(shouldKeep("max", 10, 10)).toBe(false);
  });
});
