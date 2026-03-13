import { Effect, Layer, ServiceMap } from "effect";
import { XpError, ErrorCode } from "../errors/index.js";
import { AgentResult } from "../types.js";
import type { Provider } from "../types.js";

const claudeArgs = (prompt: string): Array<string> => [
  "claude",
  "-p",
  prompt,
  "--dangerously-skip-permissions",
  "--model",
  "opus",
  "--no-session-persistence",
  "--output-format",
  "text",
];

const codexArgs = (prompt: string, cwd: string): Array<string> => [
  "codex",
  "exec",
  "-C",
  cwd,
  "--dangerously-bypass-approvals-and-sandbox",
  "--skip-git-repo-check",
  "-c",
  "model_reasoning_effort=xhigh",
  prompt,
];

const providerArgs: Record<Provider, (prompt: string, cwd: string) => Array<string>> = {
  claude: (prompt) => claudeArgs(prompt),
  codex: (prompt, cwd) => codexArgs(prompt, cwd),
};

export class AgentPlatformService extends ServiceMap.Service<
  AgentPlatformService,
  {
    readonly invoke: (
      provider: Provider,
      prompt: string,
      cwd: string,
    ) => Effect.Effect<AgentResult, XpError>;
    readonly ensureExecutable: (provider: Provider) => Effect.Effect<string, XpError>;
  }
>()("@cvr/xp/services/AgentPlatform/AgentPlatformService") {
  static layer: Layer.Layer<AgentPlatformService> = Layer.succeed(AgentPlatformService, {
    invoke: (provider, prompt, cwd) =>
      Effect.tryPromise({
        try: async () => {
          const start = Date.now();
          const args = providerArgs[provider](prompt, cwd);
          const proc = Bun.spawn(args, {
            stdout: "pipe",
            stderr: "pipe",
            cwd,
          });

          const [output, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            proc.exited,
          ]);

          const durationMs = Date.now() - start;
          return new AgentResult({ exitCode, output, durationMs });
        },
        catch: (e) =>
          new XpError({
            message: `${provider} invocation failed: ${e instanceof Error ? e.message : String(e)}`,
            code: ErrorCode.AGENT_FAILED,
          }),
      }),

    ensureExecutable: (provider) =>
      Effect.sync(() => {
        const name = provider === "claude" ? "claude" : "codex";
        const path = Bun.which(name);
        if (!path) {
          throw new XpError({
            message: `${name} not found in PATH. Install it first.`,
            code: ErrorCode.AGENT_FAILED,
          });
        }
        return path;
      }),
  });
}
