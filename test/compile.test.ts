/**
 * Invariant tests for the org compiler.
 *
 * These are the safety design, so each test asserts the compiler REFUSES —
 * a compiler that warns is a compiler that gets ignored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE_ORG = {
  version: 1,
  tiers: { tier2: {}, tier3: {} },
  defaults: { model: "tier2", utility_model: "tier3", budget: { per_run_usd: 0.5, per_day_usd: 5 } },
};
const BASE_OVERLAY = { version: 1, paths: { workspace_root: "/tmp/tepui-ws" },
                       tiers: { tier2: "m/sonnet", tier3: "m/haiku" }, loops: {} };

/** Build a throwaway core+company pair, run the compiler, return failures (or null). */
async function compileWith(archetypes: any, employees: any, loops: Record<string, any> = {}) {
  const root = mkdtempSync(join(tmpdir(), "tepui-"));
  const core = join(root, "core"), company = join(root, "company");
  mkdirSync(join(core, "loops"), { recursive: true });
  mkdirSync(company, { recursive: true });

  writeFileSync(join(core, "org.yaml"), JSON.stringify({ ...BASE_ORG, archetypes }));
  writeFileSync(join(company, "org.overlay.yaml"), JSON.stringify({ ...BASE_OVERLAY, employees }));
  for (const [name, policy] of Object.entries(loops)) {
    mkdirSync(join(core, "loops", name), { recursive: true });
    writeFileSync(join(core, "loops", name, "policy.yaml"), JSON.stringify(policy));
  }

  process.env.TEPUI_CORE = core;
  const { compile, CompileError } = await import(`../runtime/openclaw/compile.ts?t=${Date.now()}`);
  try {
    compile(company);
    return null;
  } catch (e: any) {
    if (e instanceof CompileError || e.failures) return e.failures as string[];
    throw e;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const OK_SANDBOX = { mode: "all", workspace_access: "ro" };

test("refuses an agent with no explicit sandbox block", async () => {
  const failures = await compileWith(
    { bare: { title: "Bare", tools: { profile: "readonly" } } },
    { bare: { archetype: "bare", name: "Bare" } },
  );
  assert.ok(failures?.some((f) => f.includes("no explicit sandbox block")), failures?.join("\n"));
});

test("refuses sandbox.mode=off without a justification", async () => {
  const failures = await compileWith(
    { loose: { title: "Loose", sandbox: { mode: "off", workspace_access: "rw" }, tools: { profile: "ops" } } },
    { loose: { archetype: "loose", name: "Loose" } },
  );
  assert.ok(failures?.some((f) => f.includes("sandbox_justification")), failures?.join("\n"));
});

test("accepts sandbox.mode=off WITH a justification", async () => {
  const failures = await compileWith(
    { loose: { title: "Loose", sandbox: { mode: "off", workspace_access: "rw" }, sandbox_justification: "needs host exec", tools: { profile: "ops" } } },
    { loose: { archetype: "loose", name: "Loose" } },
  );
  assert.equal(failures, null, failures?.join("\n"));
});

// --- the intake invariant: untrusted input and credentials never coexist ---

test("refuses an untrusted-input agent that holds credentials", async () => {
  const failures = await compileWith(
    {
      intake: {
        title: "Intake", reads_untrusted_input: true, sandbox: { mode: "all", workspace_access: "none" },
        tools: { profile: "quarantine", deny: ["exec", "write", "edit", "message", "web_fetch", "browser"] },
      },
    },
    { intake: { archetype: "intake", name: "Intake", credentials: ["SECRET_KEY"] } },
    { tickets: { owner: "intake", capabilities: { credentials: ["SECRET_KEY"] } } },
  );
  assert.ok(failures?.some((f) => f.includes("reads untrusted input but holds credentials")), failures?.join("\n"));
});

test("refuses an untrusted-input agent that is not fully sandboxed", async () => {
  const failures = await compileWith(
    {
      intake: {
        title: "Intake", reads_untrusted_input: true, sandbox: { mode: "non-main", workspace_access: "ro" },
        tools: { profile: "quarantine", deny: ["exec", "write", "edit", "message", "web_fetch", "browser"] },
      },
    },
    { intake: { archetype: "intake", name: "Intake" } },
  );
  assert.ok(failures?.some((f) => f.includes("workspace_access=none")), failures?.join("\n"));
});

test("refuses an untrusted-input agent whose EFFECTIVE denies still allow exec", async () => {
  // Uses the permissive 'ops' profile, whose baseline denies nothing, so the
  // invariant is genuinely exercised. (Under 'quarantine' the profile itself
  // already denies exec, which is why that fixture proved nothing.)
  const failures = await compileWith(
    {
      intake: {
        title: "Intake", reads_untrusted_input: true, sandbox: { mode: "all", workspace_access: "none" },
        tools: { profile: "ops", deny: ["write", "edit", "message", "web_fetch", "browser"] }, // exec missing
      },
    },
    { intake: { archetype: "intake", name: "Intake" } },
  );
  assert.ok(failures?.some((f) => f.includes("must deny 'exec'")), failures?.join("\n"));
});

test("the quarantine profile denies exec on its own, without the agent asking", async () => {
  const failures = await compileWith(
    {
      intake: {
        title: "Intake", reads_untrusted_input: true, sandbox: { mode: "all", workspace_access: "none" },
        tools: { profile: "quarantine" },   // no explicit denies at all
      },
    },
    { intake: { archetype: "intake", name: "Intake" } },
  );
  assert.equal(failures, null, failures?.join("\n"));
});

test("refuses an unknown tool profile", async () => {
  const failures = await compileWith(
    { odd: { title: "Odd", sandbox: OK_SANDBOX, tools: { profile: "made-up" } } },
    { odd: { archetype: "odd", name: "Odd" } },
  );
  assert.ok(failures?.some((f) => f.includes("unknown tool profile")), failures?.join("\n"));
});

// --- least privilege on credentials ---

test("refuses a credential grant no loop declares", async () => {
  const failures = await compileWith(
    { analyst: { title: "Analyst", sandbox: OK_SANDBOX, tools: { profile: "readonly" } } },
    { analyst: { archetype: "analyst", name: "Analyst", credentials: ["POSTHOG_READ_KEY"] } },
    { metrics: { owner: "analyst", capabilities: { credentials: [] } } },
  );
  assert.ok(failures?.some((f) => f.includes("no loop it owns declares it")), failures?.join("\n"));
});

test("accepts a credential grant a loop actually declares", async () => {
  const failures = await compileWith(
    { analyst: { title: "Analyst", sandbox: OK_SANDBOX, tools: { profile: "readonly" } } },
    { analyst: { archetype: "analyst", name: "Analyst", credentials: ["POSTHOG_READ_KEY"] } },
    { metrics: { owner: "analyst", capabilities: { credentials: ["POSTHOG_READ_KEY"] } } },
  );
  assert.equal(failures, null, failures?.join("\n"));
});

test("refuses approvals with no implementing workflow", async () => {
  const failures = await compileWith(
    { ops: { title: "Ops", sandbox: OK_SANDBOX, tools: { profile: "ops" } } },
    { ops: { archetype: "ops", name: "Ops" } },
    { publish: { owner: "ops", capabilities: { credentials: [] }, approvals: [{ stage: "human" }] } },
  );
  assert.ok(failures?.some((f) => f.includes("approval")), failures?.join("\n"));
});

test("refuses an overlay with no workspace_root", async () => {
  const root = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "tepui-"));
  const fs = await import("node:fs"), path = await import("node:path");
  const core = path.join(root, "core"), company = path.join(root, "company");
  fs.mkdirSync(path.join(core, "loops"), { recursive: true }); fs.mkdirSync(company, { recursive: true });
  fs.writeFileSync(path.join(core, "org.yaml"), JSON.stringify({ ...BASE_ORG, archetypes: { a: { title: "A", sandbox: OK_SANDBOX, tools: { profile: "readonly" } } } }));
  const { workspace_root, ...noPaths } = { workspace_root: "x" };
  fs.writeFileSync(path.join(company, "org.overlay.yaml"),
    JSON.stringify({ version: 1, tiers: { tier2: "m/s", tier3: "m/h" }, loops: {}, employees: { a: { archetype: "a", name: "A" } } }));
  process.env.TEPUI_CORE = core;
  const { compile } = await import(`../runtime/openclaw/compile.ts?t=${Date.now()}`);
  let failures: string[] | null = null;
  try { compile(company); } catch (e: any) { failures = e.failures ?? null; }
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(failures?.some((f) => f.includes("workspace_root")), failures?.join("\n"));
});

