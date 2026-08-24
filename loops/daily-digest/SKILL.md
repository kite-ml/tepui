---
name: daily-digest
description: >
  Morning summary of what the company's agents did: which jobs ran, what they
  cost, what was learned, and — most importantly — which jobs did nothing.
  Use when asked for the daily digest or when the daily-digest schedule fires.
license: MIT
---

# daily-digest

The defense against silent failure. An agent system's most documented way to
rot is a job that quietly stops working while everyone assumes it is fine —
so this digest reports **silence as a finding**, not as an absence of news.

## What to do

1. Skim `MEMORY.md` for lessons under "## daily-digest".
2. Run the collector from this skill's directory: `scripts/collect.mjs`.
   It prints a compact report: jobs run in the last 24h, spend per agent,
   loops that ran nothing, and what changed in agent memory.
3. Reply with a SHORT digest — under 15 lines. Your final reply is delivered
   to the Slack channel by the scheduler; do not try to post it yourself:
   - anything that FAILED or was refused over budget, first
   - loops that were silent (enabled but ran nothing), second
   - what ran and what it cost, compressed
   - one line: what was learned yesterday, if anything
4. If a section of the collector output is missing, say so plainly
   ("no spend data") rather than guessing.

## Rules

- Numbers come from the collector verbatim. Never estimate or invent one.
- If everything is healthy, the digest is three lines. Do not pad it.
- After posting: if something recurring surprised you (a job that keeps
  failing, a cost that keeps growing), append one line to `MEMORY.md` under
  "## daily-digest".
