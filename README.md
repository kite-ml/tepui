# tepui

**An AI-native company operating system. Your business, as loops that improve themselves.**

A *tepui* is one of the flat-topped table mountains that rise out of the Venezuelan Gran Sabana — Roraima, Auyantepui. The Pemón call them *houses of the gods*. They are, quite literally, ancient platforms: billion-year-old foundations that everything else grows on top of.

That is the job of this repo. It is the platform your company runs on — not a chatbot bolted onto the side of it.

> ## Status: Phase 0. Read this before adopting.
>
> **What works today**, verified running against a live gateway:
>
> - **Org chart as code** — `org.yaml` compiles to runtime config, with six fail-closed invariants and 33 tests
> - **Capability policy** — enforced by the runtime *before the model call*; a denied tool's schema is never sent
> - **The intake pattern** — a quarantine agent that holds no credentials and has exactly one read-only tool
> - **A spend gate** — per-run and per-day caps in integer micro-USD, because the runtime has no dollar cap of its own
> - **Slack** — one app, channel-routed to agents, over Socket Mode
> - **Deploy** — a GCP VM with an isolated VPC, or the same compose on a laptop
>
> **What is described below but NOT built yet:**
>
> - the **learning loop** (`lib/learn/` is an empty directory)
> - the **eval harness** (`lib/evals/`, likewise)
> - **decision records** as tooling — the format exists and is in use, the sweep is not
> - every business loop. `loops/` contains `hello-world` and nothing else
>
> So: this is an org-chart compiler and a spend gate for [OpenClaw](https://github.com/openclaw/openclaw), well tested, plus a design for the rest. The three pillars below are the plan. Treat the roadmap as a roadmap.
>
> See [PLAN.md](PLAN.md) for the build order and [docs/what-is-openclaw.md](docs/what-is-openclaw.md) for exactly which lines are ours versus the runtime's.

---

## The thesis

Most companies adopting AI are buying copilots: a tool bolted onto an existing workflow, delivering a real but bounded ~20% productivity lift. The org chart doesn't change, the approval chain doesn't change, and the gains don't compound.

The alternative is to treat the company itself as software — a set of **recursive, self-improving loops** that run with minimal human intervention, get better every time they fail, and are owned by named humans at the edges rather than managed through the middle.

`tepui` is the scaffolding for building that. It is company-agnostic at its core and personalized through a thin overlay, so the same foundation can run a two-person startup or a fifty-person company without either inheriting the other's assumptions.

Concretely, it is two things: **a library of business loops** you can adopt or fork, and **the company layer that OpenClaw deliberately doesn't have** — an org chart, a spend cap, an eval harness, a learning loop, and decision records. OpenClaw supplies excellent primitives and no opinion above them. This is the opinion.

The principles come from [Tom Blomfield's YC talk, *How to Build a Self-Improving Company with AI*](https://www.youtube.com/watch?v=X_JsIHUfUjc). They're documented in full — with sourcing caveats — in [docs/principles.md](docs/principles.md).

---

## The nine ideas this repo is built on

1. **The org chart is a Roman legion.** Nested spans of control exist because humans were the only way to move information around. Once that stops being true, the hierarchy loses its reason to exist.
2. **Copilots are the wrong mental model.** Strapping a bigger engine to a horse-drawn cart gets you a faster cart, not a car.
3. **Domain knowledge is the bottleneck, not model capability.** The models are already smart enough. What's missing is the company-specific context locked in senior people's heads, in Slack, and in meetings nobody wrote down.
4. **The loop is the unit of work.** Sensor → Policy → Tool → Quality gate → Learning. Wire all five together and that part of the business starts improving on its own.
5. **Burn tokens, not headcount.** Once the loops exist, the binding constraint stops being people and becomes inference spend. Before opening a req, ask whether a well-designed loop could do the job.
6. **Middle management is a coordination technology.** AI solves the same coordination problem faster. Two human roles survive: the **IC**, who brings a working prototype rather than a deck, and the **DRI**, one named owner per outcome — never a committee.
7. **If it wasn't recorded, it didn't happen.** The company brain can only reason over what was captured. Everything else is invisible.
8. **Software is ephemeral; context is precious.** Internal tools should be regenerated every month or two as models improve. The data, decisions, and reasoning behind them must never be thrown away — so store them as markdown and structured logs that outlive any model.
9. **Humans move to the edge.** Novel situations, high-stakes emotional moments, genuine ethical judgment, and relationship-building stay human. Everything between them is a loop.

---

## Architecture

`tepui` has three pillars, because a company OS has to do three things: **know** what the company knows, **do** the repeatable work, and **decide** the things that aren't repeatable.

```
                          ┌─────────────────┐
                          │     CONTEXT     │   what the company knows
                          │  company/ +     │   the durable asset
                          │  memory/        │
                          └────────┬────────┘
                             reads │ writes
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
           ┌─────────────────┐          ┌──────────────────┐
           │      LOOPS      │─────────▶│    DECISIONS     │
           │  automate the   │  surface │  judgment, with  │
           │ repeatable work │  the data│  data provenance │
           └─────────────────┘          └──────────────────┘
                                          human-signed
```

Everything is markdown in git. That is not an aesthetic preference — it's what makes the context survive model turnover, the core forkable, and every change reviewable in a PR.

**Runtime: [OpenClaw](https://github.com/openclaw/openclaw)**, self-hosted on a small VPS (~$5–12/mo). It supplies the always-on gateway, the scheduler, per-agent capability isolation, approval gates, and chat channels. GitHub Actions is the CI plane — it never runs a loop, it proves loops are correct.

Git stays the source of truth, enforced by a **read-only mount**: everything the runtime must never mutate is mounted `:ro`, so a config write from inside fails with `FsSafeError` and the only way to change an agent's permissions is a commit.

> We originally relied on OpenClaw's documented "includes fail closed for its own writes." **Phase 0 testing falsified that** — with a writable mount the runtime disabled the quarantine agent's sandbox live, without a restart. Filesystem permissions are the stronger mechanism. See [the decision record](../tepui-company/decisions/2026-08-21-git-truth-enforced-by-mount.md).

### Pillar 1 — Context: the company brain

The prerequisite for everything else. Models are already smart enough; what they lack is *your* context. Two directories hold it, and they are the only places company-specific facts are allowed to live:

- **`company/`** — who we are, what we sell, to whom, our brand voice, our spend limits. Written once by interview, edited by humans.
- **`loops/*/memory/`** — what each loop has learned about this company, grown automatically from use.

**These are the sacred files.** Loops are regenerable; context is not. If the repo burned down, this is what you'd actually miss.

### Pillar 2 — Loops: automate the repeatable work

Every workflow is a five-layer loop. This isn't a metaphor — it's the file layout.

```
loops/<name>/
├── SKILL.md          # 3. TOOL     — what the agent does, and how
├── sensors.yaml      # 1. SENSOR   — what signal wakes this loop up
├── policy.md         # 2. POLICY   — which credentials it may hold; approval stages
├── evals/            # 4. GATE     — nothing ships that fails these
└── memory/
    ├── _insights.md  # 5. LEARNING — what it learned about THIS company
    └── _examples/    #              approved past output, used as few-shot context
```

The learning layer is what makes it a loop rather than a script: diff what the agent drafted against what the human actually shipped, and write down the delta. The loop gets better at your company without anyone touching its code.

**Policy is enforced by capability, not by prose.** A loop that must not publish does not hold the publishing credential — and OpenClaw enforces tool policy *before the model call*, so a denied tool's schema is never even sent. Field evidence is unambiguous that agents invent policies and misreport their own state, so instructions are not a control; missing credentials are.

Loops are owned by **agents** — `ops`, `analyst`, `marketing`, `engineer`, `intake` — each with its own workspace, model tier, skill allowlist, sandbox, and credentials. The org chart lives in `org.yaml` and compiles into who may delegate to whom.

**Sensors are nearly free.** A condition trigger is a script returning `{fire: boolean}`; when it returns `false` the job reschedules with **no model call and no run history**. Poll constantly, wake the model only when something is actually true.

#### The intake pattern

The load-bearing safety design, and it's architectural rather than hopeful. Every loop reads attacker-influenceable text — event properties, inbound replies, PR diffs, receipts, transcripts — and prompt injection is explicitly outside OpenClaw's threat model.

**So: untrusted input and credentials never coexist in one agent.** Anything reading untrusted text runs as `intake` — zero skills (therefore zero injected credentials), fully sandboxed, no filesystem, no network, no exec, cheapest model. Its only output is structured text handed up to `ops`. An injection that lands there controls an agent that holds nothing and can do nothing.

### Pillar 3 — Decisions: judgment with data provenance

Automation handles the repeatable. The decisions that actually move the company are one-off, and they're where "make decisions with the data we have" lives.

Each decision is a record in `decisions/`:

```yaml
---
kind: decision
date: 2026-08-18
dri: luigi                      # one named owner, never a committee
status: proposed | decided | superseded
data_sources: [posthog:signup-funnel-q3, stripe:mrr-aug]
review_on: 2026-10-01           # ← when we check whether this worked
---
```
The body is six sections: **Question**, **Data consulted**, **Options considered**, **Decision + reasoning**, **Expected outcome**, and **Actual outcome** — the last filled in when `review_on` arrives.

Three things make this more than a wiki page:

1. **`data_sources` are queries, not conclusions** — so a decision can be re-derived when the data changes, instead of quietly rotting.
2. **`review_on` closes a company-level loop.** The analyst loop surfaces decisions whose review date has arrived and reports what actually happened. Most organizations never check whether their decisions worked; this makes forgetting the harder path.
3. **Agents draft, humans sign.** `status` is never model-generated. Agents assemble the data, lay out options, and write the record — a person decides.

Over time this becomes the most valuable thing in the repo: a queryable record of *what we decided, on what evidence, and whether it worked.*

### Core vs. overlay

Two repos, both cloned into `~/.openclaw/` on the gateway box.

```
tepui-core/                   ← PUBLIC, MIT, zero company facts
│  ── survives a runtime change (~60% of the code) ──
├── org.yaml                  ← the org chart, declarative
├── loops/<loop>/             ← SKILL.md · sensor.yaml · policy.yaml
│                               scripts/ · evals/ · setup.md
├── lib/                      ← capability NO runtime provides:
│                               budget cap · evals · learning differ · decisions
│  ── the throwaway layer (~40%) ──
└── runtime/
    ├── openclaw/             ← config profiles · compile · sync · plugin · workflows
    └── claude/               ← the escape hatch, kept working

tepui-company/                ← PRIVATE — and this IS the agents' workspace root
├── core.lock                 ← pinned core SHA + sha256 blob digests
├── org.overlay.yaml          ← names, models, channels
├── generated/*.json5         ← committed compiler output — the $include target
├── company/                  ← profile · brand · policies
├── agents/<id>/              ← standing orders, identity, memory
├── loops/<loop>/memory/      ← _insights.md · _examples/ · _drafts/ · _published/
└── decisions/
```

**`lib/` and `loops/` are the project; `runtime/` is the adapter.** That boundary is a directory rather than a claim, which is what keeps the escape hatch honest. If OpenClaw stopped existing tomorrow you would rewrite `runtime/openclaw/` — roughly 650 lines — and keep everything else.

Because the private repo *is* the workspace root, layer 5 is git-native for free — what an agent learns lands as a file change, and `bin/tepui-learn` turns it into a PR.

Separation is enforced two ways: `core.lock` pins the core at an immutable SHA with sha256 blob verification, checked fail-closed at gateway startup; and CI greps for company facts outside the permitted directories. Setup is an interview, not a config file — each loop ships a `setup.md` asking only what can't be derived from the web.

---

## Portability: why this isn't a bet on one vendor

The runtime is OpenClaw. The *content* is not.

| Layer | Portable? |
|---|---|
| `SKILL.md` | **Yes** — OpenClaw independently implements the agentskills.io spec, so the same file runs on Claude Code too |
| `scripts/` | **Yes** — every runner can run bash |
| Lobster workflows | **Yes** — Lobster ships a standalone CLI |
| Markdown memory, `decisions/`, `evals/` | **Yes** — they're files |
| `generated/*.json5`, the sensor reconciler, the plugin | **No** — this is the adapter surface |

That OpenClaw-specific surface is comparable in size to the Claude Code adapter this project always budgeted for, so provider-neutrality survives — **provided core skills keep referring to capabilities generically** (`exec`, `web_fetch`) and never name a runtime's tool in prose.

`adapters/claude/` is kept and kept working. It is now the escape hatch rather than the primary path, which is a better place for it — and running one spec-clean `SKILL.md` on both hosts is both the portability proof and the migration insurance.

**Running locally** is first-class: OpenClaw supports 50+ providers including Ollama, vLLM, LM Studio, and SGLang, and preflights local endpoints before a scheduled run so a dead server records a skip instead of burning a call.

---

## Cost: the numbers this repo is designed around

"Burn tokens, not headcount" is not a licence to be careless. It means spend on inference *instead of* payroll — which only works if inference is engineered.

Measured cost for one representative task (40k input, 3k output):

| Configuration | Cost/task | vs. naive |
|---|---|---|
| Frontier model, no caching | $0.2750 | 1× |
| Frontier, cached | $0.1130 | 2.4× |
| Mid-tier, cached | $0.0452 | 6.1× |
| **Blended routing (70/25/5), all cached** | **$0.0328** | **8.4×** |
| Cheap tier, cached + batched | $0.0113 | 24.3× |

At 2,000 tasks/month that is **$550 → $66**, plus ~$5–12/mo for the box.

**The runtime adds one lever the table doesn't show:** a condition trigger that returns `fire: false` reschedules with **no model call at all**. Polling becomes nearly free, so sensors can run every 30 seconds instead of hourly without changing the bill.

The eight rules that get you there:

1. **Instrument before optimizing.** OpenTelemetry is built in and free; it attributes cost per skill, per agent, and per MCP server.
2. **Route three ways.** Cheap tier triages and handles simple work; mid tier does ~80% of real work; top tier handles the 5% needing deep reasoning. 60–70% saving, no measurable quality loss.
3. **Cache aggressively, but honestly.** A cache read is 90% off; a cache *write* is a loss if the prefix is never reused.
4. **Batch anything nobody is waiting for.** Flat 50% off, and it stacks with caching.
5. **Turn effort down.** Most routine company work does not need maximum reasoning depth. This is the most underused dial available.
6. **Deterministic beats probabilistic.** Fixed-label classification costs 40–250× more through a model than through code. If the inputs fully determine the output, it is not a model task — it goes in `scripts/`.
7. **Guard the loops.** Hard dollar caps, not good intentions. A documented 2026 incident burned $47,000 over 11 days in an unattended agent loop.
8. **Watch the context tax.** ~42% of tokens in typical agent sessions are avoidable re-reading. Seven MCP servers can consume a third of a context window before anyone types a word.

One correction to conventional wisdom, because it costs people real money: **subagent isolation is a context win, not automatically a cost win.** A subagent starts with a cold cache and re-discovers what the parent already paid to learn. Fan out for genuine parallelism or to run a *cheaper model* — not by reflex.

Full detail, with current pricing: [docs/cost.md](docs/cost.md).

---

## Prior art, honestly assessed

| Project | What it is | How we use it |
|---|---|---|
| [OpenClaw](https://github.com/openclaw/openclaw) | Self-hosted agent runtime — gateway, scheduler, channels, per-agent capability isolation, 386k★, MIT | **The runtime.** Supplies four things this project would otherwise build badly: capability policy enforced before the model call, condition triggers that poll without a model call, native approval gates with operand binding, and per-agent + per-job model routing |
> **"Isn't this just an OpenClaw config?"** Fair question — [docs/what-is-openclaw.md](docs/what-is-openclaw.md) answers it file by file. Short version: 28% of the repo is the OpenClaw adapter, 72% survives a runtime change, and only ~39 lines are actual OpenClaw settings.

| [Lobster](https://github.com/openclaw/lobster) | OpenClaw's workflow format | Layer 3 + the approval gates. Has a standalone CLI, so it stays portable |
| [Paperclip](https://github.com/paperclipai/paperclip) | Control plane for agent companies, 79k★, MIT | **Patterns, not code.** Its `cost_events` attribution schema is the best thing in it and becomes our plugin's output format; its execution-policy stage vocabulary names our approval states |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Agent runtime with persistent memory, 232k★, MIT | Design precedent for skills as procedural memory |
| [sylph](https://github.com/getnao/sylph) | Business functions as `SKILL.md` | Best pattern source — the per-skill setup interview, `_insights.md` as the single company surface, `_drafts → _examples → _published`. ⚠️ **No license — patterns only, zero copied text** |
| [agency-agents](https://github.com/msitarzewski/agency-agents) | ~250 agent definitions, MIT | One registry file + CI that fails on registry/filesystem drift |

**What OpenClaw does not give us, and we build:** an org chart, a budget cap (there is no native dollar limit — this is why the circuit breaker ships before anything autonomous runs), an eval harness for our own workflows, a learning differ, and decision records. Roughly 1,600–1,800 lines. "Employees" is our construction over `agents.entries` and bindings — excellent primitives, no opinion above them.

### Nobody actually runs their company on any of this

Worth knowing, because the discourse badly overstates it. **OpenClaw** has enormous *ecosystem* adoption — NVIDIA, Cloudflare, AWS, Shopify, and HeyGen publish integrations for it; Tencent, ByteDance, and Alibaba built products on it — and almost no documented *internal company* adoption. Meta, Google, Microsoft, and Amazon banned employee use in February 2026 after discovering unsanctioned installs. **Paperclip's** founders name zero customers in their own podcast appearances.

More importantly, across the whole field, *business* operations on agents is the **least-documented category there is**. The most rigorous public account of an agent running a business end-to-end is a deliberate failure study published by Anthropic. See [docs/evidence.md](docs/evidence.md) — including the number to calibrate against: at Anthropic itself, **over half of employees could fully delegate only 0–20% of their work.**

We are choosing this runtime with our eyes open about all of it. The security posture is real and the answer is architectural — see the intake pattern above, and [PLAN.md](PLAN.md) §2.4.

> ⚠️ **`openclay` does not exist.** If you arrived looking for it, you want OpenClaw. The only real "OpenClay" is an abandoned PyPI package whose GitHub links 404.


## Getting started

Nothing to install yet. When there is, it will be: stand up the gateway on a small VPS, clone the two repos into `~/.openclaw/`, run `bin/tepui-compile`, and answer the setup interview. See [PLAN.md](PLAN.md) for the build order.

## License

MIT.

## Credits

Principles from [Tom Blomfield](https://www.ycombinator.com/library/Qf-how-to-build-a-self-improving-company-with-ai) (YC). Patterns from the projects above. Named in Pemón, built in Venezuela's image: a very old platform, holding up something new.
