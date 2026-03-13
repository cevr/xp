import { Effect, Layer, ServiceMap } from "effect";
import { XpError, ErrorCode } from "../errors/index.js";
import { BenchmarkResult } from "../types.js";

const METRIC_RE = /^METRIC\s+([a-zA-Z_][a-zA-Z0-9_]*)=([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/;

const parseMetrics = (stdout: string): Record<string, number> => {
  const metrics: Record<string, number> = {};
  for (const line of stdout.split("\n")) {
    const match = METRIC_RE.exec(line.trim());
    if (match !== null) {
      const name = match[1];
      const rawValue = match[2];
      if (name !== undefined && rawValue !== undefined) {
        const value = Number(rawValue);
        if (!Number.isNaN(value)) {
          metrics[name] = value;
        }
      }
    }
  }
  return metrics;
};

export class RunnerService extends ServiceMap.Service<
  RunnerService,
  {
    readonly run: (
      cmd: string,
      cwd: string,
      timeoutMs?: number,
    ) => Effect.Effect<BenchmarkResult, XpError>;
  }
>()("@cvr/xp/services/Runner/RunnerService") {
  static layer: Layer.Layer<RunnerService> = Layer.succeed(RunnerService, {
    run: (cmd, cwd, timeoutMs) => {
      const execute = Effect.tryPromise({
        try: async () => {
          const start = Date.now();
          const proc = Bun.spawn(["sh", "-c", cmd], {
            stdout: "pipe",
            stderr: "pipe",
            cwd,
          });

          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);

          const durationMs = Date.now() - start;
          const metrics = parseMetrics(stdout);

          return new BenchmarkResult({
            stdout,
            stderr,
            exitCode,
            durationMs,
            metrics,
          });
        },
        catch: (e) =>
          new XpError({
            message: `Benchmark execution failed: ${e instanceof Error ? e.message : String(e)}`,
            code: ErrorCode.BENCHMARK_FAILED,
          }),
      });

      if (timeoutMs !== undefined) {
        return execute.pipe(
          Effect.timeout(`${timeoutMs} millis`),
          Effect.catchTag("TimeoutError", () =>
            Effect.fail(
              new XpError({
                message: `Benchmark timed out after ${timeoutMs}ms`,
                code: ErrorCode.BENCHMARK_TIMEOUT,
              }),
            ),
          ),
        );
      }

      return execute;
    },
  });
}

export { parseMetrics };
