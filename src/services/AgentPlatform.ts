import { existsSync } from "node:fs";
import { Effect, Layer, ServiceMap } from "effect";
import { XpError, ErrorCode } from "../errors/index.js";
import { AgentResult } from "../types.js";
import type { Provider } from "../types.js";

const resolveExecutable = (name: string): string => {
  const path = Bun.which(name);
  if (path) return path;
  // Fallback: check common locations when PATH is incomplete (e.g. daemon context)
  const home = process.env["HOME"] ?? "";
  const candidates = [
    `${home}/.bun/bin/${name}`,
    `/usr/local/bin/${name}`,
    `${home}/.local/bin/${name}`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return name;
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

          const args =
            provider === "claude"
              ? [
                  resolveExecutable("claude"),
                  "-p",
                  prompt,
                  "--dangerously-skip-permissions",
                  "--model",
                  "opus",
                  "--no-session-persistence",
                  "--output-format",
                  "text",
                ]
              : [
                  resolveExecutable("codex"),
                  "exec",
                  "-C",
                  cwd,
                  "--dangerously-bypass-approvals-and-sandbox",
                  "--skip-git-repo-check",
                  "-c",
                  "model_reasoning_effort=xhigh",
                  prompt,
                ];

          // Strip env vars that prevent nested agent sessions
          const env = { ...process.env };
          delete env["CLAUDECODE"];
          delete env["CLAUDE_CODE_ENTRYPOINT"];

          const proc = Bun.spawn(args, {
            stdout: "pipe",
            stderr: "pipe",
            cwd,
            env,
          });

          const [output, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);

          const durationMs = Date.now() - start;
          return new AgentResult({ exitCode, output, stderr, durationMs });
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
        const resolved = resolveExecutable(name);
        if (resolved === name && !Bun.which(name)) {
          throw new XpError({
            message: `${name} not found in PATH. Install it first.`,
            code: ErrorCode.AGENT_FAILED,
          });
        }
        return resolved;
      }),
  });
}
