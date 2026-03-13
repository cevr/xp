import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Effect, Layer, ServiceMap } from "effect";
import { XpError, ErrorCode } from "../errors/index.js";
import {
  CommittedEvent,
  ConfigEvent,
  DecisionEvent,
  LifecycleEventEntry,
  ResultEvent,
  SteerEvent,
} from "../types.js";
import type { ExperimentState } from "../types.js";
import { xpPaths } from "../paths.js";
import { buildExperimentPrompt, buildSetupPrompt } from "../prompt.js";
import { shouldKeep } from "../scoring.js";
import { AgentPlatformService } from "./AgentPlatform.js";
import { BudgetService } from "./Budget.js";
import { ExperimentLogService } from "./ExperimentLog.js";
import { GitService } from "./Git.js";
import { RunnerService } from "./Runner.js";
import { SessionService } from "./Session.js";
import { WorkspaceService } from "./Workspace.js";

const now = () => new Date().toISOString();

const hashFiles = Effect.fn("hashFiles")(function* (files: ReadonlyArray<string>) {
  return yield* Effect.try({
    try: () => {
      const hash = createHash("sha256");
      for (const file of files) {
        if (existsSync(file)) {
          hash.update(readFileSync(file));
        }
      }
      return hash.digest("hex");
    },
    catch: (e) =>
      new XpError({
        message: `Failed to hash benchmark files: ${e}`,
        code: ErrorCode.BENCHMARK_FAILED,
      }),
  });
});

const parseBenchmarkFiles = (cmd: string, cwd: string): ReadonlyArray<string> => {
  // Extract file paths from the benchmark command
  // Heuristic: the last arg is usually the script file
  const parts = cmd.split(/\s+/);
  const files: Array<string> = [];
  for (const part of parts) {
    const resolved = join(cwd, part);
    if (existsSync(resolved)) {
      files.push(resolved);
    }
  }
  return files;
};

export class LoopService extends ServiceMap.Service<
  LoopService,
  {
    readonly run: (projectRoot: string) => Effect.Effect<void, XpError>;
  }
