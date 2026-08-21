/**
 * tepui — budget circuit breaker.
 *
 * The runtime provides NO native per-run or per-day dollar cap, so this is the
 * only thing standing between a loop and the documented failure mode of an
 * unattended agent burning $47,000 over eleven days.
 *
 * Design rules, each of which exists because of a specific failure:
 *
 *   - It is a GATE, not a report. Telemetry after the fact is a logbook; this
 *     refuses the run before the tokens are spent.
 *   - It FAILS CLOSED. No ledger, no pricing, no budget entry -> deny. An
 *     accounting bug must never read as permission to spend.
 *   - Spend is attributed per (agent, loop, day) so one runaway loop cannot
 *     quietly consume another's headroom.
 *   - Cost events use Paperclip's attribution schema, which is the best thing
 *     in that project and is worth keeping regardless of runtime.
 */
import { costMicros, isKnownModel, usdToMicros, USD, type Usage } from "./pricing.ts";

export type Budget = { per_run_usd: number; per_day_usd: number };

export type CostEvent = {
  ts: string;
  agent: string;
  loop: string;
  runId: string;
  provider: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costMicros: number;
  costCents: number;   // derived, for Paperclip-schema compatibility
};

export type Decision =
  | { allow: true; remainingTodayMicros: number }
  | { allow: false; reason: string; code: "NO_BUDGET" | "RUN_CAP" | "DAY_CAP" | "UNKNOWN_MODEL" };

/** Storage is injected so this stays runtime-agnostic and trivially testable. */
export interface LedgerStore {
  get(key: string): number;            // micro-USD
  add(key: string, micros: number): void;
  append(event: CostEvent): void;
}

export class MemoryStore implements LedgerStore {
  totals = new Map<string, number>();
  events: CostEvent[] = [];
  get(key: string) { return this.totals.get(key) ?? 0; }
  add(key: string, micros: number) { this.totals.set(key, this.get(key) + micros); }
  append(e: CostEvent) { this.events.push(e); }
}

export class BudgetGate {
  private store: LedgerStore;
  private budgets: Record<string, Budget>;
  private today: () => string;

  constructor(store: LedgerStore, budgets: Record<string, Budget>, today = () => new Date().toISOString().slice(0, 10)) {
    this.store = store;
    this.budgets = budgets;
    this.today = today;
  }

  private dayKey(loop: string) { return `${loop}:${this.today()}`; }

  /**
   * Called BEFORE the model request. `projectedMicros` is the caller's estimate
   * of this run's cost in micro-USD; pass a conservative upper bound, since
   * under-estimating here is what lets a run slip past the cap.
   */
  check(loop: string, projectedMicros: number, model?: string): Decision {
    const budget = this.budgets[loop];
    if (!budget) {
      return { allow: false, code: "NO_BUDGET", reason: `loop '${loop}' has no budget entry — refusing to run` };
    }
    if (model && !isKnownModel(model)) {
      return { allow: false, code: "UNKNOWN_MODEL", reason: `model '${model}' has no pricing entry — refusing to run rather than treating it as free` };
    }

    const runCap = usdToMicros(budget.per_run_usd);
    if (projectedMicros > runCap) {
      return { allow: false, code: "RUN_CAP", reason: `projected ${USD(projectedMicros)} exceeds per-run cap ${USD(runCap)} for '${loop}'` };
    }

    const dayCap = usdToMicros(budget.per_day_usd);
    const spentToday = this.store.get(this.dayKey(loop));
    if (spentToday + projectedMicros > dayCap) {
      return {
        allow: false, code: "DAY_CAP",
        reason: `'${loop}' has spent ${USD(spentToday)} today; ${USD(projectedMicros)} more would exceed the daily cap ${USD(dayCap)}`,
      };
    }

    return { allow: true, remainingTodayMicros: dayCap - spentToday - projectedMicros };
  }

  /** Called AFTER the run with real usage. Always record, even on overrun. */
  record(args: { agent: string; loop: string; runId: string; model: string; usage: Usage; batch?: boolean }): CostEvent {
    const micros = costMicros(args.model, args.usage, args.batch);
    this.store.add(this.dayKey(args.loop), micros);
    const event: CostEvent = {
      ts: new Date().toISOString(),
      agent: args.agent,
      loop: args.loop,
      runId: args.runId,
      provider: args.model.split("/")[0] ?? "unknown",
      model: args.model,
      inputTokens: args.usage.inputTokens,
      cachedInputTokens: (args.usage.cacheReadInputTokens ?? 0) + (args.usage.cacheCreationInputTokens ?? 0),
      outputTokens: args.usage.outputTokens,
      costMicros: micros,
      costCents: micros / 10_000,
    };
    this.store.append(event);
    return event;
  }

  spentToday(loop: string) { return this.store.get(this.dayKey(loop)); }
}

export { costMicros, costCents, usdToMicros, USD, type Usage } from "./pricing.ts";
