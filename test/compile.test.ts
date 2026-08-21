/**
 * Invariant tests for the org compiler.
 *
 * These are the safety design, so each test asserts the compiler REFUSES —
 * a compiler that warns is a compiler that gets ignored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE_ORG = {
  version: 1,
  tiers: { tier2: {}, tier3: {} },
  defaults: { model: "tier2", utility_model: "tier3", budget: { per_run_usd: 0.5, per_day_usd: 5 } },
};
const BASE_OVERLAY = { version: 1, tiers: { tier2: "m/sonnet", tier3: "m/haiku" }, loops: {} };

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

test("refuses an untrusted-input agent that can still exec", async () => {
  const failures = await compileWith(
    {
      intake: {
        title: "Intake", reads_untrusted_input: true, sandbox: { mode: "all", workspace_access: "none" },
        tools: { profile: "quarantine", deny: ["write", "edit", "message", "web_fetch", "browser"] }, // exec missing
      },
    },
    { intake: { archetype: "intake", name: "Intake" } },
  );
  assert.ok(failures?.some((f) => f.includes("must deny 'exec'")), failures?.join("\n"));
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

test("refuses a loop with no owner", async () => {
  const failures = await compileWith(
    { ops: { title: "Ops", sandbox: OK_SANDBOX, tools: { profile: "ops" } } },
    { ops: { archetype: "ops", name: "Ops" } },
    { orphan: { capabilities: { credentials: [] } } },
  );
  assert.ok(failures?.some((f) => f.includes("no owner")), failures?.join("\n"));
});
