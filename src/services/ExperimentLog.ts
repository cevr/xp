import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { Effect, Layer, ServiceMap } from "effect";
import { XpError, ErrorCode } from "../errors/index.js";
import {
  decodeExperimentEvent,
  encodeExperimentEvent,
  type ExperimentEvent,
  type ExperimentState,
  type ResultEvent,
  type Session,
  type SteerEvent,
} from "../types.js";
import { xpPaths } from "../paths.js";
import { formatResultForLog } from "../prompt.js";

const reconstructFromEvents = (events: ReadonlyArray<ExperimentEvent>): ExperimentState => {
  let segment = 0;
  let iteration = 0;
  let baseline: ResultEvent | undefined;
  let best: ResultEvent | undefined;
  const results: Array<ResultEvent> = [];
  const steers: Array<SteerEvent> = [];
  let lastPendingResult: ResultEvent | undefined;
  let hasDecisionForLastPending = true;

  for (const event of events) {
    switch (event._tag) {
      case "config":
        segment = event.segment;
        break;
      case "result":
        iteration = Math.max(iteration, event.iteration);
        results.push(event);
        if (event.kind === "baseline" && event.status !== "failed") {
          baseline = event;
          if (!best) best = event;
        }
        if (event.status === "kept" && event.value !== undefined) {
          if (!best || (best.value !== undefined && event.value !== undefined)) {
            best = event;
          }
        }
        if (event.status === "pending") {
          lastPendingResult = event;
          hasDecisionForLastPending = false;
        }
        break;
      case "decision":
        iteration = Math.max(iteration, event.iteration);
        if (
          lastPendingResult &&
          lastPendingResult.iteration === event.iteration
        ) {
          hasDecisionForLastPending = true;
          // Update the result's status in our list
          const idx = results.findIndex(
            (r) => r.iteration === event.iteration && r.status === "pending",
          );
          if (idx !== -1) {
            const r = results[idx]!;
            results[idx] = new (r.constructor as typeof ResultEvent)({
              ...r,
              status: event.status,
            });
            if (event.status === "kept" && r.value !== undefined) {
              best = results[idx]!;
            }
          }
        }
        break;
      case "steer":
        steers.push(event);
        break;
      case "lifecycle":
        break;
    }
  }

  return {
    segment,
    iteration,
    baseline,
    best,
    results,
    steers,
    lastPendingResult,
    hasDecisionForLastPending,
  };
};

const generateMarkdown = (session: Session, state: ExperimentState): string => {
  const lines: Array<string> = [];
  lines.push(`# Experiment: ${session.name}`);
  lines.push("");
  lines.push(`**Objective**: ${session.objective}`);
  lines.push(`**Metric**: ${session.metric} (${session.unit}, ${session.direction})`);
  lines.push(`**Provider**: ${session.provider}`);
  lines.push(`**Segment**: ${state.segment} | **Iteration**: ${state.iteration}`);
  lines.push("");

  if (state.baseline) {
    lines.push(`## Baseline`);
    lines.push(formatResultForLog(state.baseline, session));
    lines.push("");
  }

  if (state.best && state.best !== state.baseline) {
    lines.push(`## Best Result`);
    lines.push(formatResultForLog(state.best, session));
    lines.push("");
  }

  const trials = state.results.filter((r) => r.kind === "trial");
  if (trials.length > 0) {
    lines.push(`## Trial History (${trials.length} total)`);
    for (const trial of trials.slice(-10)) {
      lines.push(formatResultForLog(trial, session));
    }
    lines.push("");
  }

  if (state.steers.length > 0) {
    lines.push(`## User Guidance`);
    for (const s of state.steers.slice(-5)) {
      lines.push(`- ${s.guidance}`);
    }
    lines.push("");
  }

  return lines.join("\n");
};

export class ExperimentLogService extends ServiceMap.Service<
  ExperimentLogService,
  {
    readonly append: (projectRoot: string, event: ExperimentEvent) => Effect.Effect<void, XpError>;
    readonly readAll: (projectRoot: string) => Effect.Effect<ReadonlyArray<ExperimentEvent>, XpError>;
    readonly reconstructState: (projectRoot: string) => Effect.Effect<ExperimentState, XpError>;
    readonly regenerateMarkdown: (
      projectRoot: string,
      session: Session,
    ) => Effect.Effect<void, XpError>;
  }
>()("@cvr/xp/services/ExperimentLog/ExperimentLogService") {
  static layer: Layer.Layer<ExperimentLogService> = Layer.succeed(ExperimentLogService, {
    append: (projectRoot, event) =>
      Effect.try({
        try: () => {
          const paths = xpPaths(projectRoot);
          const json = encodeExperimentEvent(event);
          appendFileSync(paths.experimentsJsonl, json + "\n");
        },
        catch: (e) =>
          new XpError({
            message: `Failed to append event: ${e}`,
            code: ErrorCode.WRITE_FAILED,
          }),
      }),

    readAll: (projectRoot) =>
      Effect.try({
        try: () => {
          const paths = xpPaths(projectRoot);
          if (!existsSync(paths.experimentsJsonl)) return [];
          const raw = readFileSync(paths.experimentsJsonl, "utf-8");
          return raw
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map(decodeExperimentEvent);
        },
        catch: (e) =>
          new XpError({
            message: `Failed to read experiment log: ${e}`,
            code: ErrorCode.READ_FAILED,
          }),
      }),

    reconstructState: (projectRoot) =>
      Effect.gen(function* () {
        const paths = xpPaths(projectRoot);
        if (!existsSync(paths.experimentsJsonl)) {
          return {
            segment: 0,
            iteration: 0,
            baseline: undefined,
            best: undefined,
            results: [],
            steers: [],
            lastPendingResult: undefined,
            hasDecisionForLastPending: true,
          };
        }
        const raw = readFileSync(paths.experimentsJsonl, "utf-8");
        const events = raw
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map(decodeExperimentEvent);
        return reconstructFromEvents(events);
      }),

    regenerateMarkdown: (projectRoot, session) =>
      Effect.gen(function* () {
        const paths = xpPaths(projectRoot);
        if (!existsSync(paths.experimentsJsonl)) return;
        const raw = readFileSync(paths.experimentsJsonl, "utf-8");
        const events = raw
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map(decodeExperimentEvent);
        const state = reconstructFromEvents(events);
        const md = generateMarkdown(session, state);
        writeFileSync(paths.experimentMd, md);
      }),
  });
}
