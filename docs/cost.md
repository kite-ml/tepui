# Cost engineering

*"Burn tokens, not headcount"* means spend on inference **instead of** payroll. It does not mean spend carelessly. Spending $500/month on inference rather than $8,000/month on a hire is the whole point; spending $500 where $60 would do is just a badly built loop.

This document is the cost contract every loop in `tepui` is held to.

> Pricing below was current in August 2026. Re-verify before relying on the absolute numbers — the *ratios* and the *techniques* are what age well.

---

## 1. The tier ratio is the whole lever

Per million tokens (MTok), Anthropic first-party:

| Model | Input | Cache read | Output |
|---|---|---|---|
| Fable 5 | $10 | $1.00 | $50 |
| Opus 5 | $5 | $0.50 | $25 |
| **Sonnet 5** | **$2** | $0.20 | **$10** |
| **Haiku 4.5** | **$1** | $0.10 | **$5** |

The ratio across Opus 5 : Sonnet 5 : Haiku 4.5 is exactly **5 : 2 : 1** on both input and output, which makes routing math trivial. Every request moved Opus → Haiku is a flat 5× saving; Opus → Sonnet is 2.5×.

Two notes: Sonnet 5's $2/$10 is permanent (a scheduled increase was cancelled — don't budget for it). Fable 5 is 2× Opus and is *not* the default upgrade path — reserve it for genuinely hard long-horizon work.

## 2. Route three ways

| Tier | Handles | Share of traffic |
|---|---|---|
| **Haiku 4.5** | Triage, classification, extraction, formatting, tagging, routing — *and* the simple work outright | ~70% |
| **Sonnet 5** | The real work that needs actual intelligence | ~25% |
| **Opus 5** | Deep reasoning: architecture calls, multi-file refactors, ambiguous judgment | ~5% |

**Reported: 60–70% total cost reduction vs. frontier-for-everything, with no meaningful quality loss.**

Triaging on the cheap tier is safe because classification, extraction, formatting, and routing don't exercise the reasoning capacity that separates tiers. One documented migration halved the bill and the confusion matrix didn't move.

Each agent declares its tier in `org.yaml` (`model` + `utilityModel`); individual jobs override with `--model` / `--fallbacks` / `--thinking`. Escalation is explicit, never accidental.

## 3. Caching — and the trap

| Operation | Multiplier | Break-even |
|---|---|---|
| 5-minute cache write | 1.25× | pays off after **1** read |
| 1-hour cache write | 2× | pays off after **2** reads |
| **Cache read** | **0.1×** | 90% saving |

Caching is a **prefix byte match**, rendered in the order `tools` → `system` → `messages`. One changed byte at position *N* invalidates every breakpoint at or after it. Max 4 breakpoints per request. So: stable content first, volatile content last. Never put a timestamp near the top of a prompt.

⚠️ **The trap that quietly costs the most:** the minimum cacheable prefix is model-dependent and **not monotonic**.

| Model | Minimum prefix |
|---|---|
| Opus 5, Fable 5 | 512 tokens |
| Sonnet 5 | 1,024 tokens |
| **Haiku 4.5** | **4,096 tokens** |

The cheap model you route 70% of traffic to has the **highest** minimum. A 2,000-token Haiku prompt with cache control set caches *nothing* and silently pays full price.

⚠️ **Caching is a net loss if the prefix isn't reused.** A single 36k-token cache write costs $0.225 on Opus — about twice a full cached task. Cache what repeats; don't cache one-shots.

## 4. Batch anything nobody is waiting for

Flat **50% off input and output**, and it **stacks with caching**. Most batches finish within the hour; the ceiling is 24.

Batch + cache read on Haiku 4.5 = **$0.05/MTok effective input** — the same price band as budget open-weight APIs, with none of the operational burden.

Batch: nightly digests, backfills, re-scoring a corpus, eval runs, weekly reports, "an agent writes a summary at 6am." Anything without a human waiting.

## 4b. Condition triggers — the cheapest lever we have

**This is the biggest cost advantage of the OpenClaw runtime, and it has no equivalent in a cron-plus-model arrangement.**

