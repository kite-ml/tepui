# tepui — build plan

**Runtime: OpenClaw.** Status: design settled, nothing implemented.
**Last updated:** 2026-08-18

---

## 1. Decisions locked

| Decision | Choice |
|---|---|
| Name | **tepui** — Venezuelan table mountains; an ancient platform |
| **Runtime plane** | **OpenClaw gateway**, self-hosted on a small VPS |
| **CI plane** | GitHub Actions — never runs a loop, only proves loops are correct and that the box matches git |
| Split | Public `tepui-core` (MIT, no company facts) + private `tepui-company` |
| Source of truth | **Git**, enforced structurally via OpenClaw's `$include` fail-closed semantics |
| First loops | Analyst/PostHog, then Marketing/design assets |
| Portability insurance | `adapters/claude/` stays — now the escape hatch rather than the primary path |

### Why OpenClaw

Two earlier drafts rejected it on reasoning that turned out to be **false**, and the corrections are why this plan changed:

- ~~"Model choice is per-agent, so there's no router seam"~~ — automations take **per-job `--model`, `--fallbacks`, `--thinking`**. Three-tier routing is expressible.
- ~~"Agent employees doesn't survive contact"~~ — `agents.entries.<id>` carries per-agent `identity`, `workspace`, `agentDir`, `model` + `utilityModel`, `skills` allowlist, `tools` policy, `sandbox`, and `subagents` limits.

What we get without building it:

| Capability | Why it matters |
|---|---|
| **Tool policy enforced *before* the model call** — a denied tool's schema is never sent | Exactly the "capability absence can't be prompt-injected past" property. Native |
| **Condition triggers** — a script returns `{fire: boolean}`; on `false` it reschedules with **no model call and no run history** | Poll cheaply, wake the model only when something is true |
| **Native approval gates** — `approval: required`, `required_approver`, `require_different_approver`, resume tokens | Layer 2 signature, already built |
| **Per-agent + per-job model routing**, 50+ providers, local-model preflight | Cost architecture and provider-neutrality |
| Always-on gateway, channels, per-agent credential injection | The "agent employees you can message" shape |

**And the git problem solves itself, structurally.** OpenClaw's config docs note that *includes with sibling overrides fail closed for OpenClaw-owned writes*. Normally that reads as a limitation. Here it is **the enforcement mechanism**: OpenClaw's own CLI and wizard cannot silently rewrite an `$include`d section, so any change to agents, skills, hooks, or plugins **must be a commit**. This is precisely what Paperclip could not offer, where agents mutate structure at runtime and the repo goes stale by design.

---

## 2. Architecture

### 2.1 What runs where

```
┌──────────── Hetzner CX22 / Fly · 2–4 GB · ~$5–12/mo ────────────┐
│  docker compose: ghcr.io/openclaw/openclaw  (pinned by DIGEST)   │
│  ┌──────── Gateway :18789, loopback only ──────────────────┐     │
│  │ scheduler · condition triggers · heartbeat · webhooks   │     │
│  │ channels: Telegram (ops) · Slack                        │     │
│  │ tepui plugin: budget gate · evals · digest · learn      │     │
│  │                                                          │     │
│  │ agents.entries:                                          │     │
│  │   ops       systemAgent, heartbeat owner                 │     │
│  │   analyst   PostHog read-only, deny write/exec           │     │
│  │   marketing drafts only — NO publish credential, ever    │     │
│  │   engineer  repo rw, sandbox non-main, on demand         │     │
│  │   intake    ZERO skills, sandbox all, NO credentials     │     │
│  └──────────────────────────────────────────────────────────┘     │
│  ~/.openclaw/                                                     │
│    openclaw.json         ← thin stub: secrets + $include of git   │
│    tepui/                ← PRIVATE overlay = agent workspace root │
│    tepui-core/           ← PUBLIC core, pinned SHA                │
│    state/openclaw.sqlite ← jobs, runs, sessions (backed up)       │
└───────────────────────────────────────────────────────────────────┘
      ▲ Tailscale Serve                    │ learning PRs
      │                                     ▼
  laptop + phone                    GitHub — the CI plane:
                                    evals · sensor-drift · policy lint
```

**Division of labour:** the gateway is the **runtime plane** — it holds state, wakes on schedule, is addressable from a phone. GitHub Actions is the **CI plane** — it never runs a loop in production; it proves loops are correct and that the box's SQLite matches git.

