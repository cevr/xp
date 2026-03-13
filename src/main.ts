import { Console, Effect, Layer, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { command } from "./commands/index.js";
import { XpError } from "./errors/index.js";
import { AgentPlatformService } from "./services/AgentPlatform.js";
import { BudgetService } from "./services/Budget.js";
import { DaemonService } from "./services/Daemon.js";
import { ExperimentLogService } from "./services/ExperimentLog.js";
import { GitService } from "./services/Git.js";
import { LoopService } from "./services/Loop.js";
import { RunnerService } from "./services/Runner.js";
import { SessionService } from "./services/Session.js";
import { WorkspaceService } from "./services/Workspace.js";

const isXpError = Schema.is(XpError);

// Base services with no inter-service dependencies
const BaseLayer = Layer.mergeAll(
  AgentPlatformService.layer,
  BudgetService.layer,
  DaemonService.layer,
  ExperimentLogService.layer,
  GitService.layer,
  RunnerService.layer,
  SessionService.layer,
);

// WorkspaceService depends on GitService
// LoopService depends on all other services
// WorkspaceService needs GitService, LoopService needs everything
// Layer.provideMerge(deps) = deps feeds self, output = self + deps
const ServicesLayer = LoopService.layer.pipe(
  Layer.provideMerge(WorkspaceService.layer.pipe(Layer.provideMerge(BaseLayer))),
  Layer.provideMerge(BunServices.layer),
);

const cli = Command.run(command, {
  version: typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev",
});

const program = cli.pipe(
  Effect.tapDefect((defect) => Console.error(`Internal error: ${String(defect)}`)),
  Effect.tapCause((cause) =>
    Effect.gen(function* () {
      for (const reason of cause.reasons) {
        if (reason._tag !== "Fail") continue;
        const err = reason.error;
        if (!isXpError(err)) continue;
        yield* Console.error(`[${err.code}] ${err.message}`);
      }
    }),
  ),
);

// @effect-diagnostics-next-line effect/strictEffectProvide:off
BunRuntime.runMain(program.pipe(Effect.provide(ServicesLayer)), { disableErrorReporting: true });
