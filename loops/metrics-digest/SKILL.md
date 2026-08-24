---
name: metrics-digest
description: >
  Answer questions about the data files in this agent's data folder, and
  produce a weekly summary of what changed. Use when asked about metrics,
  numbers, or trends, or when the weekly metrics schedule fires.
license: MIT
---

# metrics-digest

Generic analytics over files — no external service, no credentials. Drop
exports (CSV or JSON) into the `data/` folder of this agent's workspace and
ask questions, or let the weekly schedule summarize what changed.

## What to do

1. Skim `MEMORY.md` for lessons under "## metrics-digest" — past runs record
   which metrics the humans actually care about and how they read them.
2. List the files in `./data/`. If there are none, say exactly that and stop —
   never demonstrate with invented numbers.
3. For a question: read only the files needed, compute the answer, and show
   the arithmetic in one line so it can be checked.
4. For the weekly run: compare against what MEMORY.md says mattered last time;
   report movements, not a table dump. Under 12 lines.

## Rules

- Every number traces to a file. Say which file each number came from.
- No extrapolation, no trend-fitting beyond what the data shows.
- If two files disagree, report the disagreement — do not pick one silently.
- Afterwards, append one line to `MEMORY.md` under "## metrics-digest" if you
  learned which metrics the humans cared about this week.