### 2.2 Git as source of truth

`~/.openclaw/openclaw.json` is a thin stub, **not** in git, holding only credentials and machine-local facts:

```json5
{
  gateway: { bind: "loopback", auth: { token: "${GATEWAY_TOKEN}" } },
  channels: { /* tokens — written by the CLI, stays writable */ },
  // everything below is git-owned and CANNOT be rewritten by OpenClaw:
  agents:  { $include: "./tepui/generated/agents.json5" },
  skills:  { $include: "./tepui/generated/skills.json5" },
  hooks:   { $include: "./tepui/generated/hooks.json5" },
  plugins: { $include: "./tepui/generated/plugins.json5" },
  cron:    { enabled: true, triggers: { enabled: true } }
}
```

Two invariants, both CI-enforced:
1. **Company facts live only in `company/`, `decisions/`, and `loops/*/memory/`.**
2. **No secret value ever appears in either repo.** Git owns *behaviour*; the local stub owns *credentials*.

`generated/` is produced by `bin/tepui-compile` and **is committed**, so a permission change is a reviewable PR diff and CI asserts the compiler is idempotent.

### 2.3 The org chart is a file

`org.yaml` (archetypes in core, names and models in the overlay) compiles to `agents.entries`:

```yaml
employees:
  analyst:
    title: Analyst
    reports_to: ops
    model: tier2
    sandbox: { mode: non-main, workspaceAccess: ro }
    skills: [posthog-query, decisions-record]
    tools: { profile: readonly, deny: [write, edit, apply_patch] }
    credentials: [POSTHOG_READ_KEY]
    budget: { per_run_usd: 0.25, per_day_usd: 3.00 }

  marketing:
    skills: [brand-copy, asset-render]   # no `publish` skill ⇒ no token, ever
    tools: { profile: authoring }
    budget: { per_run_usd: 1.50, per_day_usd: 8.00 }

  intake:                                # reads tickets, inbound mail, web pages
    model: tier3
    sandbox: { mode: all, workspaceAccess: none }
    skills: []                           # ZERO skills ⇒ ZERO injected credentials
    tools: { profile: quarantine, deny: [exec, write, edit, message, browser, web_fetch] }
```

`reports_to` compiles into `subagents.allowAgents` and `tools.agentToAgent` allowlists — **the org chart made real: literally who may delegate to whom.**

### 2.4 The intake pattern — how we survive prompt injection

This is the load-bearing safety design, and it is architectural rather than hopeful.

OpenClaw's threat model puts prompt-injection-only chains **out of scope**, and notes adaptive attackers exceed 80% success against state-of-the-art defenses. Every loop here reads attacker-influenceable text: PostHog event properties, inbound replies, PR diffs, receipts, transcripts.

**The rule: untrusted input and credentials never coexist in one agent.** Anything reading untrusted text runs as `intake` — `skills: []` so no credentials are injected, `sandbox: {mode: all, workspaceAccess: none}`, tier-3 model, and a deny list covering exec, write, message, and network. Its only output is structured text handed up to `ops`. **An injection that lands there controls an agent that holds nothing and can do nothing.**

Two supporting rules:
- **`tepui-compile` refuses to emit any agent without an explicit `sandbox` block.** The docs contradict each other on the default; never rely on it.
- **Condition-trigger scripts run unattended with the owning agent's full tool policy, including `exec`.** So sensor scripts belong to low-privilege agents only, and are code-reviewed like production code — because that is what they are.

---

## 3. Repo layout

**`tepui-core`** — public, MIT, cloned to `~/.openclaw/tepui-core`.

The top-level split is deliberate: **`lib/` and `loops/` survive a runtime change; `runtime/` is the part you throw away.** Roughly 60/40 by line count. Making that a directory boundary rather than a claim is what keeps the escape hatch real.