A condition trigger is a headless script attached to any `every`, `cron`, or `stream` schedule. It returns `{ fire, message?, state? }`. The scheduler runs the payload **only when it returns `fire: true`**. On `false` it persists evaluation state and reschedules — **with no model call and no run history**.

The contract, verified from the docs:

| Limit | Value |
|---|---|
| Minimum trigger interval | 30 seconds |
| Wall-clock budget per evaluation | 30 seconds |
| Tool calls per evaluation | ≤ 5 |
| Persisted `trigger.state` | 16 KB |
| `once: true` | Self-disables after first fire |

**What this changes.** Under a cron-plus-model design, "check every hour whether the signup funnel moved" costs a model turn every hour — 720/month whether or not anything happened. As a condition trigger it costs **zero model calls** until the funnel actually moves. Polling stops being a budget line, so sensors can run every 30 seconds instead of hourly and the bill goes *down*.

**Three rules for writing them:**

1. **Write them as read-only checks; keep actions in the payload.** If a fired payload run fails, the returned `state` is *not* persisted — the next evaluation sees the previous state and can fire again. A trigger with side effects will double-execute them.
2. **Author around actionable state, not success.** A watcher that goes quiet when its check fails or times out **looks healthy while broken.** Compare the observation against `trigger.state` and return fresh state to deduplicate — never rely on model or process memory. This is the silent-failure mode from [evidence.md](evidence.md), in miniature.
3. ⚠️ **They are code, not config.** The docs are explicit: condition-trigger scripts and `script` payloads *"run unattended by default with the owning agent's full tool policy, including `exec`."* So sensor scripts belong to low-privilege agents only, and get code review like anything else that runs unattended with shell access. `cron.triggers.enabled: false` is the hard stop if one misbehaves.

## 5. Turn effort down

`output_config: {effort: "low"|"medium"|"high"|"xhigh"|"max"}` — **defaults to `high`**, and controls thinking depth *and* total token spend. Lower effort produces fewer, more consolidated tool calls and less preamble.

| Workload | Effort |
|---|---|
| Classification, routing, formatting, lookups | `low` |
| Routine drafting, summarizing, record updates | `medium` |
| Intelligence-sensitive work | `high` |
| Agentic coding, long autonomous runs | `xhigh` |

Most company-infrastructure work sits in the top two rows. This is the most underused dial available.

## 6. Deterministic beats probabilistic — by 40–250×

For fixed-label classification: fine-tuned encoders cost **$7–$11 per million requests**; LLM prompting costs **$463–$2,702**. And for deterministic classification with a fixed label space, scaling to a bigger model **does not improve outcomes at all**.

**The rule: if the inputs fully determine the output, it is not a model task.** Routing, tallying, normalizing, filtering, deduping, date parsing, ID extraction, schema validation, formatting, sorting, template-filling — all of that is `scripts/`.

The pipeline shape:

```
Layer 0  deterministic pre-filter ...... ~$0   regex / schema / allowlist / dedupe
                                               filters 30–60% before any token is spent
Layer 1  Haiku 4.5, effort=low ......... triage, extraction, classification
Layer 2  Sonnet 5, effort=medium|high .. the actual work
Layer 3  Opus 5, effort=high|xhigh ..... escalation only
```

## 7. Watch the context tax

Agents cost more than chat mostly because **the API is stateless and every turn re-sends the full history**.

- **~42%** of tokens across typical agent sessions go to avoidable operations — mostly re-reading the same files
- **Seven MCP servers = ~67,300 tokens of tool definitions**, a third of a 200k window, spent before anyone types a word
- Agents use ~4× the tokens of chat; multi-agent systems ~15×

Mitigations: defer tool loading (~85% reduction in tool-definition tokens), keep MCP servers few and project-scoped, and clear stale tool results rather than paying a model to summarize them.

**Progressive disclosure is the design point**, and it has three budgets:

| Level | Cost | Loaded when |
|---|---|---|
| Skill metadata (name + description) | ~100 tokens each | Every session |
| Skill body (`SKILL.md`) | up to ~5,000 tokens | Only when judged relevant |
| Bundled reference files | arbitrary | Only when a step needs them |

