---
"@cvr/xp": minor
---

Simplify `start` command flag surface: 5 required → 3

- `--metric` optional — auto-detected from baseline when benchmark emits single metric
- `--name` changed from positional arg to optional flag, defaults to `basename(cwd)`
- `--max-run` renamed to `--max-minutes`
- `--model` removed — hardcoded `opus` in AgentPlatform
- Auto-prune stale git worktrees on startup (self-healing after crashed daemons)