```
tepui-core/
├── AGENTS.md  CLAUDE.md  COMPANY.template.md
│
│   ── runtime-agnostic: portable to any runner ──
├── org.yaml                          # org chart, declarative
├── loops/<loop>/
│   ├── SKILL.md                      # spec-clean agentskills.io — no runtime tool names
│   ├── setup.md                      # the interview that generates the overlay
│   ├── sensor.yaml                   # layer 1, declared (not scheduled)
│   ├── policy.yaml                   # layer 2, capabilities by name
│   ├── scripts/                      # layer 3 deterministic, no model
│   ├── evals/cases/*.yaml            # layer 4
│   └── memory/.gitkeep               # layer 5 mount point, empty in core
├── lib/                              # ~1,050 LOC — capability no runtime provides
│   ├── budget/                       #   spend accounting + cap logic
│   ├── evals/                        #   case runner, property assertions
│   ├── learn/                        #   drafted-vs-shipped differ
│   └── decisions/                    #   record schema + review_on sweep
│
│   ── runtime-specific: the throwaway layer ──
└── runtime/
    ├── openclaw/                     # ~650 LOC — the glue
    │   ├── config/*.json5            #   tool profiles, model tiers, archetypes
    │   ├── compile.ts                #   org.yaml + policy.yaml → agents.entries
    │   ├── sync.ts                   #   sensor.yaml → automations (the SQLite fix)
    │   ├── plugin/                   #   pre-LLM budget gate, digest, hooks
    │   └── workflows/*.lobster.yaml  #   approval gates
    └── claude/                       # the escape hatch, kept working
```

**`tepui-company`** — private, cloned to `~/.openclaw/tepui`. **This repo IS the agents' workspace root**, which makes layer 5 git-native for free:

```
tepui/
├── openclaw.include.json5   core.lock   sensors.lock.json
├── COMPANY.md   company/{profile,brand,policies}.md
├── org.overlay.yaml
├── generated/*.json5                 # committed compiler output
├── agents/<agentId>/{AGENTS.md,IDENTITY.md,MEMORY.md,memory/,skills/}
├── loops/<loop>/memory/{_insights.md,_examples/,_drafts/,_published/}
├── decisions/<date>-<slug>.md
└── .env                              # GITIGNORED
```

---

## 4. What we build on top

OpenClaw gives excellent primitives and **no opinion above them**. "Employees" is our construction, not a runtime guarantee. Roughly **1,600–1,800 lines**, ranked by what blocks Phase 0.

**~1,050 of those lines live in `lib/` and are capability you would build on any runtime** — a spend cap, an eval harness, a learning differ, decision records. None of these exist in OpenClaw, Paperclip, or Claude Code. **~650 live in `runtime/openclaw/` and are glue** you would rewrite if you switched. That ratio is the honest answer to "isn't the core just an OpenClaw setup?" — it is not, but the config layer is thinner than the directory tree suggests.

| # | Component | LOC | Notes |
|---|---|---|---|
| 4.1 | **`runtime/openclaw/compile.ts`** | ~250 | `org.yaml` + `policy.yaml` → `generated/`. Idempotent (CI asserts `git diff --exit-code`). Fails closed on: a credential referenced by an agent lacking the owning skill; approvals with no matching workflow; **any agent without an explicit `sandbox` block** |
| 4.2 | **`runtime/openclaw/sync.ts`** | ~300 | Reads `sensor.yaml`, converges OpenClaw automations, writes `sensors.lock.json`. **This is the entire cost of the SQLite/git gap** |
| 4.3 | **`lib/budget/` + plugin gate** | ~400 | ⚠️ **OpenClaw has NO native per-run or per-day dollar cap.** Pre-LLM gate that refuses a run over budget. **Nothing autonomous runs before this exists** |
| 4.4 | **`lib/evals/`** | ~300 | Biggest genuine gap — OpenClaw's eval stack is its own regression suite, gated behind private build flags. Regression disables the loop's automations |
| 4.5 | **`lib/learn/`** | ~250 | Drafted-vs-shipped diff → `_insights.md` → PR. Bypasses Skill Workshop, which refuses to touch git-committed skills and is disabled for cron runs anyway |
| 4.6 | **`core.lock` verification** | ~100 | Pinned 40-char SHA + sha256 blob digests, fail-closed at gateway startup |
| 4.7 | **Review digest** | ~1 day | Delivered to Telegram each morning. **Must report silence as a finding** — SaaStr's four-month failure was a silence failure |
| 4.8 | **Decisions sweep** | ~100 | Cron `command` payload scanning `decisions/*.md` for `review_on <= today` |

---

## 5. Three things to verify before committing

In priority order. The first is the cheapest test with the highest stakes.

1. **Cross-agent credential visibility.** Per-skill env injection goes into `process.env` of the host agent process. With concurrent runs of different agents in one gateway, this is a plausible cross-agent secret leak, and no doc resolves it. **Test:** run an agent with `skills: []` and a read tool concurrently with the marketing loop, ask it to dump its environment. If it sees `IMAGE_API_KEY`, the single-gateway capability model is broken and we adopt **profile separation** (`openclaw --profile`, separate state dir, second container, ~200 MB) immediately.
2. **Whether any native spend cap exists.** None was found. If one does, §4.3 shrinks a lot.
3. **The sandbox default.** The threat model and the config examples contradict each other. Emit it explicitly for every agent regardless.