test("refuses a loop with no owner", async () => {
  const failures = await compileWith(
    { ops: { title: "Ops", sandbox: OK_SANDBOX, tools: { profile: "ops" } } },
    { ops: { archetype: "ops", name: "Ops" } },
    { orphan: { capabilities: { credentials: [] } } },
  );
  assert.ok(failures?.some((f) => f.includes("no owner")), failures?.join("\n"));
});

test("refuses an evaluation-tier provider serving a loop that handles company data", async () => {
  const root = mkdtempSync(join(tmpdir(), "tepui-"));
  const core = join(root, "core"), company = join(root, "company");
  mkdirSync(join(core, "loops", "crm"), { recursive: true });
  mkdirSync(company, { recursive: true });
  writeFileSync(join(core, "org.yaml"), JSON.stringify({ ...BASE_ORG,
    archetypes: { ops: { title: "Ops", sandbox: OK_SANDBOX, tools: { profile: "ops" } } } }));
  writeFileSync(join(core, "loops", "crm", "policy.yaml"),
    JSON.stringify({ owner: "ops", handles_company_data: true, capabilities: { credentials: [] } }));
  writeFileSync(join(company, "org.overlay.yaml"), JSON.stringify({ ...BASE_OVERLAY,
    provider: { id: "nvidia", api: "openai-completions", base_url: "https://x/v1", api_key_env: "K", tier: "evaluation" },
    employees: { ops: { archetype: "ops", name: "Ops" } } }));
  process.env.TEPUI_CORE = core;
  const { compile } = await import(`../runtime/openclaw/compile.ts?t=${Date.now()}`);
  let failures: string[] | null = null;
  try { compile(company); } catch (e: any) { failures = e.failures ?? null; }
  rmSync(root, { recursive: true, force: true });
  assert.ok(failures?.some((f) => f.includes("tier=evaluation")), failures?.join("\n"));
});

