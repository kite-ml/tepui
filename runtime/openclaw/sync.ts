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
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

function openclawBin(): string[] {
  // process.execPath may be a Node too old for openclaw when this script was
  // launched by an older system node — resolve a pinned Node explicitly, the
  // same trap the digest collector hit via login-shell PATH resets.
  const node = ["/tmp/node24/bin/node", "/usr/local/node24/bin/node"].find(existsSync) ?? process.execPath;
  for (const p of [
    "/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs",
    "/usr/local/lib/node_modules/openclaw/openclaw.mjs",
    "/usr/local/node24/lib/node_modules/openclaw/openclaw.mjs",
  ]) if (existsSync(p)) return [node, p];
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

  // cron add with an existing --declaration-key is idempotent about IDENTITY
  // (no duplicates) but does not patch changed fields — a job edited in git
  // kept its old delivery config, observed live. So each declared spec carries
  // its own hash in the job description; on mismatch the job is recreated.
  // Matching jobs are left alone, which also preserves their run history —
  // the digest's silence detection depends on that history.
  const byKey = new Map(tepuiJobs.map((j) => [keyOf(j), j]));
  const specHash = (x: any) => "tepui-spec:" + createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 12);

  const actions: string[] = [];
  for (const s of desired) {
    const session = s.session ?? "isolated";
    const args = [
      "cron", "add", "--json",
      "--declaration-key", s.key,
      "--name", s.key,
      "--agent", s.agent,
      "--session", session,
    ];
    // This version's contract: isolated jobs take an agent message; main-
    // session jobs take a system event, which the agent's heartbeat processes
    // in its own conversation context.
    if (session === "main") args.push("--system-event", s.message);
    else {
      args.push("--message", s.message);
      if (s.announce_channel) {
        // The run's final text is delivered to this channel — for loops like
        // the digest, announce IS the posting mechanism.
        // --channel is the channel TYPE; --to is the destination within it.
        args.push("--announce", "--channel", "slack", "--to", s.announce_channel, "--best-effort-deliver");
      } else {
        // Without an explicit route the CLI defaults to announce->last, which
        // fails a scheduler-initiated run after the work is done.
        args.push("--no-deliver");
      }
    }
    if (s.kind === "cron") { args.push("--cron", s.cron); if (s.tz) args.push("--tz", s.tz); }
    else if (s.kind === "every") { args.push("--every", s.every); }
    if (s.trigger_script) args.push("--trigger-script", join(ROOT, s.trigger_script));
    const hash = specHash(s);
    args.push("--description", hash);

    const existing = byKey.get(s.key);
    const existingHash = existing?.description ?? existing?.desc ?? "";
    if (existing && existingHash === hash) { actions.push(`ok ${s.key}`); continue; }
    if (existing) {
      actions.push(`recreate ${s.key} (spec changed)`);
      if (!dryRun) oc(["cron", "rm", existing.id]);
    } else {
      actions.push(`add ${s.key}`);
    }
    if (!dryRun) oc(args);
  }

  const desiredKeys = new Set(desired.map((s) => s.key));
  for (const j of tepuiJobs) {
    if (desiredKeys.has(keyOf(j))) continue;
    actions.push(`remove ${keyOf(j)} (${j.id})`);
    if (!dryRun) oc(["cron", "rm", j.id]);
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
