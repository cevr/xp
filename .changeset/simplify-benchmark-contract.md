---
"@cvr/xp": minor
---

Simplify benchmark contract to single-value `RESULT <number>` and add `--until` deadline flag

- Replace `METRIC name=value` with `RESULT <number>` — one number in, one number out
- Remove `--metric` flag, `session.metric`, metric resolution logic, `Record<string, number>` maps
- Multiple RESULT lines are an error (not "last wins")
- Add `--until <date>` flag for absolute deadlines (mutually exclusive with `--max-minutes`)
- Store time budget as absolute ISO 8601 `deadline` instead of relative `maxWallClockMs`
- Date-only `--until` values normalized to EOD local time
- Rename error code `METRIC_PARSE_FAILED` → `RESULT_PARSE_FAILED`
