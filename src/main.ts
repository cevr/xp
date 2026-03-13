import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { BunRuntime } from "@effect/platform-bun";
import { command } from "./commands/index.js";
import { AgentPlatformService } from "./services/AgentPlatform.js";
import { BudgetService } from "./services/Budget.js";
import { DaemonService } from "./services/Daemon.js";
import { ExperimentLogService } from "./services/ExperimentLog.js";
import { GitService } from "./services/Git.js";
import { LoopService } from "./services/Loop.js";
import { RunnerService } from "./services/Runner.js";
import { SessionService } from "./services/Session.js";
import { WorkspaceService } from "./services/Workspace.js";

const ServicesLayer = Layer.mergeAll(
  AgentPlatformService.layer,
  BudgetService.layer,
  DaemonService.layer,
  ExperimentLogService.layer,
  GitService.layer,
  RunnerService.layer,
  SessionService.layer,
).pipe(
  (layer) => Layer.provideMerge(layer, WorkspaceService.layer),
  (layer) => Layer.provideMerge(layer, LoopService.layer),
);

const cli = Command.toApp(command, {
  name: "xp",
  version: __VERSION__,
}).pipe(Effect.provide(ServicesLayer));

BunRuntime.runMain(cli);
