/**
 * Eval runner: obtains a live reply from each loop's owner agent and applies
 * the portable assertion engine. Costs real model calls — run on demand, not
 * on a timer.
 *
 * --disable-on-fail turns a regression into enforcement: the loop's scheduled
 * jobs are disabled so a broken loop stops producing bad output on a timer.
 * Re-running sync after a fix re-enables them (spec unchanged = jobs restored
 * by recreation only if removed; disable is reversed with cron enable).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { assertCase, type EvalCase } from "../../lib/evals/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

function openclawArgs(): string[] {
  for (const p of [
    "/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs",
    "/usr/local/lib/node_modules/openclaw/openclaw.mjs",
  ]) if (existsSync(p)) return [process.execPath, p];
  return ["openclaw"];
}

function runAgent(agent: string, message: string): string {
  const [cmd, ...pre] = openclawArgs();
  const out = execFileSync(cmd, [...pre, "agent", "--agent", agent, "--local", "--message", message],
    { encoding: "utf8", timeout: 300_000 });
  // The CLI mixes diagnostics with the reply; keep non-bracketed lines.
  return out.split("\n").filter((l) => !l.startsWith("[") && l.trim()).join("\n");
}

const loopName = process.argv[2];
const disableOnFail = process.argv.includes("--disable-on-fail");
if (!loopName) { console.error("usage: eval.ts <loop> [--disable-on-fail]"); process.exit(2); }

const loopDir = join(ROOT, "loops", loopName);
const casesDir = join(loopDir, "evals", "cases");
const policy = parseYaml(readFileSync(join(loopDir, "policy.yaml"), "utf8")) as any;
const files = existsSync(casesDir) ? readdirSync(casesDir).filter((f) => f.endsWith(".yaml")) : [];
if (!files.length) { console.log(`no eval cases for '${loopName}'`); process.exit(0); }

let failed = 0;
for (const f of files) {
  const c = parseYaml(readFileSync(join(casesDir, f), "utf8")) as EvalCase;
  process.stdout.write(`  ${c.name} ... `);
  const reply = runAgent(policy.owner, c.message);
  const r = assertCase(c, reply);
  console.log(r.pass ? "pass" : `FAIL\n    ${r.failures.join("\n    ")}\n    reply was: ${reply.slice(0, 200)}`);
  if (!r.pass) failed++;
}

if (failed && disableOnFail) {
  const [cmd, ...pre] = openclawArgs();
  const listRaw = JSON.parse(execFileSync(cmd, [...pre, "cron", "list", "--json"], { encoding: "utf8" }));
  const jobs = (Array.isArray(listRaw) ? listRaw : listRaw.jobs ?? [])
    .filter((j: any) => (j.declarationKey ?? "").startsWith(`tepui:${loopName}:`));
  for (const j of jobs) {
    execFileSync(cmd, [...pre, "cron", "disable", j.id]);
    console.log(`  disabled ${j.declarationKey} — a regressed loop must not run on a timer`);
  }
}
console.log(failed ? `${failed} case(s) FAILED` : "all cases passed");
process.exit(failed ? 1 : 0);