test("shared Slack app: agents route by channel, one integration", async () => {
  const root = mkdtempSync(join(tmpdir(), "tepui-"));
  const core = join(root, "core"), company = join(root, "company");
  mkdirSync(join(core, "loops"), { recursive: true }); mkdirSync(company, { recursive: true });
  writeFileSync(join(core, "org.yaml"), JSON.stringify({ ...BASE_ORG, archetypes: {
    a: { title: "A", sandbox: OK_SANDBOX, tools: { profile: "readonly" } },
    b: { title: "B", sandbox: OK_SANDBOX, tools: { profile: "readonly" } } } }));
  writeFileSync(join(company, "org.overlay.yaml"), JSON.stringify({ ...BASE_OVERLAY, employees: {
    a: { archetype: "a", name: "A", slack_channels: ["C0AAA"] },
    b: { archetype: "b", name: "B", slack_channels: ["C0BBB"] } } }));
  process.env.TEPUI_CORE = core;
  const { compile } = await import(`../runtime/openclaw/compile.ts?t=${Date.now()}`);
  const out = join(company, "generated");
  compile(company, { outDir: out });
  const read = (f: string) => { const r = readFileSync(join(out, f), "utf8"); return JSON.parse(r.slice(r.indexOf(r.includes("[\n") && f === "bindings.json5" ? "[" : "{"))); };
  const ch = read("channels.json5");
  const bind = read("bindings.json5");
  rmSync(root, { recursive: true, force: true });

  assert.deepEqual(Object.keys(ch.slack.accounts), ["default"], "one shared integration");
  assert.equal(bind.length, 2);
  assert.ok(bind.every((b: any) => b.match.peer), "shared mode routes by channel, not account");
  assert.ok(!bind.some((b: any) => b.match.accountId), "shared mode must not pin an accountId");
});

test("per-agent Slack apps: one account each, addressable anywhere", async () => {
  const root = mkdtempSync(join(tmpdir(), "tepui-"));
  const core = join(root, "core"), company = join(root, "company");
  mkdirSync(join(core, "loops"), { recursive: true }); mkdirSync(company, { recursive: true });
  writeFileSync(join(core, "org.yaml"), JSON.stringify({ ...BASE_ORG, archetypes: {
    a: { title: "A", sandbox: OK_SANDBOX, tools: { profile: "readonly" } } } }));
  writeFileSync(join(company, "org.overlay.yaml"), JSON.stringify({ ...BASE_OVERLAY, employees: {
    a: { archetype: "a", name: "A", slack_account: "agent-a" } } }));
  process.env.TEPUI_CORE = core;
  const { compile } = await import(`../runtime/openclaw/compile.ts?t=${Date.now()}`);
  const out = join(company, "generated");
  compile(company, { outDir: out });
  const raw = readFileSync(join(out, "channels.json5"), "utf8");
  const ch = JSON.parse(raw.slice(raw.indexOf("{")));
  rmSync(root, { recursive: true, force: true });
  assert.deepEqual(Object.keys(ch.slack.accounts), ["agent-a"]);
  assert.equal(ch.slack.accounts["agent-a"].botToken.id, "SLACK_BOT_TOKEN_AGENT_A");
});