---

## 6. Phases

### Phase 0 — Foundation, and the two tests that can kill it
1. Hetzner box, docker compose (**pin the image by digest, not `:latest`**), gateway on loopback, Tailscale Serve, Telegram bot for `ops`.
2. **The credential-isolation test (§5.1).** Before anything is built on the single-gateway assumption.
3. **The portability test:** one spec-clean `SKILL.md` running unmodified on OpenClaw *and* Claude Code. OpenClaw independently implements agentskills.io, so this doubles as migration insurance.
4. `runtime/openclaw/compile.ts`, `generated/` committed, `$include` wiring, `lint.yml`.
5. **`lib/budget/` + the plugin gate. Nothing autonomous runs before this exists.**

**Done when:** a hello-world loop fires from a git-defined sensor, is refused when over budget, and CI is green.

### Phase 1 — Loop machinery
`runtime/openclaw/sync.ts` + drift check; the `ops` agent, review digest, failure alerts; `lib/evals/` with one case and regression-disables-loop wiring.

### Phase 2 — Loop #1: Analyst/PostHog
Cleanest feedback signal — a query either answered correctly or it didn't. First proof that condition triggers make sensors nearly free. Also owns the `review_on` decisions sweep. **Cost target: < $0.05/query blended.**

### Phase 3 — Loop #2: Marketing/design assets
Lobster publish workflow with a human approval gate, and the `bin/publish-asset` credential split — **the marketing agent never holds the publishing token.** Image generation is priced per-image; budget it separately.

### Phase 4 — Dogfood
Two weeks of real operation. Measure **unit cost per useful output** and **human-edit rate** — not volume, not time saved, not how productive it feels. *A loop whose `_insights.md` is still empty after two weeks is a script, and should be demoted to one.*

### Phase 5 — Expand
Sales outreach, code review, bug fixer, expenses, sales calls, video.

---

## 7. Cost

- **Infrastructure:** ~$5–12/mo (Hetzner CX22-class, 2 GB minimum — 1 GB OOMs the build). Tailscale free tier covers two people.
- **Inference:** the routing table in [docs/cost.md](docs/cost.md) is unchanged and now fully expressible — per-agent `model`/`utilityModel` plus per-job `--model`/`--fallbacks`/`--thinking`.
- **Condition triggers are the new lever:** `fire: false` costs no model call at all, so polling is nearly free. This is cheaper than any cron-plus-model arrangement.
- **Target: under $50/month** for the first two loops, infrastructure included.

---

## 8. Honest costs of this choice

- **SQLite is now an operational dependency.** Jobs, run history, and sessions are not in git. Nightly `sqlite3 .backup` to object storage. Losing it loses history, not loops.
- **We operate a VPS.** Two people patching an always-on gateway is a real recurring tax no feature table shows.
- **Fast upstream.** Renames are already visible (`cron` → `automations`, `clawflow` → `taskflow`). Pin by digest; re-read the automation and plugin SDK docs before writing the plugin.
- **The 52 bundled skills** include `spotify-player` and `sonoscli`. Mitigated by per-agent `skills: [...]` — an explicit list **replaces** defaults entirely, so every agent gets an exhaustive list and inherits nothing.
- **ClawHub is public only.** No private registry, so the overlay ships by git — which is what we wanted anyway, but it means the core is `git clone` + `core.lock`, not a marketplace install.
- **The base rate is still bad.** Nobody has documented running marketing, sales, or finance on agents at a named company, and over half of Anthropic's own staff can fully delegate only 0–20% of their work. See [docs/evidence.md](docs/evidence.md). Getting the runtime right does not move that number.

## 9. What would make this fail

- **Loops that don't learn** — empty `_insights.md` means a prompt library with extra steps.
- **Nobody reads the digest** — that is how you rebuild SaaStr's four-month silent failure.
- **The credential-isolation test failing and being ignored.** It would mean every agent effectively holds every secret.
- **Sensor scripts treated as config rather than code.** They run unattended with `exec`.
- **Portability as theatre** — if `adapters/claude/` stops working, the escape hatch is fictional.