>()("@cvr/xp/services/Loop/LoopService") {
  static layer: Layer.Layer<
    LoopService,
    never,
    | AgentPlatformService
    | BudgetService
    | ExperimentLogService
    | GitService
    | RunnerService
    | SessionService
    | WorkspaceService
  > = Layer.effect(
    LoopService,
    Effect.gen(function* () {
      const agent = yield* AgentPlatformService;
      const budget = yield* BudgetService;
      const log = yield* ExperimentLogService;
      const git = yield* GitService;
      const runner = yield* RunnerService;
      const sessionSvc = yield* SessionService;
      const workspace = yield* WorkspaceService;

      return {
        run: (projectRoot) =>
          Effect.gen(function* () {
            const paths = xpPaths(projectRoot);

            // --- STARTUP ---
            yield* appendLifecycle(log, projectRoot, "started");
            let session = yield* sessionSvc.load(projectRoot);

            // Reconstruct state from JSONL
            let state = yield* log.reconstructState(projectRoot);

            // Reconciliation
            yield* reconcile(log, git, projectRoot, state);
            state = yield* log.reconstructState(projectRoot);

            // Ensure worktree
            const worktreePath = yield* workspace.setup(session);

            // Setup discovery if new session with no setup.json
            if (!existsSync(paths.setupJson) && state.iteration === 0) {
              yield* appendLifecycle(log, projectRoot, "setup_discover");
              const setupPrompt = buildSetupPrompt(projectRoot, worktreePath, session.benchmarkCmd);
              const setupResult = yield* agent.invoke(session.provider, setupPrompt, worktreePath);
              if (setupResult.stderr.trim()) {
                appendFileSync(
                  paths.daemonLog,
                  `[${now()}] setup agent stderr:\n${setupResult.stderr}\n`,
                );
              }
            } else if (existsSync(paths.setupJson)) {
              yield* appendLifecycle(log, projectRoot, "setup_replay");
            }

            // Freeze benchmark digest
            const benchmarkFiles = parseBenchmarkFiles(session.benchmarkCmd, worktreePath);
            const benchmarkDigest = yield* hashFiles(benchmarkFiles);
            writeFileSync(paths.benchmarkDigest, benchmarkDigest);
            yield* appendLifecycle(log, projectRoot, "benchmark_frozen");

            // Baseline if needed
            if (!state.baseline) {
              const baselineResult = yield* runner.run(session.benchmarkCmd, worktreePath);
              const sourceCommit = yield* git.headSha(worktreePath);

              if (baselineResult.exitCode !== 0) {
                return yield* new XpError({
                  message: `Baseline benchmark failed (exit ${baselineResult.exitCode}): ${baselineResult.stderr}`,
                  code: ErrorCode.BENCHMARK_FAILED,
                });
              }

              // Resolve metric: use session.metric if provided, otherwise auto-detect
              const metricNames = Object.keys(baselineResult.metrics);
              let resolvedMetric: string;

              if (session.metric) {
                // Explicit metric — verify it exists in output
                if (baselineResult.metrics[session.metric] === undefined) {
                  return yield* new XpError({
                    message: `Baseline benchmark did not emit METRIC ${session.metric}. Available: ${metricNames.join(", ")}`,
                    code: ErrorCode.METRIC_PARSE_FAILED,
                  });
                }
                resolvedMetric = session.metric;
              } else if (metricNames.length === 0) {
                return yield* new XpError({
                  message: "Baseline benchmark did not emit any METRIC lines",
                  code: ErrorCode.METRIC_PARSE_FAILED,
                });
              } else if (metricNames.length === 1) {
                // Single metric — auto-select
                resolvedMetric = metricNames[0] as string;
                yield* Effect.log(`Auto-detected metric: ${resolvedMetric}`);
              } else {
                return yield* new XpError({
                  message: `Multiple metrics found, specify one with --metric: ${metricNames.join(", ")}`,
                  code: ErrorCode.METRIC_PARSE_FAILED,
                });
              }

              const metricValue = baselineResult.metrics[resolvedMetric] as number;

              // Persist resolved metric back to session if it was auto-detected
              if (!session.metric) {
                session = yield* sessionSvc.update(projectRoot, { metric: resolvedMetric });
              }

              // Log config event
              yield* log.append(
                projectRoot,
                new ConfigEvent({
                  _tag: "config",
                  timestamp: now(),
                  segment: session.segment,
                  name: session.name,
                  metric: resolvedMetric,
                  unit: session.unit,
                  direction: session.direction,
                  provider: session.provider,
                  sourceCommit,
                  benchmarkCmd: session.benchmarkCmd,
                  benchmarkDigest,
                }),
              );

              // Log baseline result
              yield* log.append(
                projectRoot,
                new ResultEvent({
                  _tag: "result",
                  timestamp: now(),
                  segment: session.segment,
                  iteration: 0,
                  kind: "baseline",
                  status: "kept",
                  value: metricValue,
                  metrics: baselineResult.metrics,
                  durationMs: baselineResult.durationMs,
                  summary: "Baseline measurement",
                  commit: sourceCommit,
                }),
              );

              yield* sessionSvc.update(projectRoot, {
                bestValue: metricValue,
                bestCommit: sourceCommit,
              });

              state = yield* log.reconstructState(projectRoot);
            }

            // After baseline, metric is always resolved (either from flag or auto-detected)
            // Reload session to pick up any auto-detected metric
            session = yield* sessionSvc.load(projectRoot);
            const resolvedMetric = session.metric as string;

            // Compute benchmark timeout: 5x baseline duration, minimum 30s
            const benchmarkTimeoutMs = state.baseline
              ? Math.max(state.baseline.durationMs * 5, 30_000)
              : undefined;

            yield* log.regenerateMarkdown(projectRoot, session);

            // --- LOOP ---
            while (true) {
              const budgetCheck = yield* budget.check(session, state);
              if (!budgetCheck.canContinue) {
                yield* appendLifecycle(log, projectRoot, "budget_exhausted", budgetCheck.reason);
                yield* log.regenerateMarkdown(projectRoot, session);
                break;
              }

              // Consume steers
              const steers = yield* consumeSteers(paths.steerDir, session.segment, state.iteration);
              for (const steer of steers) {
                yield* log.append(projectRoot, steer);
              }

              // Verify benchmark integrity
              const currentDigest = yield* hashFiles(benchmarkFiles);
              const storedDigest = readFileSync(paths.benchmarkDigest, "utf-8");
              if (currentDigest !== storedDigest) {
                return yield* new XpError({
                  message: "Benchmark files were tampered with",
                  code: ErrorCode.BENCHMARK_TAMPERED,
                });
              }

              // Build prompt and invoke agent
              const allSteers = [...state.steers, ...steers];
              const prompt = buildExperimentPrompt(
                session,
                state,
                worktreePath,
                projectRoot,
                allSteers,
              );

              const agentResult = yield* agent.invoke(session.provider, prompt, worktreePath);

              // Log agent stderr for debugging
              if (agentResult.stderr.trim()) {
                const logLine = `[${now()}] iter ${state.iteration + 1} agent stderr:\n${agentResult.stderr}\n`;
                appendFileSync(paths.daemonLog, logLine);
              }

              const nextIteration = state.iteration + 1;

              // Agent failed — revert and log
              if (agentResult.exitCode !== 0) {
                yield* git.revertWorktree(worktreePath);
                yield* log.append(
                  projectRoot,
                  new ResultEvent({
                    _tag: "result",
                    timestamp: now(),
                    segment: session.segment,
                    iteration: nextIteration,
                    kind: "trial",
                    status: "failed",
                    durationMs: agentResult.durationMs,
                    summary: `Agent exited with code ${agentResult.exitCode}`,
                  }),
                );
                yield* sessionSvc.update(projectRoot, { currentIteration: nextIteration });
                state = yield* log.reconstructState(projectRoot);
                yield* log.regenerateMarkdown(projectRoot, session);
                continue;
              }

              // Check if agent made changes
              const isWorktreeClean = yield* git.isClean(worktreePath);

              if (isWorktreeClean) {
                yield* log.append(
                  projectRoot,
                  new ResultEvent({
                    _tag: "result",
                    timestamp: now(),
                    segment: session.segment,
                    iteration: nextIteration,
                    kind: "trial",
                    status: "discarded",
                    durationMs: agentResult.durationMs,
                    summary: "No changes made by agent",
                  }),
                );
                yield* sessionSvc.update(projectRoot, { currentIteration: nextIteration });
                state = yield* log.reconstructState(projectRoot);
                yield* log.regenerateMarkdown(projectRoot, session);
                continue;
              }

              // Capture diff
              const diffOutput = yield* git.diff(worktreePath);

              // Write pending result
              yield* log.append(
                projectRoot,
                new ResultEvent({
                  _tag: "result",
                  timestamp: now(),
                  segment: session.segment,
                  iteration: nextIteration,
                  kind: "trial",
                  status: "pending",
                  durationMs: agentResult.durationMs,
                  summary: agentResult.output.slice(0, 200),
                  diff: diffOutput.slice(0, 1000),
                }),
              );

              // Run benchmark
              const benchResult = yield* runner
                .run(session.benchmarkCmd, worktreePath, benchmarkTimeoutMs)
                .pipe(
                  Effect.catchTag("XpError", (e) =>
                    Effect.succeed({
                      exitCode: 1,
                      stdout: "",
                      stderr: e.message,
                      durationMs: 0,
                      metrics: {} as Record<string, number>,
                    }),
                  ),
                );

              const bestValue = state.best?.value;

              if (benchResult.exitCode !== 0) {
                // Benchmark failed — revert
                yield* git.revertWorktree(worktreePath);
                yield* log.append(
                  projectRoot,
                  new DecisionEvent({
                    _tag: "decision",
                    timestamp: now(),
                    segment: session.segment,
                    iteration: nextIteration,
                    status: "failed",
                  }),
                );
              } else {
                const metricValue = benchResult.metrics[resolvedMetric];

                if (
                  metricValue !== undefined &&
                  bestValue !== undefined &&
                  shouldKeep(session.direction, metricValue, bestValue)
                ) {
                  // Keep — commit
                  const sha = yield* git.commitInWorktree(
                    worktreePath,
                    `xp(${session.name}): iter ${nextIteration} — ${resolvedMetric}=${metricValue}`,
                  );
                  // Write committed event before decision — crash recovery uses this
                  yield* log.append(
                    projectRoot,
                    new CommittedEvent({
                      _tag: "committed",
                      timestamp: now(),
                      segment: session.segment,
                      iteration: nextIteration,
                      commit: sha,
                    }),
                  );
                  yield* log.append(
                    projectRoot,
                    new DecisionEvent({
                      _tag: "decision",
                      timestamp: now(),
                      segment: session.segment,
                      iteration: nextIteration,
                      status: "kept",
                      value: metricValue,
                      metrics: benchResult.metrics,
                    }),
                  );
                  yield* sessionSvc.update(projectRoot, {
                    currentIteration: nextIteration,
                    bestValue: metricValue,
                    bestCommit: sha,
                  });
                } else {
                  // Discard — revert
                  yield* git.revertWorktree(worktreePath);
                  yield* log.append(
                    projectRoot,
                    new DecisionEvent({
                      _tag: "decision",
                      timestamp: now(),
                      segment: session.segment,
                      iteration: nextIteration,
                      status: "discarded",
                      value: metricValue,
                      metrics: benchResult.metrics,
                    }),
                  );
                  yield* sessionSvc.update(projectRoot, {
                    currentIteration: nextIteration,
                  });
                }
              }

              state = yield* log.reconstructState(projectRoot);
              yield* log.regenerateMarkdown(projectRoot, session);
            }

            // Clean exit
            yield* appendLifecycle(log, projectRoot, "paused");
          }),
      };
    }),
  );
}

