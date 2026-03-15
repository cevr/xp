# @cvr/xp

## 0.1.0

### Minor Changes

- [`d4b5cdf`](https://github.com/cevr/xp/commit/d4b5cdfbd00628e4aebb858636dccb11aaf5504b) Thanks [@cevr](https://github.com/cevr)! - Simplify `start` command flag surface: 5 required → 3
  - `--metric` optional — auto-detected from baseline when benchmark emits single metric
  - `--name` changed from positional arg to optional flag, defaults to `basename(cwd)`
  - `--max-run` renamed to `--max-minutes`
  - `--model` removed — hardcoded `opus` in AgentPlatform
  - Auto-prune stale git worktrees on startup (self-healing after crashed daemons)

- [`17c91f1`](https://github.com/cevr/xp/commit/17c91f1575ea195be101dd18ce088ba8beaf6cef) Thanks [@cevr](https://github.com/cevr)! - Simplify benchmark contract to single-value `RESULT <number>` and add `--until` deadline flag
  - Replace `METRIC name=value` with `RESULT <number>` — one number in, one number out
  - Remove `--metric` flag, `session.metric`, metric resolution logic, `Record<string, number>` maps
  - Multiple RESULT lines are an error (not "last wins")
  - Add `--until <date>` flag for absolute deadlines (mutually exclusive with `--max-minutes`)
  - Store time budget as absolute ISO 8601 `deadline` instead of relative `maxWallClockMs`
  - Date-only `--until` values normalized to EOD local time
  - Rename error code `METRIC_PARSE_FAILED` → `RESULT_PARSE_FAILED`

### Patch Changes

- [`ef981fd`](https://github.com/cevr/xp/commit/ef981fddff1b159130fc847ceac6b6ee965da9d9) Thanks [@cevr](https://github.com/cevr)! - Fix critical correctness bugs, operational gaps, and Effect v4 hygiene
  - Fix best-tracking to respect optimization direction (min/max)
  - Fix crash recovery with three-phase commit protocol (pending → committed → decision)
  - Fix SIGTERM handling with Deferred + forkChild, stop waits for process death
  - Fix revert semantics (git reset --hard) and diff (git diff HEAD)
  - Check agent exit code — revert on non-zero
  - Shell-safe benchmark execution via sh -c
  - Agent timeout (10min) and benchmark timeout (5x baseline)
  - Cap dead-ends in prompt to last 10
  - Add --model flag to start command
  - Guard \_loop behind XP_INTERNAL env var
  - Type XpError.code as literal union
  - Convert event schemas to TaggedStruct
  - Convert hashFiles/consumeSteers/reconcile/appendLifecycle to Effect.fn
