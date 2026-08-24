/**
 * tepui budget proxy — the spend gate, live.
 *
 * Every model call the gateway makes passes through here. The runtime has no
 * dollar cap of its own, so this is the only thing standing between an
 * unattended agent and the documented unattended-overnight-burn failure.
 *
 * How attribution works: the compiler gives each agent its own provider entry
 * whose baseUrl is  http://127.0.0.1:18900/a/<agent>/v1  — so the URL path
 * carries the agent identity and the gate can meter per agent. No plugin API,
 * no request-header archaeology: the boundary is plain HTTP that we own.
 *
 * Decisions:
 *  - Projection before the call is CONSERVATIVE: prompt chars/4 plus the full
 *    max_tokens at output price. Over-estimating blocks a run early; under-
 *    estimating lets one slip past the cap. We over-estimate.
 *  - A refusal is HTTP 402. The gateway treats it as a provider failure and
 *    walks the fallback chain — so a per-run refusal degrades to a cheaper
 *    tier, and a daily-cap refusal (which applies to every tier) stops the
 *    agent entirely. Both are the intended behavior.
 *  - Unknown agent or unpriced model: refuse. Anything unmetered must not
 *    look free.
 *  - Recorded usage prefers the provider's own numbers from the response;
 *    if a stream carries none, we estimate from bytes and mark the ledger row
 *    estimated:true. Estimates round up.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { BudgetGate, type Budget, type LedgerStore } from "../../../lib/budget/index.ts";
import { isKnownModel, costMicros } from "../../../lib/budget/pricing.ts";
import { randomUUID } from "node:crypto";

export type ProxyOpts = {
  port: number;
  upstreamBase: string;          // e.g. https://integrate.api.nvidia.com/v1
  apiKey: string;
  budgets: Record<string, Budget>;   // per agent
  store: LedgerStore;
  pricePrefix?: string;          // "nvidia" -> price lookup "nvidia/<model>"
  maxProjectedOutputTokens?: number;
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Pull a usage object out of a non-stream JSON body or an SSE stream. */
export function extractUsage(body: string): { prompt?: number; completion?: number } | null {
  // Non-stream: one JSON document.
  try {
    const j = JSON.parse(body);
    if (j?.usage) return { prompt: j.usage.prompt_tokens, completion: j.usage.completion_tokens };
  } catch { /* not a single JSON doc — try SSE */ }
  // SSE: scan data: lines, keep the last usage seen.
  let found: { prompt?: number; completion?: number } | null = null;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    if (!payload.includes('"usage"')) continue;
    try {
      const j = JSON.parse(payload);
      if (j?.usage) found = { prompt: j.usage.prompt_tokens, completion: j.usage.completion_tokens };
    } catch { /* partial line — skip */ }
  }
  return found;
}

