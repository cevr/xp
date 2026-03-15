import { describe, expect, test } from "bun:test";
import { parseResult } from "../../src/services/Runner.js";

describe("parseResult", () => {
  test("parses single RESULT line", () => {
    const stdout = "some output\nRESULT 42.3\nmore output\n";
    const result = parseResult(stdout);
    expect(result).toEqual({ value: 42.3, count: 1 });
  });

  test("handles scientific notation", () => {
    const stdout = "RESULT 1.5e3\n";
    const result = parseResult(stdout);
    expect(result).toEqual({ value: 1500, count: 1 });
  });

  test("handles negative values", () => {
    const stdout = "RESULT -5.2\n";
    const result = parseResult(stdout);
    expect(result).toEqual({ value: -5.2, count: 1 });
  });

  test("ignores non-RESULT lines", () => {
    const stdout = "Building...\nDone.\nRESULT 100\n";
    const result = parseResult(stdout);
    expect(result).toEqual({ value: 100, count: 1 });
  });

  test("returns undefined for no RESULT", () => {
    const stdout = "no result here\n";
    const result = parseResult(stdout);
    expect(result).toEqual({ value: undefined, count: 0 });
  });

  test("detects multiple RESULT lines", () => {
    const stdout = "RESULT 42.3\nRESULT 100\n";
    const result = parseResult(stdout);
    expect(result.count).toBe(2);
  });

  test("handles integer values", () => {
    const stdout = "RESULT 42\n";
    const result = parseResult(stdout);
    expect(result).toEqual({ value: 42, count: 1 });
  });

  test("handles positive sign", () => {
    const stdout = "RESULT +12.5\n";
    const result = parseResult(stdout);
    expect(result).toEqual({ value: 12.5, count: 1 });
  });

  test("ignores METRIC lines (old format)", () => {
    const stdout = "METRIC latency=42.3\n";
    const result = parseResult(stdout);
    expect(result).toEqual({ value: undefined, count: 0 });
  });
});
