import { Effect, Layer, ServiceMap } from "effect";
import type { ExperimentState, Session } from "../types.js";

export interface BudgetCheck {
  readonly canContinue: boolean;
  readonly reason?: string;
}

export class BudgetService extends ServiceMap.Service<
  BudgetService,
  {
    readonly check: (session: Session, state: ExperimentState) => Effect.Effect<BudgetCheck>;
  }
>()("@cvr/xp/services/Budget/BudgetService") {
  static layer: Layer.Layer<BudgetService> = Layer.succeed(BudgetService, {
    check: (session, state) =>
      Effect.sync(() => {
        // Max iterations
        if (state.iteration >= session.maxIterations) {
          return { canContinue: false, reason: `Max iterations reached (${session.maxIterations})` };
        }

        // Max consecutive failures
        const recentResults = state.results.filter((r) => r.kind === "trial");
        let consecutiveFailures = 0;
        for (let i = recentResults.length - 1; i >= 0; i--) {
          if (recentResults[i]!.status === "failed") {
            consecutiveFailures++;
          } else {
            break;
          }
        }
        if (consecutiveFailures >= session.maxFailures) {
          return {
            canContinue: false,
            reason: `Max consecutive failures reached (${session.maxFailures})`,
          };
        }

        // Wall clock
        if (session.maxWallClockMs !== undefined) {
          const startedAt = new Date(session.createdAt).getTime();
          const elapsed = Date.now() - startedAt;
          if (elapsed >= session.maxWallClockMs) {
            return {
              canContinue: false,
              reason: `Wall clock limit exceeded (${Math.round(elapsed / 1000 / 60)}min)`,
            };
          }
        }

        return { canContinue: true };
      }),
  });
}
