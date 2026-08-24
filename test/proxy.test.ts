/**
 * The budget proxy is the only live spend enforcement in the system, so these
 * tests exercise the real HTTP path against a fake upstream — not the gate
 * class in isolation (lib/budget has its own tests for that).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createProxy, extractUsage, estimateTokens } from "../runtime/openclaw/proxy/budget-proxy.ts";
import { MemoryStore } from "../lib/budget/index.ts";

// Fake upstream: answers /chat/completions with fixed usage, /models with a list.
const upstream = createServer((req, res) => {
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "nemotron-3-nano-30b-a3b" }] }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }));
  });
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const upPort = (upstream.address() as any).port;

const store = new MemoryStore();
const proxy = createProxy({
  port: 0 as any, // replaced below — createProxy listens itself; use a fixed high port
  upstreamBase: `http://127.0.0.1:${upPort}/v1`,
  apiKey: "test-key",
  budgets: {
    ops:  { per_run_usd: 1.00, per_day_usd: 2.00 },
    tiny: { per_run_usd: 0.000001, per_day_usd: 1.00 },
  },
  store,
  maxProjectedOutputTokens: 100,
});
await once(proxy.server, "listening");
const port = (proxy.server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

after(() => { proxy.close(); upstream.close(); });

const complete = (agent: string, body: any = {}) =>
  fetch(`${base}/a/${agent}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "nemotron-3-nano-30b-a3b", max_tokens: 50,
      messages: [{ role: "user", content: "hi" }], ...body }),
  });

test("allows a run inside budget and records real usage", async () => {
  const res = await complete("ops");
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.choices[0].message.content, "ok");
  const e = store.events.find((ev) => ev.agent === "ops");
  assert.ok(e, "a cost event must be recorded");
  assert.equal(e!.inputTokens, 100, "must prefer the provider's own usage numbers");
  assert.equal(e!.outputTokens, 50);
});

test("refuses when the projected cost exceeds the per-run cap", async () => {
  const res = await complete("tiny");
  assert.equal(res.status, 402);
  const j = await res.json();
  assert.equal(j.error.type, "tepui_budget_refused");
  assert.equal(j.error.code, "RUN_CAP");
});

test("refuses an agent with no budget — fail closed", async () => {
  const res = await complete("ghost");
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error.code, "NO_BUDGET");
});

test("refuses an unpriced model rather than metering it at zero", async () => {
  const res = await complete("ops", { model: "mystery-model-9000" });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error.code, "UNKNOWN_MODEL");
});

test("GET /models passes through (keeps the runtime preflight working)", async () => {
  const res = await fetch(`${base}/a/ops/v1/models`);
  assert.equal(res.status, 200);
  assert.ok((await res.json()).data.length > 0);
});

test("healthz reports per-agent spend", async () => {
  const res = await fetch(`${base}/healthz`);
  const j = await res.json();
  assert.ok(j.ok);
  assert.ok(j.spentMicros.ops > 0, "ops spent something in the first test");
});

// --- pure helpers ---
test("extractUsage reads SSE streams", () => {
  const sse = 'data: {"choices":[]}\n\ndata: {"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\ndata: [DONE]\n';
  assert.deepEqual(extractUsage(sse), { prompt: 7, completion: 3 });
});
test("estimateTokens rounds up", () => {
  assert.equal(estimateTokens("abcde"), 2);
});

test("an upstream that dies mid-stream does not kill the gate", async () => {
  // Regression: an upstream socket error after headers were streamed hit a
  // writeHead-after-send throw and took the whole proxy process down.
  const dying = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: {\"choices\":[]}\n\n");
    setTimeout(() => res.destroy(), 30);      // cut the socket mid-stream
  });
  dying.listen(0, "127.0.0.1");
  await once(dying, "listening");
  const dyingPort = (dying.address() as any).port;

  const p2 = createProxy({
    port: 0 as any,
    upstreamBase: `http://127.0.0.1:${dyingPort}/v1`,
    apiKey: "k",
    budgets: { ops: { per_run_usd: 1, per_day_usd: 2 } },
    store: new MemoryStore(),
    maxProjectedOutputTokens: 50,
  });
  await once(p2.server, "listening");
  const p2port = (p2.server.address() as any).port;

  // The request may error or come back truncated — either is fine. What must
  // NOT happen is the proxy dying: it must still answer healthz afterwards.
  await fetch(`http://127.0.0.1:${p2port}/a/ops/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(3000),   // a hang here IS the regression
    body: JSON.stringify({ model: "nemotron-3-nano-30b-a3b", max_tokens: 10, messages: [] }),
  }).then((r) => r.text()).catch(() => "died-as-expected-client-side");

  const health = await fetch(`http://127.0.0.1:${p2port}/healthz`);
  assert.equal(health.status, 200, "the gate must survive an upstream mid-stream death");
  p2.close(); dying.close();
});
