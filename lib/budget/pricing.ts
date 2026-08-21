/**
 * Model pricing, USD per million tokens. Verified August 2026.
 *
 * The ratio across tiers is exactly 5 : 2 : 1 (Opus : Sonnet : Haiku) on both
 * input and output, which is what makes routing math trivial — every request
 * moved Opus -> Haiku is a flat 5x saving.
 *
 * Re-verify before trusting the absolute numbers; the RATIOS age well, the
 * prices do not.
 */
export type Pricing = { input: number; cacheWrite5m: number; cacheRead: number; output: number };

export const PRICING: Record<string, Pricing> = {
  "anthropic/claude-fable-5":    { input: 10, cacheWrite5m: 12.5, cacheRead: 1.0,  output: 50 },
  "anthropic/claude-opus-5":     { input: 5,  cacheWrite5m: 6.25, cacheRead: 0.5,  output: 25 },
  "anthropic/claude-opus-4-6":   { input: 5,  cacheWrite5m: 6.25, cacheRead: 0.5,  output: 25 },
  "anthropic/claude-sonnet-5":   { input: 2,  cacheWrite5m: 2.5,  cacheRead: 0.2,  output: 10 },
  "anthropic/claude-sonnet-4-6": { input: 2,  cacheWrite5m: 2.5,  cacheRead: 0.2,  output: 10 },
  "anthropic/claude-haiku-4-5":  { input: 1,  cacheWrite5m: 1.25, cacheRead: 0.1,  output: 5 },
};

/** Batch API is a flat 50% off both input and output, and stacks with caching. */
export const BATCH_MULTIPLIER = 0.5;

export type Usage = {
  inputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens: number;
};

/**
 * Cost in MICRO-USD (1e-6 USD) as an integer.
 *
 * Whole cents are too coarse to gate on: a $0.0226 run rounds to 3c, a 33%
 * error, and per-run caps in this system are routinely $0.02. Integer micros
 * keep the arithmetic exact and avoid float drift as spend accumulates.
 *
 * Unknown models are charged at the MOST EXPENSIVE known rate rather than
 * zero — an unpriced model must never look free to the gate.
 */
export function costMicros(model: string, usage: Usage, batch = false): number {
  const p = PRICING[model] ?? mostExpensive();
  const m = batch ? BATCH_MULTIPLIER : 1;
  const usdPerMillion =
    (usage.inputTokens * p.input) +
    ((usage.cacheCreationInputTokens ?? 0) * p.cacheWrite5m) +
    ((usage.cacheReadInputTokens ?? 0) * p.cacheRead) +
    (usage.outputTokens * p.output);
  // usdPerMillion / 1e6 USD  ->  * 1e6 micros  ==  usdPerMillion micros.
  return Math.round(usdPerMillion * m);
}

/** Display helper only. Never gate on this — see costMicros. */
export function costCents(model: string, usage: Usage, batch = false): number {
  return costMicros(model, usage, batch) / 10_000;
}

export const USD = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;
export const usdToMicros = (usd: number) => Math.round(usd * 1_000_000);

export function isKnownModel(model: string): boolean {
  return model in PRICING;
}

function mostExpensive(): Pricing {
  return Object.values(PRICING).reduce((a, b) => (b.output > a.output ? b : a));
}
