---
name: hello-world
description: >
  Smoke-test loop for tepui. Reports one line confirming the loop fired, what
  triggered it, and the current UTC time. Use when verifying that a sensor,
  the budget gate, or the review digest is wired correctly.
license: MIT
---

# hello-world

The smallest possible loop. It exists to prove the machinery works end to end,
and it is deliberately spec-clean so it runs unmodified on more than one runtime.

## What to do

1. Read `state.json` in this skill's directory if it exists. If not, treat the
   run count as zero.
2. Increment the run count and write it back.
3. Report exactly one line: the run count, what triggered this run, and the
   current UTC timestamp.

## Rules

- Do not read anything outside this skill's directory.
- Do not call the network.
- If a step fails, say so plainly in the output line rather than retrying.

## Notes on portability

This file names capabilities generically on purpose. It refers to reading and
writing *files*, never to a specific runtime's tool name, so the same file runs
on any host implementing the Agent Skills spec. Runtime-specific gates belong in
`metadata.<vendor>`, which other hosts ignore.
