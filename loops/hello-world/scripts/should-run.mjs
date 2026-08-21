/**
 * Condition trigger for the hello-world loop.
 *
 * Contract: return { fire, message?, state? }. The previous JSON state arrives
 * as the deeply frozen `trigger.state`. When fire is false the scheduler
 * persists state and reschedules WITHOUT a model call and without run history —
 * the cheap-sensor property that makes 60-second polling effectively free.
 *
 * Budget per evaluation: 30s wall clock, <=5 tool calls, 16KB state.
 *
 * Three rules this file demonstrates, all load-bearing:
 *   1. READ-ONLY. If a fired payload run later fails, the returned state is NOT
 *      persisted, so the next evaluation sees the old state and can fire again.
 *      Side effects here would double-execute. Actions belong in the payload.
 *   2. Report ACTIONABLE STATE, not success. A watcher that goes quiet when its
 *      own check breaks looks healthy while broken — so failure fires too.
 *   3. This runs UNATTENDED with the owning agent's full tool policy, including
 *      exec. It is code, not config, and it gets reviewed like code.
 *
 * TODO(phase-0): verify the exact invocation contract against the running
 * gateway — whether the script is imported for its default export or evaluated
 * as a function body. Both shapes are supported below.
 */
export default async function shouldRun(ctx = {}) {
  const prev = ctx.state ?? globalThis.trigger?.state ?? {};

  try {
    // Fire when the 5-minute bucket changes. Deduplicates against persisted
    // state rather than relying on process or model memory.
    const bucket = Math.floor(Date.now() / 300_000);

    if (prev.bucket === bucket) {
      return { fire: false, state: prev };
    }

    return {
      fire: true,
      message: `hello-world: bucket advanced ${prev.bucket ?? "none"} -> ${bucket}`,
      state: { bucket, lastFiredAt: new Date().toISOString() },
    };
  } catch (err) {
    // Rule 2: a broken check must be loud, never silent.
    return {
      fire: true,
      message: `hello-world condition check FAILED: ${err?.message ?? err}`,
      state: prev,
    };
  }
}