const appendLifecycle = Effect.fn("appendLifecycle")(function* (
  log: ServiceMap.Service.Shape<typeof ExperimentLogService>,
  projectRoot: string,
  event: LifecycleEventEntry["event"],
  detail?: string,
) {
  yield* log.append(
    projectRoot,
    new LifecycleEventEntry({
      _tag: "lifecycle",
      timestamp: now(),
      event,
      detail,
    }),
  );
});

const consumeSteers = Effect.fn("consumeSteers")(function* (
  steerDir: string,
  segment: number,
  iteration: number,
) {
  return yield* Effect.try({
    try: () => {
      if (!existsSync(steerDir)) return [] as ReadonlyArray<SteerEvent>;
      const files = readdirSync(steerDir)
        .filter((f) => f.endsWith(".txt"))
        .sort();
      const steers: Array<SteerEvent> = [];
      for (const file of files) {
        const content = readFileSync(join(steerDir, file), "utf-8").trim();
        if (content) {
          steers.push(
            new SteerEvent({
              _tag: "steer",
              timestamp: now(),
              segment,
              iteration,
              guidance: content,
            }),
          );
        }
        unlinkSync(join(steerDir, file));
      }
      return steers as ReadonlyArray<SteerEvent>;
    },
    catch: (e) =>
      new XpError({
        message: `Failed to consume steers: ${e}`,
        code: ErrorCode.READ_FAILED,
      }),
  });
});