test("catch-all binding is emitted last so channel rules win", async () => {
  const root = mkdtempSync(join(tmpdir(), "tepui-"));
  const core = join(root, "core"), company = join(root, "company");
  mkdirSync(join(core, "loops"), { recursive: true }); mkdirSync(company, { recursive: true });
  writeFileSync(join(core, "org.yaml"), JSON.stringify({ ...BASE_ORG, archetypes: {
    ops: { title: "Ops", sandbox: OK_SANDBOX, tools: { profile: "ops" } },
    an:  { title: "An", reports_to: "ops", sandbox: OK_SANDBOX, tools: { profile: "readonly" } } } }));
  writeFileSync(join(company, "org.overlay.yaml"), JSON.stringify({ ...BASE_OVERLAY, employees: {
    ops: { archetype: "ops", name: "Ops", slack_default: true },
    an:  { archetype: "an", name: "An", slack_channels: ["C0AAA"] } } }));
  process.env.TEPUI_CORE = core;
  const { compile } = await import(`../runtime/openclaw/compile.ts?t=${Date.now()}`);
  const out = join(company, "generated");
  compile(company, { outDir: out });
  const raw = readFileSync(join(out, "bindings.json5"), "utf8");
  const bind = JSON.parse(raw.slice(raw.indexOf("[")));
  rmSync(root, { recursive: true, force: true });

  assert.equal(bind[0].agentId, "an", "the specific channel rule must come first");
  assert.ok(bind[0].match.peer, "and it must be channel-scoped");
  assert.equal(bind[bind.length - 1].agentId, "ops", "the catch-all must come last");
  assert.ok(!bind[bind.length - 1].match.peer, "the catch-all must not be channel-scoped");
});

test("refuses two agents claiming the catch-all", async () => {
  const root = mkdtempSync(join(tmpdir(), "tepui-"));
  const core = join(root, "core"), company = join(root, "company");
  mkdirSync(join(core, "loops"), { recursive: true }); mkdirSync(company, { recursive: true });
  writeFileSync(join(core, "org.yaml"), JSON.stringify({ ...BASE_ORG, archetypes: {
    a: { title: "A", sandbox: OK_SANDBOX, tools: { profile: "ops" } },
    b: { title: "B", sandbox: OK_SANDBOX, tools: { profile: "ops" } } } }));
  writeFileSync(join(company, "org.overlay.yaml"), JSON.stringify({ ...BASE_OVERLAY, employees: {
    a: { archetype: "a", name: "A", slack_default: true },
    b: { archetype: "b", name: "B", slack_default: true } } }));
  process.env.TEPUI_CORE = core;
  const { compile } = await import(`../runtime/openclaw/compile.ts?t=${Date.now()}`);
  let failures: string[] | null = null;
  try { compile(company, { outDir: join(company, "generated") }); } catch (e: any) { failures = e.failures ?? null; }
  rmSync(root, { recursive: true, force: true });
  assert.ok(failures?.some((f) => f.includes("slack_default")), failures?.join("\n"));
});

test("agents get a tier-descent fallback chain", async () => {
  const root = mkdtempSync(join(tmpdir(), "tepui-"));
  const core = join(root, "core"), company = join(root, "company");
  mkdirSync(join(core, "loops"), { recursive: true }); mkdirSync(company, { recursive: true });
  writeFileSync(join(core, "org.yaml"), JSON.stringify({
    ...BASE_ORG,
    defaults: { ...BASE_ORG.defaults, model: "tier1", utility_model: "tier3" },
    archetypes: {
      big:   { title: "Big",   sandbox: OK_SANDBOX, tools: { profile: "readonly" } },
      small: { title: "Small", model: "tier3", sandbox: OK_SANDBOX, tools: { profile: "readonly" } },
    },
  }));
  writeFileSync(join(company, "org.overlay.yaml"), JSON.stringify({
    ...BASE_OVERLAY,
    tiers: { tier1: "p/big", tier2: "p/mid", tier3: "p/small" },
    employees: { big: { archetype: "big", name: "Big" }, small: { archetype: "small", name: "Small" } },
  }));
  process.env.TEPUI_CORE = core;
  const { compile } = await import(`../runtime/openclaw/compile.ts?t=${Date.now()}`);
  const out = join(company, "generated");
  compile(company, { outDir: out });
  const raw = readFileSync(join(out, "agents.json5"), "utf8");
  const list = JSON.parse(raw.slice(raw.indexOf("{"))).list;
  rmSync(root, { recursive: true, force: true });

  const big = list.find((a: any) => a.id === "big");
  assert.equal(big.model.primary, "p/big");
  assert.deepEqual(big.model.fallbacks, ["p/mid", "p/small"], "tier1 must descend through every lower tier");

  // The cheapest tier has nothing below it — a chain back up would re-enter the
  // contended pool that failed, which is worse than surfacing the error.
  const small = list.find((a: any) => a.id === "small");
  assert.equal(typeof small.model, "string", "tier3 gets no fallback chain");
});
