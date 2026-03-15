import { describe, expect, test } from "bun:test";
import { buildExperimentPrompt, buildSetupPrompt } from "../../src/prompt.js";
import { Session } from "../../src/types.js";
import type { ExperimentState } from "../../src/types.js";

const makeSession = (overrides: Partial<Session> = {}): Session =>
  new Session({
    name: "test-exp",
    unit: "ms",
    direction: "min",
    provider: "claude",
    objective: "Reduce request latency",
    benchmarkCmd: "./bench.sh",
    maxIterations: 50,
    maxFailures: 5,
    projectRoot: "/tmp/project",
    segment: 1,
    currentIteration: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

const emptyState: ExperimentState = {
  segment: 1,
  iteration: 0,
  baseline: undefined,
  best: undefined,
  results: [],
  steers: [],
  lastPendingResult: undefined,
  hasDecisionForLastPending: true,
  lastPendingCommit: undefined,
};

describe("buildExperimentPrompt", () => {
  test("includes experiment name and objective", () => {
    const session = makeSession();
    const prompt = buildExperimentPrompt(session, emptyState, "/tmp/worktree", "/tmp/project", []);
    expect(prompt).toContain("test-exp");
    expect(prompt).toContain("Reduce request latency");
  });

  test("includes direction details", () => {
    const session = makeSession();
    const prompt = buildExperimentPrompt(session, emptyState, "/tmp/worktree", "/tmp/project", []);
    expect(prompt).toContain("minimize");
    expect(prompt).toContain("ms");
  });

  test("includes paths", () => {
    const session = makeSession();
    const prompt = buildExperimentPrompt(session, emptyState, "/tmp/worktree", "/tmp/project", []);
    expect(prompt).toContain("/tmp/worktree");
    expect(prompt).toContain("/tmp/project");
  });
});

describe("buildSetupPrompt", () => {
  test("includes source and worktree paths", () => {
    const prompt = buildSetupPrompt("/tmp/project", "/tmp/worktree", "./bench.sh");
    expect(prompt).toContain("/tmp/project");
    expect(prompt).toContain("/tmp/worktree");
    expect(prompt).toContain("./bench.sh");
  });
});
