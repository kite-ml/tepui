---
name: content-draft
description: >
  Write one content draft (a post, an announcement, a short update) into the
  drafts folder. Use when asked for a draft or when the weekly content
  schedule fires. Never publishes anything.
license: MIT
---

# content-draft

Drafts only, by construction: this agent holds no publishing credential, so
the worst a bad draft can do is sit unread in a folder.

## What to do

1. Skim `MEMORY.md` for lessons under "## content-draft" — voice corrections
   and topics that landed live there.
2. Decide the topic: use the one given in the request; on the weekly run,
   pick the most recent thing worth telling the outside world (check your
   daily memory notes for what happened this week).
3. Write ONE draft to `./drafts/YYYY-MM-DD-<slug>.md`:
   - first line: `# <title>`
   - a `status: draft` line
   - the piece, under 200 words unless asked otherwise
4. Reply with the file path and a one-line summary — not the full text.

## Rules

- Never invent a fact, metric, customer name, or quote. A draft with a hole
  in it says `[NEEDS: exact number]` rather than a plausible guess.
- One draft per run. Quality over volume.
- Afterwards, if a voice or topic lesson emerged (a human edited your last
  draft, a phrasing was corrected), append one line to `MEMORY.md` under
  "## content-draft".
