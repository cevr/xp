import { describe, expect, test } from "bun:test";
import { parseMetrics } from "../../src/services/Runner.js";

describe("parseMetrics", () => {
  test("parses simple METRIC lines", () => {
    const stdout = "some output\nMETRIC latency=42.3\nmore output\nMETRIC throughput=1000\n";
    const metrics = parseMetrics(stdout);
    expect(metrics).toEqual({ latency: 42.3, throughput: 1000 });
  });

  test("handles scientific notation", () => {
    const stdout = "METRIC value=1.5e3\n";
    const metrics = parseMetrics(stdout);
    expect(metrics).toEqual({ value: 1500 });
  });

  test("handles negative values", () => {
    const stdout = "METRIC score=-5.2\n";
    const metrics = parseMetrics(stdout);
    expect(metrics).toEqual({ score: -5.2 });
  });

  test("ignores non-metric lines", () => {
    const stdout = "Building...\nDone.\nMETRIC time=100\n";
    const metrics = parseMetrics(stdout);
    expect(metrics).toEqual({ time: 100 });
  });

  test("returns empty for no metrics", () => {
    const stdout = "no metrics here\n";
    const metrics = parseMetrics(stdout);
    expect(metrics).toEqual({});
  });

  test("handles underscore in metric name", () => {
    const stdout = "METRIC avg_latency=12.5\n";
    const metrics = parseMetrics(stdout);
    expect(metrics).toEqual({ avg_latency: 12.5 });
  });

  test("rejects invalid metric names", () => {
    const stdout = "METRIC 123invalid=10\n";
    const metrics = parseMetrics(stdout);
    expect(metrics).toEqual({});
  });
});
