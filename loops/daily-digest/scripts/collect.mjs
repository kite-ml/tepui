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
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");                 // repo root
const COMPANY = process.env.TEPUI_COMPANY ?? join(ROOT, "company");
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", timeout: 20_000 });

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
  const jobs = JSON.parse(sh("openclaw", ["cron", "list", "--json"]));
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

// ── what was learned (agent memory changes in the last day) ────────────────
try {
  const diff = sh("git", ["-C", COMPANY, "log", "--since=26 hours ago", "--name-only",
    "--pretty=format:", "--", "agents/*/MEMORY.md", "agents/*/memory/*"]).trim();
  out.push("", "## learned since yesterday");
  if (diff) out.push(...new Set(diff.split("\n").filter(Boolean).map((f) => `- ${f}`)));
  else out.push("- nothing recorded");
} catch { out.push("", "## learned since yesterday", "- MISSING: not a git checkout"); }

console.log(out.join("\n"));
