# Portability

**The runtime is OpenClaw. The content is not.**

Every workflow, every procedure, every piece of company knowledge in `tepui` is markdown and shell scripts. The runtime is a shell around them, and the shell is replaceable. This document is what makes that true rather than aspirational.

> Verified August 2026. Re-check specifics before relying on them — this landscape moves.

---

## 1. What ports, by layer

| Layer | Portable? | Why |
|---|---|---|
| **`SKILL.md`** | **Yes** | OpenClaw implements the agentskills.io spec **independently** of Anthropic. The same file runs on Claude Code, Codex, Goose, opencode, and Cline |
| **`scripts/`** | **Yes — 100%** | Every runner can run bash. Anything expressible as "run this script" is runner-independent by construction |
| **Lobster workflows** | **Yes** | Lobster ships a standalone CLI, so `workflows/*.lobster.yaml` runs outside OpenClaw |
| **Markdown memory, `decisions/`, `company/`** | **Yes — 100%** | They are files. This is the durable asset |
| **`evals/cases/*.yaml`** | **Yes** | Our own format, our own runner |
| **MCP servers** | **~100%** | Protocol-identical; only ~10 lines of registration differ per runner |
| `generated/*.json5` | **No** | Compiler output — regenerate for a new runtime |
| `bin/tepui-sync` (sensor reconciler) | **No** | Talks to OpenClaw's automations CLI |
| `plugins/tepui/` | **No** | Built on OpenClaw's plugin SDK |

**The OpenClaw-specific surface is three items**, and it's comparable in size to the Claude Code adapter this project always budgeted for. Provider-neutrality survives.

## 2. The standards layer underneath

Since **December 2025**, the Linux Foundation's **Agentic AI Foundation** has governed three projects that matter here: **MCP** (contributed by Anthropic), **AGENTS.md** (contributed by OpenAI), and **goose** (Block). Platinum members include AWS, Anthropic, Google, Microsoft, and OpenAI.

So the two layers a company OS depends on most — how you describe your project, and how you connect your tools — are neutral ground under a foundation rather than one vendor's format. **Agent Skills is the third**, and OpenClaw's independent implementation of it is the reason our loop content is portable at all.

## 3. The rules that keep the adapter thin

Non-negotiable, and CI enforces what it can:

1. **Core `SKILL.md` files refer to capabilities generically** — `exec`, `web_fetch`, `read` — and **never name an OpenClaw tool or `lobster` in prose.** Runtime-specific gates go in `metadata.openclaw`, where another runner will ignore them.
2. **Logic lives in skills and scripts.** Anything expressible as a deterministic script goes in `scripts/`, which is the one layer that ports without thought.
3. **Scripts resolve the repo root themselves** (`git rev-parse --show-toplevel`). Never depend on a runtime's environment variables.
4. **Credentials are referenced by name, never by mechanism.** `policy.yaml` says an agent needs `POSTHOG_READ_KEY`; *how* it gets injected is the compiler's problem.
5. **Keep permission grammar and model routing out of committed workflow files.** They're the least portable things in the stack, and neither is business logic.

## 4. The escape hatch, kept working

`adapters/claude/` stays in the repo and stays functional. It is now the escape hatch rather than the primary path — which is a better place for it, since an adapter that only exists on paper is worthless the day you need it.

**The Phase 0 test that keeps it honest:** one spec-clean `SKILL.md` running unmodified on **both** OpenClaw and Claude Code, same day, both hosts. That single test is simultaneously:

- proof the portability claims above are real rather than borrowed,
- migration insurance if OpenClaw goes sideways,
- and a forcing function that stops runtime-specific idioms leaking into core skills.

If it fails, the neutral-core thesis is wrong and we should pick one host and commit, rather than shipping a portability claim we cannot honor.

## 5. Running locally

First-class, and one of the better reasons to be on OpenClaw.

It supports **50+ providers**, including Ollama, vLLM, LM Studio, and SGLang via OpenAI-compatible endpoints — plus LiteLLM and OpenRouter as routing layers. Model choice is per-agent (`model`, `utilityModel`) **and** per-job (`--model`, `--fallbacks`, `--thinking`), so a single loop can run locally while another runs on a frontier model.

There's a detail that matters operationally: before an isolated scheduled run starts, OpenClaw **preflights local endpoints** whose base URL is loopback, private-network, or `.local`. A dead Ollama server records the run as `skipped` with a clear error instead of starting a model call, and the result is cached for five minutes per endpoint — so many due jobs sharing a dead server cost one probe rather than a request storm.

**Where local is good enough:** classification, extraction, routing, tagging, summarizing known-shape documents, first-draft copy. Exactly the tier-3 workloads in [cost.md](cost.md) — high volume, low stakes, and forgiving of a quality gap the human review step catches anyway. The `intake` agent is the natural first candidate: it reads untrusted text, holds nothing, and needs no frontier reasoning.

**Where it isn't:** hard agentic coding, long-horizon autonomous work, and anything where a subtly wrong answer is expensive.

**The honest economics:** self-hosting rarely wins on cost alone at this scale — see [cost.md](cost.md). The real arguments for local are **data residency and privacy**. If a workflow touches data that must not leave your infrastructure, local is the answer regardless of the math.

## 6. If we leave OpenClaw

What you'd rewrite: the compiler's output target, the sensor reconciler, and the plugin. Roughly the same 300–400 lines any runtime adapter costs.

What you'd keep, untouched: every `SKILL.md`, every script, every Lobster workflow, all agent memory and standing orders, `company/`, `decisions/`, and `evals/`. **That is the entire intellectual content of the company OS.**

The thing that is never portable, on any runtime, is your permission policy and your model routing. So don't encode business logic in either.
