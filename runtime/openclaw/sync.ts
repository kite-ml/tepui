/**
 * tepui sensor reconciler: generated/sensors.json -> the runtime's cron store.
 *
 * Git is the author; the job store is a cache. Every declared sensor becomes a
 * cron job with a stable --declaration-key, which the CLI treats as an
 * idempotent identity — re-running sync updates in place instead of
 * duplicating. Jobs carrying a tepui: key that git no longer declares are
 * removed. Jobs WITHOUT a tepui: key are never touched: a human's ad-hoc cron
 * experiments are not ours to delete.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

function openclawBin(): string[] {
  for (const p of [
    "/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs",
    "/usr/local/lib/node_modules/openclaw/openclaw.mjs",
  ]) if (existsSync(p)) return [process.execPath, p];
  return ["openclaw"];
}

function oc(args: string[]): string {
  const [cmd, ...pre] = openclawBin();
  return execFileSync(cmd, [...pre, ...args], { encoding: "utf8", timeout: 30_000 });
}

export function sync(companyDir: string, { dryRun = false } = {}) {
  const raw = readFileSync(join(companyDir, "generated", "sensors.json"), "utf8");
  const desired: any[] = JSON.parse(raw.slice(raw.indexOf("[")));

  const listRaw = JSON.parse(oc(["cron", "list", "--json"]));
  const existing: any[] = Array.isArray(listRaw) ? listRaw : listRaw.jobs ?? [];
  const keyOf = (j: any) => j.declarationKey ?? j.declaration_key ?? "";
  const tepuiJobs = existing.filter((j) => keyOf(j).startsWith("tepui:"));

  const actions: string[] = [];
  for (const s of desired) {
    const args = [
      "cron", "add", "--json",
      "--declaration-key", s.key,
      "--name", s.key,
      "--agent", s.agent,
      "--session", s.session ?? "isolated",
      "--message", s.message,
    ];
    if (s.kind === "cron") { args.push("--cron", s.cron); if (s.tz) args.push("--tz", s.tz); }
    else if (s.kind === "every") { args.push("--every", s.every); }
    if (s.trigger_script) args.push("--trigger-script", join(ROOT, s.trigger_script));
    actions.push(`apply ${s.key}`);
    if (!dryRun) oc(args);
  }

  const desiredKeys = new Set(desired.map((s) => s.key));
  for (const j of tepuiJobs) {
    if (desiredKeys.has(keyOf(j))) continue;
    actions.push(`remove ${keyOf(j)} (${j.id})`);
    if (!dryRun) oc(["cron", "rm", "--id", j.id]);
  }

  if (!dryRun) {
    writeFileSync(join(companyDir, "sensors.lock.json"),
      JSON.stringify({ appliedAt: new Date().toISOString(), keys: [...desiredKeys] }, null, 1) + "\n");
  }
  return actions;
}

// ---- CLI ------------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const companyDir = resolve(process.argv[2] ?? join(ROOT, "company"));
  const dryRun = process.argv.includes("--dry-run");
  try {
    const actions = sync(companyDir, { dryRun });
    for (const a of actions) console.log(`${dryRun ? "[dry] " : ""}${a}`);
    console.log(`sync: ${actions.length} action(s)${dryRun ? " (dry run)" : ""}`);
  } catch (e: any) {
    console.error(`sync FAILED: ${e.message}`);
    console.error("Is the gateway running? sync talks to it through the CLI.");
    process.exit(1);
  }
}
