import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from "node:fs";
import { Effect, Layer, ServiceMap } from "effect";
import { XpError, ErrorCode } from "../errors/index.js";
import { xpPaths } from "../paths.js";

export interface DaemonStatus {
  readonly running: boolean;
  readonly pid?: number;
}

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export class DaemonService extends ServiceMap.Service<
  DaemonService,
  {
    readonly start: (projectRoot: string) => Effect.Effect<number, XpError>;
    readonly stop: (projectRoot: string) => Effect.Effect<void, XpError>;
    readonly status: (projectRoot: string) => Effect.Effect<DaemonStatus>;
    readonly isRunning: (projectRoot: string) => Effect.Effect<boolean>;
    readonly writePid: (projectRoot: string, pid: number) => Effect.Effect<void, XpError>;
    readonly cleanPid: (projectRoot: string) => Effect.Effect<void>;
  }
>()("@cvr/xp/services/Daemon/DaemonService") {
  static layer: Layer.Layer<DaemonService> = Layer.succeed(DaemonService, {
    start: (projectRoot) =>
      Effect.gen(function* () {
        const paths = xpPaths(projectRoot);

        // Check for stale pid
        if (existsSync(paths.daemonPid)) {
          const existingPid = Number(readFileSync(paths.daemonPid, "utf-8").trim());
          if (isProcessRunning(existingPid)) {
            return yield* new XpError({
              message: `Daemon already running (pid ${existingPid})`,
              code: ErrorCode.DAEMON_ALREADY_RUNNING,
            });
          }
          // Stale pid file — clean up
          unlinkSync(paths.daemonPid);
        }

        // Open log file for daemon output
        const logFd = openSync(paths.daemonLog, "a");

        // Spawn detached xp _loop process
        const selfPath = process.argv[1] ?? "xp";
        const proc = Bun.spawn([selfPath, "_loop", "--project-root", projectRoot], {
          stdout: logFd,
          stderr: logFd,
          cwd: projectRoot,
        });

        closeSync(logFd);

        // Detach so parent can exit
        proc.unref();

        const pid = proc.pid;
        writeFileSync(paths.daemonPid, String(pid));
        return pid;
      }),

    stop: (projectRoot) =>
      Effect.gen(function* () {
        const paths = xpPaths(projectRoot);
        if (!existsSync(paths.daemonPid)) {
          return yield* new XpError({
            message: "No daemon running (no pid file)",
            code: ErrorCode.DAEMON_NOT_RUNNING,
          });
        }

        const pid = Number(readFileSync(paths.daemonPid, "utf-8").trim());
        if (!isProcessRunning(pid)) {
          unlinkSync(paths.daemonPid);
          return yield* new XpError({
            message: `Daemon not running (stale pid ${pid})`,
            code: ErrorCode.DAEMON_NOT_RUNNING,
          });
        }

        process.kill(pid, "SIGTERM");
        unlinkSync(paths.daemonPid);
      }),

    status: (projectRoot) =>
      Effect.sync(() => {
        const paths = xpPaths(projectRoot);
        if (!existsSync(paths.daemonPid)) return { running: false };
        const pid = Number(readFileSync(paths.daemonPid, "utf-8").trim());
        if (!isProcessRunning(pid)) return { running: false };
        return { running: true, pid };
      }),

    isRunning: (projectRoot) =>
      Effect.sync(() => {
        const paths = xpPaths(projectRoot);
        if (!existsSync(paths.daemonPid)) return false;
        const pid = Number(readFileSync(paths.daemonPid, "utf-8").trim());
        return isProcessRunning(pid);
      }),

    writePid: (projectRoot, pid) =>
      Effect.try({
        try: () => writeFileSync(xpPaths(projectRoot).daemonPid, String(pid)),
        catch: (e) =>
          new XpError({
            message: `Failed to write pid file: ${e}`,
            code: ErrorCode.WRITE_FAILED,
          }),
      }),

    cleanPid: (projectRoot) =>
      Effect.sync(() => {
        const paths = xpPaths(projectRoot);
        if (existsSync(paths.daemonPid)) unlinkSync(paths.daemonPid);
      }),
  });
}
