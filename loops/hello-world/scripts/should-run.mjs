/**
 * Condition trigger for the hello-world loop — the cheap-sensor proof.
 *
 * DIALECT WARNING: this is NOT a module. The scheduler evaluates the file as a
 * bare function body — `import`/`export` are syntax errors here ("unsupported
 * keyword: export", observed live after shipping a module version). You get
 * `trigger.state` (previous state, frozen) and you `return {fire, message?,
 * state?}` directly. `fire: false` reschedules with NO model call and no run
 * history — that is the property that makes 60-second polling free.
 *
 * Rules, all load-bearing:
 *  1. READ-ONLY. If a fired payload run fails, returned state is NOT
 *     persisted, so a trigger with side effects double-executes them.
 *  2. Fire on ACTIONABLE STATE, not on success. A watcher that goes quiet
 *     when its own check breaks looks healthy while broken — so a failed
 *     check FIRES with a loud message instead of returning false.
 *  3. This runs unattended with the owning agent's tool policy. It is code.
 */
try {
  const prev = (trigger && trigger.state) || {};
  const bucket = Math.floor(Date.now() / 300000);   // changes every 5 minutes

  if (prev.bucket === bucket) {
    return { fire: false, state: prev };
  }
  return {
    fire: true,
    message: "hello-world: bucket advanced " + (prev.bucket || "none") + " -> " + bucket,
    state: { bucket: bucket, lastFiredAt: new Date().toISOString() },
  };
} catch (err) {
  return {
    fire: true,
    message: "hello-world condition check FAILED: " + (err && err.message ? err.message : err),
    state: (trigger && trigger.state) || {},
  };
}