Twenty skills is ~2,000 tokens of always-on metadata. That's cheap, and it's the entire point. What's *not* cheap is a fat `SKILL.md` that loads on a false trigger.

⚠️ **`CLAUDE.md` is the worst place to put anything.** It is unconditional context on every single request of every session. Keep it to facts that are load-bearing on literally every request. Anything conditional becomes a skill.

## 8. Subagent isolation is a context win, not automatically a cost win

The most common cost mistake in 2026 agent architectures, and it cuts against the usual advice.

A subagent starts with **a fresh context and a cold cache**. It inherits nothing from the parent's warm prefix, pays full price to build its own, and commonly **re-discovers what the parent already paid to explore**. When it returns, the parent folds the result back in — paying again.

A more capable model in one coherent session often finishes in fewer turns, and cheaper, than a swarm that each re-establishes context.

**Fan out when:** the tracks are genuinely independent and parallel (research across N sources, per-record work), **or** the worker runs on a cheaper model. That second one is the actual cost lever.

## 9. Guardrails, not good intentions

A documented 2026 incident: a four-agent loop ran **11 days and burned $47,000**.

⚠️ **OpenClaw has no native per-run or per-day dollar cap.** This is the single most important thing to know about running it as company infrastructure. The cap is ours to build — a pre-LLM gate in `plugins/tepui/budget.ts` that refuses a run whose projected or accumulated spend crosses `per_run_usd` / `per_day_usd`, tracked per `(agent, loop, job)`. **Nothing autonomous runs before it exists.**

Every `tepui` loop gets a hard dollar cap before it is allowed to run once. Platform-enforced server-side budgets are strongly preferred over client-side checks — a cap the agent cannot reach past is the only kind that holds.

## 10. Instrument first

OpenTelemetry is built into Claude Code and free:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

Metrics `claude_code.cost.usage` (USD) and `claude_code.token.usage` carry attributes including `model`, `query_source` (`main`/`subagent`/`auxiliary` — this tells you exactly what subagents cost you), `effort`, `agent.name`, `skill.name`, and `mcp_server.name`. That's per-loop cost attribution for free, and it's what `bin/tepui-cost` reads.

The API's own `usage` object is the ground truth: `input_tokens` (uncached remainder only), `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`. Total prompt size is the first three summed. Log all four plus a loop label to SQLite and you have per-loop cost.

---

## The worked model

One representative task: 40k input (36k stable prefix + 4k variable) + 3k output.

| Configuration | Cost/task | vs. naive |
|---|---|---|
| Opus 5, no cache | $0.2750 | 1× |
| Opus 5, cached | $0.1130 | 2.4× |
| Sonnet 5, cached | $0.0452 | 6.1× |
| Haiku 4.5, cached | $0.0226 | 12.2× |
| **Blended 70/25/5, all cached** | **$0.0328** | **8.4×** |
| Haiku 4.5, cached + batched | $0.0113 | 24.3× |

**2,000 tasks/month: $550 → $66. 20,000 tasks/month: $5,500 → $656.**

## Don't self-host (yet)

Break-even for self-hosted inference against a frontier API is around **256M tokens/month (~8.5M/day), and only at ≥60% GPU utilization**. Company-infrastructure agents are bursty; realistic utilization is 5–15%. Meanwhile batched, cached Haiku already lands at $0.05/MTok effective input — inside budget open-weight API territory, with none of the ops.

Revisit if sustained volume ever approaches 8M tokens/day.

## The checklist

1. ☐ Instrument before optimizing
2. ☐ Declare a tier per agent (`model`/`utilityModel`) and per job (`--model`/`--fallbacks`)
2b. ☐ **Put every poll behind a condition trigger** — free until something is true
3. ☐ Cache every stable prefix — and verify the model's minimum prefix length
4. ☐ Batch everything asynchronous
5. ☐ Set effort explicitly; default low for routine work
6. ☐ Move anything deterministic into `scripts/`
7. ☐ Hard dollar cap per run, before first execution
8. ☐ Keep `CLAUDE.md` short and MCP servers few
9. ☐ Justify every subagent — parallelism or a cheaper model, not reflex
10. ☐ **Hard dollar cap enforced by the tepui plugin before any autonomous run** — OpenClaw has no native cap
