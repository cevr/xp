# xp

Autonomous experiment daemon. Point an LLM at any benchmark, it optimizes the metric in a loop.

Built with [Effect v4](https://effect.website) and [Bun](https://bun.sh).

## Install

```bash
bun run build   # compiles binary to bin/xp + symlinks to ~/.bun/bin/
```

## Usage

```bash
# Start an experiment
xp start optimize-fft \
  --metric latency --unit ms --direction min \
  --benchmark "./bench.sh" \
  --objective "reduce FFT latency" \
  --provider claude

# Monitor
xp status            # current state
xp logs              # daemon output
xp logs -f           # tail daemon output
xp results           # all trial results
xp results --last 5  # last 5 trials

# Steer the agent mid-run
xp steer "try SIMD intrinsics instead of auto-vectorization"

# Stop
xp stop
```

## Commands

| Command            | Description                               |
| ------------------ | ----------------------------------------- |
| `start <name>`     | Initialize and start an experiment        |
| `stop`             | Stop the daemon                           |
| `status`           | Show experiment state (`--json`)          |
| `logs`             | View daemon log (`-f` to follow)          |
| `results`          | Show trial results (`--last N`, `--json`) |
| `steer <guidance>` | Send guidance to the running experiment   |

### `start` Flags

| Flag               | Description                                  | Default  |
| ------------------ | -------------------------------------------- | -------- |
| `--metric`         | Metric name to optimize                      | required |
| `--unit`           | Metric unit                                  | `""`     |
| `--direction`      | `min` or `max`                               | required |
| `--benchmark`      | Shell command that emits `METRIC name=value` | required |
| `--objective`      | What the agent should optimize               | required |
| `--provider`       | `claude` or `codex`                          | `claude` |
| `--max-iterations` | Budget cap                                   | `50`     |
| `--max-failures`   | Max consecutive failures                     | `5`      |

## Benchmark Contract

The benchmark command must print metrics to stdout in this format:

```
METRIC latency=42.5
METRIC throughput=1200
```

One `METRIC name=value` per line. The `--metric` flag selects which one to optimize.

## How It Works

1. **Baseline**: runs the benchmark on the current code to establish a starting point
2. **Loop**: invokes the LLM agent with context (objective, best score, dead ends, user guidance), agent makes changes in a git worktree, benchmark runs, result is kept or reverted
3. **Persistence**: all events logged to append-only JSONL, crash-safe with two-phase decisions
4. **Worktree isolation**: experiments run in `.xp/worktree/` on an `xp/<name>` branch — your working directory stays clean

## Development

```bash
bun run dev -- --help   # run from source
bun run gate            # typecheck + lint + fmt + test + build
bun test                # tests only
```