const reconcile = Effect.fn("reconcile")(function* (
  log: ServiceMap.Service.Shape<typeof ExperimentLogService>,
  git: ServiceMap.Service.Shape<typeof GitService>,
  projectRoot: string,
  state: ExperimentState,
) {
  if (!state.lastPendingResult || state.hasDecisionForLastPending) return;

  const paths = xpPaths(projectRoot);
  const worktreePath = paths.worktree;

  if (!existsSync(worktreePath)) {
    yield* appendLifecycle(log, projectRoot, "recovery", "Worktree missing during reconciliation");
    return;
  }

  const pendingCommit = state.lastPendingCommit;

  if (pendingCommit) {
    // A committed event exists — the commit was made before crash
    const headSha = yield* git.headSha(worktreePath);
    if (headSha === pendingCommit) {
      // HEAD matches committed SHA — finalize as kept
      yield* log.append(
        projectRoot,
        new DecisionEvent({
          _tag: "decision",
          timestamp: now(),
          segment: state.segment,
          iteration: state.lastPendingResult.iteration,
          status: "kept",
        }),
      );
    } else {
      // HEAD diverged — finalize as discarded, revert
      yield* git.revertWorktree(worktreePath);
      yield* log.append(
        projectRoot,
        new DecisionEvent({
          _tag: "decision",
          timestamp: now(),
          segment: state.segment,
          iteration: state.lastPendingResult.iteration,
          status: "discarded",
        }),
      );
    }
  } else {
    // No committed event — crash happened before commit, discard
    yield* git.revertWorktree(worktreePath);
    yield* log.append(
      projectRoot,
      new DecisionEvent({
        _tag: "decision",
        timestamp: now(),
        segment: state.segment,
        iteration: state.lastPendingResult.iteration,
        status: "discarded",
      }),
    );
  }

  yield* appendLifecycle(log, projectRoot, "recovery", "Reconciled pending result");
});
