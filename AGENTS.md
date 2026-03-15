# xp

Autonomous experiment daemon. Effect v4 + Bun CLI.

## Commands

```bash
bun run gate          # typecheck + lint + fmt + test + build (parallel)
bun run dev           # run from source
bun run build         # compile binary to bin/xp
```

## CLI Surface

Required flags: `--direction`, `--benchmark`, `--objective`. Everything else optional.

- `--name` defaults to `basename(cwd)`
- `--model` removed — hardcoded `opus` in `AgentPlatform.ts`
- `--max-minutes` — wall-clock budget (computed as absolute deadline internally)
- `--until` — absolute deadline as ISO date or datetime (mutually exclusive with `--max-minutes`)

## Benchmark Contract

Benchmark must emit exactly one `RESULT <number>` line to stdout:

```
RESULT 42.5
```

- Zero RESULT lines → error
- Multiple RESULT lines → error (progress output belongs in stderr)
- Regex: `^RESULT\s+([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$`

## Code Conventions

- Effect v4 (`effect-smol`): `ServiceMap.Service`, `Schema.TaggedErrorClass`, `Effect.fn`, `Schema.TaggedStruct`
- Services follow `static layer` / `static layerTest` pattern
- All side-effectful functions must be `Effect.fn` or return `Effect.Effect`
- `XpError` with literal `code` union — single error class, discriminate via `.code`
- JSONL event sourcing: `experiments.jsonl` is source of truth, state reconstructed on startup
- `_loop` command is internal — guarded by `XP_INTERNAL=1` env var
- oxlint forbids `!` non-null assertions — use `as T` with length/existence guards instead

## Architecture Decisions

- Single-value benchmark contract: `RESULT <number>`. One number in, one number out. No metric names, no maps, no auto-detection
- Two-phase commit protocol: `result(pending)` → `committed(sha)` → `decision(kept|discarded|failed)`. The `committed` event is crash recovery evidence — without it, reconciliation discards
- Benchmark integrity: files hashed at baseline, verified each iteration. Timeout = 5x baseline duration (min 30s)
- Agent timeout: 10min default, `--max-turns 20` for claude
- Shell execution: `sh -c` for benchmark commands (supports quotes, pipes, env vars)
- Revert semantics: `git reset --hard HEAD && git clean -fd` (not checkout — must clear index)
- `git diff HEAD` (not `git diff`) to capture both staged and unstaged changes
- Time budget stored as `deadline` (absolute ISO 8601 string), not relative duration — cleaner recovery semantics after crash

## Gotchas

- `git worktree prune` runs automatically in `Workspace.setup` — stale worktrees from killed daemons self-heal
- Setup discovery (first agent call) takes 20-60s; baseline runs immediately after
- `xp stop` cleans pid file but not worktree — intentional, preserves branch state for resume

## Testing

- Tests use `bun:test` (not vitest)
- `ExperimentState` has `lastPendingCommit` field — include in test fixtures
- `GitService.layerTest` provides noop implementations for all git operations

## LSP

`@effect/language-service` patched in `prepare` script. All rules enabled except `strictBooleanExpressions`.
`preferSchemaOverJson` suppressed inline for `--json` CLI output (legitimate `JSON.stringify`).
