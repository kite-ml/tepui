/**
 * The budget gate is the only thing standing between a loop and a runaway
 * spend incident, so every test here asserts it REFUSES.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetGate, MemoryStore } from "../lib/budget/index.ts";
import { costMicros, usdToMicros } from "../lib/budget/pricing.ts";

const BUDGETS = { "hello-world": { per_run_usd: 0.02, per_day_usd: 0.20 } };
const gate = () => new BudgetGate(new MemoryStore(), BUDGETS, () => "2026-08-21");

test("allows a run inside both caps", () => {
  const d = gate().check("hello-world", 1);
  assert.equal(d.allow, true);
});

test("refuses a loop with no budget entry — fails closed", () => {
  const d = gate().check("undeclared-loop", 1);
  assert.equal(d.allow, false);
  assert.equal((d as any).code, "NO_BUDGET");
});

test("refuses an unpriced model rather than treating it as free", () => {
  const d = gate().check("hello-world", 1, "someone/mystery-model");
  assert.equal(d.allow, false);
  assert.equal((d as any).code, "UNKNOWN_MODEL");
});

test("refuses a single run over the per-run cap", () => {
  const d = gate().check("hello-world", usdToMicros(5));   // $5.00 vs $0.02 cap
  assert.equal(d.allow, false);
  assert.equal((d as any).code, "RUN_CAP");
});

test("refuses once accumulated daily spend would exceed the cap", () => {
  const g = gate();
  // 10 runs of 2c each = 20c, exactly the daily cap.
  for (let i = 0; i < 10; i++) {
    assert.equal(g.check("hello-world", 20_000).allow, true, `run ${i} should be allowed`);
    g.record({ agent: "ops", loop: "hello-world", runId: `r${i}`, model: "anthropic/claude-haiku-4-5",
               usage: { inputTokens: 20_000, outputTokens: 0 } });   // 2c
  }
  assert.equal(g.spentToday("hello-world"), 200_000);   // 20c in micros
  const d = g.check("hello-world", 1);
  assert.equal(d.allow, false);
  assert.equal((d as any).code, "DAY_CAP");
});

test("daily spend is isolated per loop", () => {
  const g = new BudgetGate(new MemoryStore(), {
    a: { per_run_usd: 1, per_day_usd: 1 }, b: { per_run_usd: 1, per_day_usd: 1 },
  }, () => "2026-08-21");
  g.record({ agent: "x", loop: "a", runId: "1", model: "anthropic/claude-haiku-4-5", usage: { inputTokens: 1_000_000, outputTokens: 0 } });
  assert.equal(g.spentToday("a"), 1_000_000);   // $1.00
  assert.equal(g.spentToday("b"), 0, "one runaway loop must not consume another's headroom");
  assert.equal(g.check("b", 500_000).allow, true);
});

test("the cap resets on a new day", () => {
  let day = "2026-08-21";
  const g = new BudgetGate(new MemoryStore(), BUDGETS, () => day);
  g.record({ agent: "ops", loop: "hello-world", runId: "1", model: "anthropic/claude-haiku-4-5", usage: { inputTokens: 200_000, outputTokens: 0 } });
  assert.equal(g.check("hello-world", 1).allow, false);
  day = "2026-08-22";
  assert.equal(g.check("hello-world", 1).allow, true);
});

test("cost events carry Paperclip-shaped attribution", () => {
  const g = gate();
  const e = g.record({ agent: "ops", loop: "hello-world", runId: "run-7", model: "anthropic/claude-sonnet-4-6",
                       usage: { inputTokens: 4_000, cacheReadInputTokens: 36_000, outputTokens: 3_000 } });
  assert.equal(e.agent, "ops");
  assert.equal(e.loop, "hello-world");
  assert.equal(e.runId, "run-7");
  assert.equal(e.provider, "anthropic");
  assert.equal(e.cachedInputTokens, 36_000);
  assert.ok(e.costMicros > 0);
  assert.equal(e.costCents, e.costMicros / 10_000);
});

// --- pricing sanity: these numbers are the whole cost thesis ---

test("the 5:2:1 tier ratio holds", () => {
  const u = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  const opus = costMicros("anthropic/claude-opus-5", u);
  const sonnet = costMicros("anthropic/claude-sonnet-5", u);
  const haiku = costMicros("anthropic/claude-haiku-4-5", u);
  assert.equal(opus / haiku, 5);
  assert.equal(sonnet / haiku, 2);
});

test("a cache read is 90% cheaper than fresh input", () => {
  const fresh = costMicros("anthropic/claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 0 });
  const cached = costMicros("anthropic/claude-sonnet-5", { inputTokens: 0, cacheReadInputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(cached / fresh, 0.1);
});

test("batch is a flat 50% off", () => {
  const u = { inputTokens: 1_000_000, outputTokens: 100_000 };
  assert.equal(costMicros("anthropic/claude-haiku-4-5", u, true), costMicros("anthropic/claude-haiku-4-5", u) / 2);
});

test("the worked model from docs/cost.md still holds", () => {
  // 40k in (36k cached prefix + 4k fresh) + 3k out, blended tiers.
  const u = { inputTokens: 4_000, cacheReadInputTokens: 36_000, outputTokens: 3_000 };
  const opusCached = costMicros("anthropic/claude-opus-5", u) / 1_000_000;
  const haikuCached = costMicros("anthropic/claude-haiku-4-5", u) / 1_000_000;
  assert.ok(Math.abs(opusCached - 0.1130) < 0.0001, `opus cached ${opusCached}`);
  assert.ok(Math.abs(haikuCached - 0.0226) < 0.0001, `haiku cached ${haikuCached}`);
  assert.ok(opusCached / haikuCached > 4.9, "the 5x tier gap must survive caching");
});

test("Nemotron is dramatically cheaper than the Anthropic tiers", () => {
  const u = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  const haiku = costMicros("anthropic/claude-haiku-4-5", u);
  const nano  = costMicros("nvidia/nemotron-3-nano-30b-a3b", u);
  const ultra = costMicros("nvidia/nemotron-3-ultra-550b-a55b", u);
  const sonnet = costMicros("anthropic/claude-sonnet-5", u);
  assert.ok(nano < haiku / 20, `nano ${nano} should be >20x cheaper than haiku ${haiku}`);
  assert.ok(ultra < sonnet, `ultra ${ultra} should undercut sonnet ${sonnet}`);
});

test("an unpriced Nemotron variant still fails closed", () => {
  const g = new BudgetGate(new MemoryStore(), { x: { per_run_usd: 1, per_day_usd: 1 } }, () => "2026-08-21");
  assert.equal(g.check("x", 100, "nvidia/nemotron-9-imaginary").allow, false);
});
