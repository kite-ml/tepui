# What is OpenClaw, and what is tepui?

The most common question about this repo — reasonably, since at a glance it can look like an elaborate config directory. This is the file-by-file answer.

**Short version:** OpenClaw is the *runtime*. tepui is the *company layer* on top of it — an org chart, capability policy, a spend gate, and the loop structure. OpenClaw supplies excellent primitives and deliberately no opinion above them. tepui is the opinion.

---

## The four categories

### 1. OpenClaw itself — zero lines in this repo

We do not vendor it, fork it, or copy it. It arrives two ways:

| What | How it's pinned | Why |
|---|---|---|
| The gateway | `ghcr.io/openclaw/openclaw@sha256:2f5ce884…` | Digest, not `:latest` — upstream moves weekly and a floating tag makes results irreproducible |
| The Slack channel | `@openclaw/slack@2026.7.1` | Slack is a plugin, not core. Pinned to the gateway version; a floating plugin against a pinned core is the worst of both worlds |
| The sandbox base | `debian:bookworm-slim` + python3 | The runtime requires python3 for its write/edit helpers and refuses to substitute a plain image |

Their repo is ~2.7 GB and moves fast. Vendoring it would mean inheriting their merge conflicts forever, for no benefit.

### 2. OpenClaw-shaped config — ~126 lines, rewritten on a runtime switch

| File | Lines | What it is |
|---|---|---|
| `runtime/openclaw/local/docker-compose.yml` | 49 | Split ro/rw mounts, memory limits, the digest pin |
| `runtime/openclaw/sandbox/Dockerfile` | 25 | The image agent tools execute inside |
| `runtime/openclaw/local/Dockerfile` | 13 | Gateway + Slack plugin |
| `openclaw.json` *(untracked — it holds secrets)* | ~39 | A stub: bind config plus `$include` pointers at generated files |

**Only ~39 lines are actual OpenClaw settings.** Everything else the runtime needs is generated.

### 3. The adapter — 531 lines, the interesting boundary

`runtime/openclaw/compile.ts` reads `org.yaml` + `org.overlay.yaml` + `loops/*/policy.yaml` and emits OpenClaw's `agents.json5`, `skills.json5`, `models.json5`, `channels.json5`, `bindings.json5`.

This is **ours**, not OpenClaw's — it just happens to target their schema. On a runtime switch you rewrite the *emit* half. The *input* half — the org chart, and every fail-closed invariant — is unchanged:

- no agent without an explicit `sandbox` block
- `sandbox: off` requires a written justification
- an untrusted-input agent may hold **no** credentials, must be fully sandboxed, must deny exec/write/message/network
- no credential grant broader than what its loops declare
- approvals must have an implementing workflow
- an evaluation-tier provider may not serve a loop handling company data

Those are company policy. They would survive on any runtime, and OpenClaw has no concept of any of them.

### 4. Portable — 1,853 lines, survives any runtime change

| Path | Lines | What |
|---|---|---|
| `docs/` | 636 | Principles, cost model, field evidence, portability, this file |
| `test/` | 569 | 33 invariant tests |
| `deploy/` | 227 | GCP provisioning, Slack app manifest and setup |
| `lib/budget/` | 204 | Spend gate — **OpenClaw has no dollar cap of any kind** |
| `loops/` | 120 | Loop contract: SKILL.md, sensor, policy, condition script |
| `org.yaml` | 97 | The org chart |

**Composition: 729 lines adapter (28%), 1,853 portable (72%).**

---

## What OpenClaw gives us that we would otherwise build badly

Worth being explicit, because these are the reasons to be on it at all:

- **Tool policy enforced before the model call.** A denied tool's schema is never sent, so capability absence cannot be prompt-injected past. Verified live: the analyst asked to write a file reports it only has `session_status`.
- **Condition triggers.** A script returning `{fire: false}` reschedules with **no model call and no run history**. Polling becomes free.
- **Per-agent isolation.** Own workspace, model, skill allowlist, sandbox, delegation limits.
- **Socket Mode channels.** Slack over an outbound WebSocket — no public URL, no ingress, works identically on a laptop, a zero-ingress VM, and a Mac mini behind NAT.
- **A mature scheduler.** Watchdogs, overdue rescheduling, failure counting, run history.

## What OpenClaw does not give us, and we build

- **An org chart.** `agents.entries` plus bindings, and no concept above them. `reports_to` → delegation allowlists is entirely ours.
- **A spend cap.** There is no native per-run or per-day dollar limit. This is why `lib/budget/` exists and why nothing autonomous runs before it does.
- **An eval harness for your workflows.** Its eval stack is its own regression suite, behind private build flags.
- **A learning loop.** Nothing diffs drafted-vs-shipped and writes insight back.
- **Decision records.** No ADR concept anywhere.

The last three are **not built yet**. `lib/evals/`, `lib/learn/`, and `lib/decisions/` are empty directories. Today this repo is an org-chart compiler plus a spend gate, well tested. The rest is the plan, not the product.

---

## Where the boundary bites

Three places the runtime's own design constrains us, each with a decision record:

1. **Git is not authoritative by default.** OpenClaw's `$include` does *not* fail closed for `config set` — tested, and it rewrote an included file live, disabling the quarantine agent's sandbox. We enforce it with a **read-only mount** instead. → `decisions/2026-08-21-git-truth-enforced-by-mount.md`
2. **Prompt injection is out of scope, by their own statement.** Our answer is architectural: untrusted input and credentials never coexist in one agent. → the `intake` pattern, `PLAN.md` §2.4
3. **The gateway needs Docker beside it, not around it.** Containerising it would require mounting `docker.sock`, handing host control to anything escaping the sandbox — the exact thing the sandbox exists to prevent. So the gateway runs on the host.

## If we left OpenClaw

You rewrite `runtime/openclaw/` — 729 lines, and 531 of that is the emit half of a compiler whose input contract does not change.

You keep: every `SKILL.md`, every script, the org chart, the budget gate, all 33 tests, the loop contracts, the decision records, and the docs.

That ratio is the whole argument for the structure. `runtime/` is the part designed to be thrown away.

<!-- upstream sync check -->
