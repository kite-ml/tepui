#!/usr/bin/env node
/**
 * Deterministic collector for the daily digest. No model involved — this is
 * exactly the kind of work that should never cost a token.
 *
 * Each section is defensive: a missing source prints a MISSING marker rather
 * than crashing the whole report, because a digest that dies on one bad
 * source is itself a silent failure.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// The skill runs from a managed COPY inside an agent workspace, so directory
// depth is unreliable. The repo root comes from git — the same rule the
// portability doc mandates for every script.
let ROOT;
try { ROOT = execFileSync("git", ["-C", HERE, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(); }
catch { ROOT = resolve(HERE, "../../.."); }
const COMPANY = process.env.TEPUI_COMPANY ?? join(ROOT, "company");
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", timeout: 20_000 });

// The runtime's exec tool spawns a login shell, which resets PATH — so a bare
// `openclaw` may resolve against a Node too old for it (observed live, and
// reported by the digest itself). Resolve both explicitly.
import { existsSync } from "node:fs";
function openclaw(args) {
  const node = existsSync("/tmp/node24/bin/node") ? "/tmp/node24/bin/node" : process.execPath;
  for (const mjs of [
    "/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs",
    "/usr/local/lib/node_modules/openclaw/openclaw.mjs",
  ]) if (existsSync(mjs)) return sh(node, [mjs, ...args]);
  return sh("openclaw", args);
}

const out = [];
const day = new Date().toISOString().slice(0, 10);
out.push(`# tepui digest — ${day}`);

// ── spend per agent (from the budget proxy ledger) ─────────────────────────
try {
  const spendDir = process.env.TEPUI_SPEND_DIR ?? join(COMPANY, "spend");
  const totals = JSON.parse(readFileSync(join(spendDir, "totals.json"), "utf8"));
  const today = Object.entries(totals).filter(([k]) => k.endsWith(day));
  out.push("", "## spend today");
  if (!today.length) out.push("- nothing spent");
  for (const [k, micros] of today.sort((a, b) => b[1] - a[1])) {
    out.push(`- ${k.split(":")[0]}: $${(micros / 1e6).toFixed(4)}`);
  }
} catch { out.push("", "## spend today", "- MISSING: no ledger (proxy not running?)"); }

// ── scheduled jobs: what ran, what failed, what was silent ─────────────────
try {
  const jobs = JSON.parse(openclaw(["cron", "list", "--json"]));
  const list = Array.isArray(jobs) ? jobs : jobs.jobs ?? [];
  const tepui = list.filter((j) =>
    (j.declarationKey ?? j.declaration_key ?? j.name ?? "").startsWith("tepui:"));
  out.push("", "## scheduled jobs");
  if (!tepui.length) out.push("- MISSING: no tepui jobs declared (run sync?)");
  for (const j of tepui) {
    const name = j.declarationKey ?? j.name;
    const state = j.enabled === false ? "disabled" : "enabled";
    const last = j.lastRunAt ?? j.last_run_at ?? j.state?.lastRunAt ?? null;
    const lastStatus = j.lastStatus ?? j.state?.lastStatus ?? "";
    const silent = !last || (Date.now() - new Date(last).getTime()) > 26 * 3600 * 1000;
    out.push(`- ${name}: ${state}${last ? `, last run ${last} ${lastStatus}` : ""}${silent ? "  ⚠️ SILENT >26h" : ""}`);
  }
} catch (e) { out.push("", "## scheduled jobs", `- MISSING: cron list failed (${String(e).slice(0, 80)})`); }

// ── enabled loops with no job at all ───────────────────────────────────────
try {
  const raw = readFileSync(join(COMPANY, "generated", "sensors.json"), "utf8");
  const sensors = JSON.parse(raw.slice(raw.indexOf("[")));
  out.push("", "## declared sensors", ...sensors.map((s) => `- ${s.key} (${s.kind})`));
} catch { out.push("", "## declared sensors", "- MISSING: generated/sensors.json"); }

// ── decisions due for review ───────────────────────────────────────────────
// Every decision record carries a review_on date: the day we check whether it
// actually worked. Most organizations never do this; the digest makes
// forgetting the harder path.
try {
  const decDir = join(COMPANY, "decisions");
  const due = [];
  for (const f of readdirSync(decDir).filter((f) => f.endsWith(".md"))) {
    const txt = readFileSync(join(decDir, f), "utf8");
    const m = txt.match(/^review_on:\s*(\d{4}-\d{2}-\d{2})/m);
    const st = txt.match(/^status:\s*(\S+)/m)?.[1] ?? "?";
    if (m && m[1] <= day && st !== "superseded") due.push(`- ${f} (review was due ${m[1]}, status ${st})`);
  }
  out.push("", "## decisions due for review");
  out.push(...(due.length ? due : ["- none"]));
} catch { out.push("", "## decisions due for review", "- MISSING: no decisions/ directory"); }

// ── what was learned (agent memory changes in the last day) ────────────────
try {
  const diff = sh("git", ["-C", COMPANY, "log", "--since=26 hours ago", "--name-only",
    "--pretty=format:", "--", "agents/*/MEMORY.md", "agents/*/memory/*"]).trim();
  out.push("", "## learned since yesterday");
  if (diff) out.push(...new Set(diff.split("\n").filter(Boolean).map((f) => `- ${f}`)));
  else out.push("- nothing recorded");
} catch { out.push("", "## learned since yesterday", "- MISSING: not a git checkout"); }

console.log(out.join("\n"));
