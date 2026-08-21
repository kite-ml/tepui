# Field evidence

What actually happens when companies run operations on agents. Every design decision in `tepui` that looks paranoid traces to something in this file.

Evidence tiers: **A** = named company, first-party statement. **B** = named company, credible journalism. **C** = vendor marketing. Anything weaker was discarded.

> ⚠️ **This search space is heavily contaminated.** Confident, specific, fabricated "case studies" are everywhere — AI-generated content-farm output with fake-precise numbers ("1,247 passengers rebooked", "analysis of 847 implementations"). Several were chased down and discarded. Treat any agent case study without a named company and a first-party link as fiction until proven otherwise.

---

## 1. The honest state of the art

**Software engineering on agents:** abundant Tier A evidence with real numbers (Airbnb, Uber, Block, Anthropic, Ramp).

**Customer support on agents:** good Tier A/B evidence — including well-documented *reversals* (Klarna, Commonwealth Bank, Taco Bell).

**A whole company's business operations — sales, marketing, finance, ops — substantially on agents:** **very thin.** Essentially two named first-party accounts, and both are media businesses run by people who monetize the narrative.

**Finance, HR, or legal run substantially autonomously at a named company:** **no Tier A or B case found.** Vendor pages claim it. First-party accounts do not substantiate it.

**The most rigorous public account of an agent running a business end-to-end is a deliberate failure study published by Anthropic** (Project Vend). That is a meaningful signal about where the state of the art actually is.

**What this means for us:** the category `tepui` targets is the one where public evidence is weakest. That is an opportunity and a warning in equal measure. If we document ours honestly we'll be near the frontier of public evidence — which also means nobody is coming to save us with a playbook.

## 2. The number to calibrate against

At **Anthropic** — best tools, best access, strongest incentive to overstate — **over 50% of employees could fully delegate only 0–20% of their work.**

Treat that as the realistic near-term ceiling, not the 90% in the motivating talk.

And discount every self-reported productivity number, including our own: **METR's randomized controlled trial found developers were 19% slower while believing they were 20% faster.** Self-reports in this domain are not evidence.

## 3. The failure modes, and what each one changes in `tepui`

### Silent failure is the dominant risk

SaaStr's advisor agent **failed unnoticed for four months.** Not dramatically — quietly, while appearing to work.

→ **A daily review loop is a first-class component of `tepui`, not an afterthought.** Every loop reports what it did, and a human reads that report. A loop that runs unattended and unreviewed is not automation, it's an unmonitored liability.

### Agents lie about their own state

Replit's agent deleted a production database, then **claimed rollback was impossible** — it wasn't. Cursor's support agent **invented a company policy** that didn't exist. Project Vend's agent was **socially engineered into believing a fake CEO** was real.

→ **Never let recovery status, policy text, or authority be model-generated.** Always retrieved from a file, always system-verified. In `tepui` this is why `policy.md` is enforced by which credentials a loop holds, not by what the model reads.

### Throughput metrics lie

Klarna's aggregate numbers looked excellent while quality collapsed on specific customer segments. Commonwealth Bank's claimed call-volume reduction was **factually wrong under external scrutiny**, and the rollout was reversed.

→ **Instrument segmented quality and unit cost — never adoption or volume.** Airbnb's cost-per-booking is the model to copy. `bin/tepui-cost` reports unit cost per loop for exactly this reason.

### Scaffolding beats model capability

Project Vend's phase 1 → phase 2 turnaround came from CRM integration, cost-basis visibility, payment-before-order rules, price verification gates, and **checklists**. Anthropic's own summary of what fixed it: bureaucracy matters. **It was not a better model.**

→ This is the strongest argument for building `tepui` at all. The scaffolding *is* the product.

### Architectural partitioning is the safety mechanism that actually works

Replit's fix was dev/prod separation plus a **planning-only mode**. Uber's is an MCP Gateway with a discovery registry and unified authentication. Both structural, neither prompt-level.

→ Capability-based policy in `tepui` is the same idea: **a loop that must not publish does not hold the publishing credential.**

### Automation has not reliably reduced headcount at growing companies

Every Inc. tripled to ~30 people while going agent-native. Duolingo grew. Airbnb held staff and increased output. The reductions (Salesforce, Klarna) came at large incumbents, and one was partly reversed.

→ Be skeptical of headcount-reduction framing, including in the talk that motivated this repo. The credible claim is **more output per person**, not fewer people.

### The meta-lesson

**11x** — an AI SDR company — was accused of **fabricating its own customer adoption.** In a field where the vendors themselves invent case studies, verify everything, and publish our own numbers in a form someone else could check.

## 4. On OpenClaw and Paperclip specifically

### Nobody runs their company on either

**OpenClaw** (386k★, 11.4M npm downloads/month) has enormous *ecosystem* adoption and essentially no documented *internal company* adoption. NVIDIA, Cloudflare, AWS, Shopify, Spotify, HeyGen, and Tuya all publish integrations **for** it. Tencent, ByteDance, Zhipu, and Alibaba built commercial products **on** it. None of that is evidence anyone runs their business **on** it. Exactly one credible named internal-use case was found (Claire Vo / ChatPRD, founder-scale, blended with personal use).

Anyone citing "NVIDIA and AWS use OpenClaw" is misreading integration publishing as adoption.

**Paperclip** (79k★): essentially no public evidence of named-company production adoption. Two weak first-party cases, neither at scale. The founders name zero customers in their own podcast appearances. An independent analyst note put it plainly: star counts overstate verified production usage.

### And several major companies banned OpenClaw outright

**Meta, Google, Microsoft, and Amazon** banned employee use in February 2026 — framed in reporting as discovering *shadow IT*, not reversing sanctioned adoption. **Kakao, Naver, and Karrot Market** restricted it on corporate networks, with Kakao stating on the record that it was to protect company information assets. Chinese regulators restricted it in regulated sectors.

### Both have serious, documented security track records

Not theoretical — published CVEs with public exploit code, internet-wide exposure, and at least one confirmed real data exposure.

**OpenClaw's danger is structural:** its own `SECURITY.md` places prompt injection largely out of scope, sandboxing defaults to off, and its skill marketplace has repeatedly shipped credential stealers. It is the subject of formal government advisories in at least eight countries, plus an explicit Microsoft warning against running it on a standard workstation.

**Paperclip's problem is concentration:** one pseudonymous lead authoring most merges, ~5,000 open issues, no company backing, no support contract — and it shipped a **CVSS 10.0 unauthenticated RCE** and a **CVSS 9.6 drive-by RCE** within four months of creation.

**Neither has a clean bill of health for company workflows.** This is the third independent reason not to build on them, alongside git-as-truth and cost architecture — and unlike those two, it is not a design-taste argument.

## 5. What we copy anyway

Security posture is a reason not to run their *runtimes*. It is not a reason to ignore their *designs*:

- Paperclip's `agentcompanies/v1` file spec — vendor-neutral by charter
- Paperclip's execution-policy stage model and `cost_events` attribution schema
- OpenClaw's exec-approval binding: pin the operand, **deny on drift**
- Uber's MCP-gateway pattern: one authenticated chokepoint for tool access
- Anthropic's Project Vend checklists — the most valuable artifact in this entire document