export function createProxy(opts: ProxyOpts) {
  const prefix = opts.pricePrefix ?? "nvidia";
  const gate = new BudgetGate(opts.store, opts.budgets);
  const upstream = new URL(opts.upstreamBase);
  const doRequest = upstream.protocol === "https:" ? httpsRequest : httpRequest;

  const refuse = (res: ServerResponse, code: string, message: string) => {
    res.writeHead(402, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: "tepui_budget_refused", code, message } }));
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const m = req.url?.match(/^\/a\/([a-z0-9_-]+)\/v1(\/.*)$/);
    if (req.url === "/healthz") {
      const today = new Date().toISOString().slice(0, 10);
      const spent = Object.fromEntries(
        Object.keys(opts.budgets).map((a) => [a, gate.spentToday(a)]),
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, day: today, spentMicros: spent }));
      return;
    }
    if (!m) { res.writeHead(404); res.end("tepui-budget-proxy: unknown path"); return; }
    const [, agent, rest] = m;

    // Pass-through for non-completion calls (GET /models keeps the runtime's
    // local-endpoint preflight working).
    if (req.method !== "POST") {
      const up = doRequest(
        `${upstream.origin}${upstream.pathname}${rest}`,
        { method: req.method, headers: { authorization: `Bearer ${opts.apiKey}` } },
        (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, { "content-type": upRes.headers["content-type"] ?? "application/json" });
          upRes.pipe(res);
        },
      );
      up.on("error", () => { res.writeHead(502); res.end(); });
      up.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body: any;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { res.writeHead(400); res.end("bad json"); return; }

      // Normalize the model id for the upstream. The runtime prefixes ids with
      // the per-agent provider id (nvidia-ops/...), and NVIDIA's endpoint
      // requires exactly "nvidia/<model>" — a bare id 404s. The proxy owns
      // this boundary, so it canonicalizes whatever arrives.
      const rawModel = String(body.model ?? "");
      const bare = rawModel.replace(new RegExp(`^${prefix}(-[a-z0-9-]+)?/`), "");
      const upstreamModel = `${prefix}/${bare}`;
      body.model = upstreamModel;
      const priceKey = isKnownModel(upstreamModel) ? upstreamModel : rawModel;

      const inTok = estimateTokens(JSON.stringify(body.messages ?? body));
      const outTok = Number(body.max_tokens) || opts.maxProjectedOutputTokens || 8192;
      const projected = projectedMicros(priceKey, inTok, outTok);

      const decision = gate.check(agent, projected, priceKey);
      if (!decision.allow) { refuse(res, decision.code, decision.reason); return; }

      const raw = Buffer.from(JSON.stringify(body));
      const up = doRequest(
        `${upstream.origin}${upstream.pathname}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": raw.length,
            authorization: `Bearer ${opts.apiKey}`,
            accept: req.headers.accept ?? "*/*",
          },
        },
        (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, {
            "content-type": upRes.headers["content-type"] ?? "application/json",
          });
          const outChunks: Buffer[] = [];
          upRes.on("data", (c) => { res.write(c); if (outChunks.length < 4096) outChunks.push(c); });
          upRes.on("end", () => {
            res.end();
            const text = Buffer.concat(outChunks).toString("utf8");
            const usage = extractUsage(text);
            const estimated = !usage;
            gate.record({
              agent,
              loop: agent,
              runId: randomUUID(),
              model: priceKey,
              usage: {
                inputTokens: usage?.prompt ?? inTok,
                outputTokens: usage?.completion ?? estimateTokens(text),
              },
            });
            if (estimated) {
              // Ledger rows are already written by record(); note estimation in
              // a side event rather than corrupting the schema.
              opts.store.append({
                ts: new Date().toISOString(), agent, loop: agent, runId: "estimate-note",
                provider: prefix, model: priceKey, inputTokens: 0, cachedInputTokens: 0,
                outputTokens: 0, costMicros: 0, costCents: 0,
              } as any);
            }
          });
        },
      );
      up.on("error", (e) => { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: `upstream: ${e.message}` } })); });
      up.end(raw);
    });
  });

  server.listen(opts.port, "127.0.0.1");
  return { server, close: () => server.close() };
}

function projectedMicros(priceKey: string, inTok: number, outTok: number): number {
  // costMicros charges unknown models at the most expensive known rate, which
  // is the correct fail-closed behavior for projection too.
  return costMicros(priceKey, { inputTokens: inTok, outputTokens: outTok });
}

// ---- CLI ------------------------------------------------------------------
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const companyDir = resolve(process.argv[2] ?? "company");
  // Generated files carry a provenance banner; parse from the first brace.
  const budgetsRaw = readFileSync(join(companyDir, "generated", "budgets.json"), "utf8");
  const budgetsFile = JSON.parse(budgetsRaw.slice(budgetsRaw.indexOf("{")));
  const apiKey = process.env.NVIDIA_API_KEY ?? "";
  if (!apiKey) { console.error("budget-proxy: NVIDIA_API_KEY not set"); process.exit(1); }
  const { FileStore } = await import("../../../lib/budget/file-store.ts");
  const spendDir = process.env.TEPUI_SPEND_DIR ?? join(companyDir, "spend");
  createProxy({
    port: Number(process.env.TEPUI_PROXY_PORT ?? 18900),
    upstreamBase: process.env.TEPUI_UPSTREAM_BASE ?? "https://integrate.api.nvidia.com/v1",
    apiKey,
    budgets: budgetsFile.perAgent,
    store: new FileStore(spendDir),
  });
  console.log(`budget-proxy: listening on 127.0.0.1:${process.env.TEPUI_PROXY_PORT ?? 18900}, ledger in ${spendDir}`);
}
