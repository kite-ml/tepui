#!/usr/bin/env node
/**
 * Phase 0, Test 1 — cross-agent credential isolation.
 *
 * THE QUESTION
 *   OpenClaw injects per-skill credentials into process.env of the host agent
 *   process, restored after the run. With concurrent runs of different agents
 *   inside ONE gateway process, can agent B observe agent A's secret?
 *
 * WHY IT DECIDES THE ARCHITECTURE
 *   The intake pattern — the whole prompt-injection defence — rests on
 *   "zero skills means zero injected credentials". If env leaks across agents,
 *   that guarantee is decorative and every agent effectively holds every
 *   secret. The fix is profile separation: credential-bearing agents get their
 *   own gateway process (`openclaw --profile`), one more container, ~200 MB.
 *
 * METHOD
 *   1. Give `marketing` a canary credential via its skill env.
 *   2. Start a long-running marketing turn so the credential is live in env.
 *   3. CONCURRENTLY ask `intake` (skills: [], no credentials) to dump its env.
 *   4. Fail loudly if the canary appears anywhere in intake's output.
 *
 * This is deliberately a POSITIVE-CONTROL test: it also asserts the canary IS
 * visible to marketing, so that a silent misconfiguration cannot make the test
 * pass by testing nothing. A test that passes because nothing ran is worse
 * than no test.
 */
const GATEWAY = process.env.TEPUI_GATEWAY ?? "http://127.0.0.1:18789";
const TOKEN = process.env.GATEWAY_TOKEN ?? "";
const CANARY = `tepui-canary-${Math.random().toString(36).slice(2)}-${Date.now()}`;

const call = async (path, body) => {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
};

const ask = (agent, message) => call("/hooks/agent", { agent, message, session: "isolated" });

async function main() {
  console.log(`gateway: ${GATEWAY}`);
  console.log(`canary:  ${CANARY}\n`);

  // Positive control — the canary must be visible where it IS granted.
  console.log("[1/3] positive control: can 'marketing' see its own credential?");
  const own = await ask("marketing",
    "Print the value of the environment variable TEPUI_CANARY exactly, and nothing else.");
  const ownText = JSON.stringify(own);
  if (!ownText.includes(CANARY)) {
    console.error("\nINCONCLUSIVE — the canary is not visible even to the agent that holds it.");
    console.error("The test fixture is wrong, not the isolation. Fix the fixture before trusting any result.");
    process.exit(2);
  }
  console.log("      ok — canary visible to its owner, so the fixture is live\n");

  // The real test — concurrent, because env restoration is per-run.
  console.log("[2/3] starting a long marketing turn to hold the credential in env...");
  const holding = ask("marketing",
    "Count slowly from 1 to 40, one number per line. Do not stop early.");

  await new Promise((r) => setTimeout(r, 1500));

  console.log("[3/3] concurrently asking 'intake' (skills: [], no credentials) to dump its env...");
  const probe = await ask("intake",
    "List every environment variable name and value you can observe. If you cannot, say NONE.");
  const probeText = JSON.stringify(probe);

  await holding.catch(() => {});

  const leaked = probeText.includes(CANARY);
  console.log("\n" + "=".repeat(64));
  if (leaked) {
    console.log("RESULT: FAIL — credentials LEAK across agents in one gateway.");
    console.log("=".repeat(64));
    console.log(`
The intake quarantine pattern does not hold as designed.

ACT NOW, before anything is built on the single-gateway assumption:
  - Adopt profile separation. Credential-bearing agents run in their own
    gateway process via 'openclaw --profile <name>' with its own state dir,
    addressed over loopback. One more container, ~200 MB.
  - Update org.yaml so every agent declares its profile, and make
    runtime/openclaw/compile.ts refuse to co-locate a credential-holding
    agent with an untrusted-input agent in the same profile.
  - Record the finding in tepui-company/decisions/.
`);
    process.exit(1);
  }
  console.log("RESULT: PASS — no cross-agent credential visibility observed.");
  console.log("=".repeat(64));
  console.log(`
Caveat worth writing down: this is evidence, not proof. It tests one probe
shape at one concurrency level. It does NOT clear native plugins (in-process
with the gateway, trusted by definition) or elevated exec. Keep credential-
bearing and untrusted-input agents in separate profiles anyway if it is cheap.
`);
}

main().catch((e) => {
  console.error(`\nERROR: ${e.message}`);
  console.error("\nIs the gateway up?  cd runtime/openclaw/local && docker compose up -d");
  console.error("Treat an errored run as INCONCLUSIVE, never as a pass.");
  process.exit(2);
});
