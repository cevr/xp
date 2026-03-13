import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { LoopService } from "../services/Loop.js";
import { DaemonService } from "../services/Daemon.js";

export const loopCommand = Command.make(
  "_loop",
  {
    projectRoot: Flag.string("project-root").pipe(
      Flag.withDescription("Project root directory"),
    ),
  },
  ({ projectRoot }) =>
    Effect.gen(function* () {
      const loop = yield* LoopService;
      const daemon = yield* DaemonService;

      // Write own pid
      yield* daemon.writePid(projectRoot, process.pid);

      // Set up SIGTERM handler
      const controller = new AbortController();
      process.on("SIGTERM", () => {
        console.log("Received SIGTERM, shutting down...");
        controller.abort();
      });

      // Run loop (will be interrupted by SIGTERM via fiber interrupt)
      yield* loop.run(projectRoot).pipe(
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* daemon.cleanPid(projectRoot);
          }),
        ),
      );

      yield* daemon.cleanPid(projectRoot);
    }),
).pipe(Command.withDescription("Internal: run the experiment loop"));
