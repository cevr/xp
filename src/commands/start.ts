import { basename } from "node:path";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { Session } from "../types.js";
import { SessionService } from "../services/Session.js";
import { DaemonService } from "../services/Daemon.js";
import { AgentPlatformService } from "../services/AgentPlatform.js";
import { xpPaths } from "../paths.js";
import { mkdirSync } from "node:fs";

export const startCommand = Command.make(
  "start",
  {
    name: Flag.string("name").pipe(
      Flag.optional,
      Flag.withDescription("Experiment name (default: directory name)"),
    ),
    metric: Flag.string("metric").pipe(
      Flag.optional,
      Flag.withDescription("Metric name to optimize (auto-detected if single metric)"),
    ),
    unit: Flag.string("unit").pipe(Flag.withDefault(""), Flag.withDescription("Metric unit")),
    direction: Flag.choice("direction", ["min", "max"]).pipe(
      Flag.withDescription("Optimization direction"),
    ),
    benchmark: Flag.string("benchmark").pipe(Flag.withDescription("Benchmark command to run")),
    objective: Flag.string("objective").pipe(
      Flag.withDescription("Optimization objective description"),
    ),
    maxIterations: Flag.integer("max-iterations").pipe(
      Flag.withDefault(50),
      Flag.withDescription("Maximum iterations"),
    ),
    maxFailures: Flag.integer("max-failures").pipe(
      Flag.withDefault(5),
      Flag.withDescription("Maximum consecutive failures before stopping"),
    ),
    provider: Flag.choice("provider", ["claude", "codex"]).pipe(
      Flag.withDefault("claude" as const),
      Flag.withDescription("Agent provider"),
    ),
    maxMinutes: Flag.integer("max-minutes").pipe(
      Flag.optional,
      Flag.withDescription("Maximum wall-clock runtime in minutes"),
    ),
  },
  ({
    name: nameOpt,
    metric: metricOpt,
    unit,
    direction,
    benchmark,
    objective,
    maxIterations,
    maxFailures,
    provider,
    maxMinutes,
  }) =>
    Effect.gen(function* () {
      const sessionSvc = yield* SessionService;
      const daemon = yield* DaemonService;
      const agentPlatform = yield* AgentPlatformService;

      const projectRoot = process.cwd();
      const paths = xpPaths(projectRoot);

      // Ensure .xp directory exists
      mkdirSync(paths.xpDir, { recursive: true });

      const name = Option.getOrElse(nameOpt, () => basename(projectRoot));

      // Check if resuming
      const exists = yield* sessionSvc.exists(projectRoot);
      if (exists) {
        // Resume existing session
        const session = yield* sessionSvc.load(projectRoot);
        yield* Console.log(`Resuming experiment: ${session.name}`);

        const isRunning = yield* daemon.isRunning(projectRoot);
        if (isRunning) {
          yield* Console.log("Daemon already running.");
          return;
        }

        yield* agentPlatform.ensureExecutable(session.provider);
        const pid = yield* daemon.start(projectRoot);
        yield* Console.log(`Daemon started (pid ${pid})`);
        return;
      }

      // Validate provider is available
      yield* agentPlatform.ensureExecutable(provider as "claude" | "codex");

      const maxWallClockMs = Option.map(maxMinutes, (m) => m * 60 * 1000).pipe(
        Option.getOrUndefined,
      );

      const metric = Option.getOrUndefined(metricOpt);

      const session = new Session({
        name,
        metric,
        unit,
        direction: direction as "min" | "max",
        provider: provider as "claude" | "codex",
        objective,
        benchmarkCmd: benchmark,
        maxIterations,
        maxFailures,
        maxWallClockMs,
        projectRoot,
        segment: 1,
        currentIteration: 0,
        createdAt: new Date().toISOString(),
      });

      yield* sessionSvc.init(session);
      yield* Console.log(`Experiment "${name}" initialized.`);
      if (metric) {
        yield* Console.log(`  metric: ${metric} (${direction})`);
      } else {
        yield* Console.log(`  metric: auto-detect (${direction})`);
      }
      yield* Console.log(`  benchmark: ${benchmark}`);
      yield* Console.log(`  provider: ${provider}`);
      yield* Console.log(`  max iterations: ${maxIterations}`);
      if (maxWallClockMs !== undefined) {
        yield* Console.log(`  max minutes: ${Option.getOrElse(maxMinutes, () => 0)}`);
      }

      yield* Console.log(`Starting daemon...`);
      const pid = yield* daemon.start(projectRoot);
      yield* Console.log(`Daemon started (pid ${pid})`);
      yield* Console.log(`Tip: run 'xp logs -f' to watch progress`);
    }),
).pipe(Command.withDescription("Initialize and start an experiment"));
