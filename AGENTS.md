# xp

Autonomous experiment daemon. Effect v4 + Bun CLI.

## Commands

```bash
bun run gate          # typecheck + lint + fmt + test + build (parallel)
bun run dev           # run from source
bun run build         # compile binary to bin/xp
```

## Code Conventions

- Effect v4 (`effect-smol`): `ServiceMap.Service`, `Schema.TaggedErrorClass`, `Effect.fn`, `Schema.TaggedStruct`
- Services follow `static layer` / `static layerTest` pattern
- All side-effectful functions must be `Effect.fn` or return `Effect.Effect`
- `XpError` with literal `code` union — single error class, discriminate via `.code`
- JSONL event sourcing: `experiments.jsonl` is source of truth, state reconstructed on startup
- `_loop` command is internal — guarded by `XP_INTERNAL=1` env var

## Architecture Decisions

- Two-phase commit protocol: `result(pending)` → `committed(sha)` → `decision(kept|discarded|failed)`. The `committed` event is crash recovery evidence — without it, reconciliation discards
- Benchmark integrity: files hashed at baseline, verified each iteration. Timeout = 5x baseline duration (min 30s)
- Agent timeout: 10min default, `--max-turns 20` for claude
- Shell execution: `sh -c` for benchmark commands (supports quotes, pipes, env vars)
- Revert semantics: `git reset --hard HEAD && git clean -fd` (not checkout — must clear index)
- `git diff HEAD` (not `git diff`) to capture both staged and unstaged changes

## Testing

- Tests use `bun:test` (not vitest)
- `ExperimentState` has `lastPendingCommit` field — include in test fixtures
- `GitService.layerTest` provides noop implementations for all git operations

## LSP

`@effect/language-service` patched in `prepare` script. All rules enabled except `strictBooleanExpressions`.
`preferSchemaOverJson` suppressed inline for `--json` CLI output (legitimate `JSON.stringify`).
