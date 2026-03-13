---
"@cvr/xp": patch
---

Fix critical correctness bugs, operational gaps, and Effect v4 hygiene

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
