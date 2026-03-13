---
"@cvr/xp": patch
---

Add `--max-run` flag to `start` command for wall-clock runtime limit (minutes)

- Wires through to `Session.maxWallClockMs` → `BudgetService` enforcement
- Add codex fixture (`fixture/setup-codex.sh`)
