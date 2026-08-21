# Local Phase 0 validation

Run both kill-tests on a laptop before paying for a VPS. If either fails, the
architecture changes and we have spent nothing.

```bash
cd runtime/openclaw/local
docker compose up -d
docker compose logs -f gateway     # wait for the gateway to report ready
```

## Test 1 — credential isolation (highest stakes, cheapest test)

**The question:** OpenClaw injects per-skill credentials into `process.env` of
the host agent process. With concurrent runs of different agents inside one
gateway, can agent B read agent A's secret?

**Why it matters:** if it can, the single-gateway capability model is broken —
`marketing` holding an image key would effectively mean `intake` holds it too,
and the entire intake quarantine pattern is decorative.

**Run it:**
```bash
node ../../../test/credential-isolation.mjs
```

**If it FAILS:** adopt profile separation immediately, before anything is built
on the single-gateway assumption. `openclaw --profile <name>` gives a separate
state directory, so credential-bearing agents run in a second gateway process on
the same box, addressed over loopback. Costs one more container, ~200 MB.

## Test 2 — portability

One spec-clean `SKILL.md` running unmodified on OpenClaw *and* Claude Code.

```bash
node ../../../test/portability.mjs
```

Proves the "same skill, two runtimes" claim is real rather than borrowed, and
doubles as migration insurance.

## Teardown

```bash
docker compose down          # keep state
docker compose down -v       # wipe state
```
