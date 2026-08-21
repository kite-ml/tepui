# Principles: How to Build a Self-Improving Company with AI

Source: **Tom Blomfield** (co-founder of Monzo and GoCardless; then YC General Partner), YC batch talk, ~13 minutes.
📺 [youtube.com/watch?v=X_JsIHUfUjc](https://www.youtube.com/watch?v=X_JsIHUfUjc) · [YC Startup Library](https://www.ycombinator.com/library/Qf-how-to-build-a-self-improving-company-with-ai)

> **⚠️ Sourcing note — read before quoting any of this.**
> The video's caption track is not retrievable, and the YC library page is JS-rendered. The **chapter titles and timestamps below are verbatim** from the official video description. **Everything else is reconstructed** from ~8 independent secondary write-ups that converge closely on the same structure, examples, and numbers. Treat the substance as reliable and the *wording* as paraphrase. Do not attribute quoted sentences to Blomfield without checking the video. Where a number came from a single source, it says so.

---

## 1. Companies Are Roman Legions `00:00`

The modern org chart is a Roman legion: nested spans of control, a rigid chain of command, information flowing up through layers and orders flowing down. (Blomfield credits the framing to a Jack Dorsey thread.)

The load-bearing assumption is that **humans are the conduit for all information movement** — so you need hierarchy to coordinate them. AI breaks that assumption at the root. If the coordination substrate no longer has to be human, the hierarchy that existed to manage humans-as-routers loses its reason to exist.

This is a *structural* argument, not a productivity one. He is attacking the shape of the company, not its speed.

## 2. Copilots Are the Wrong Mental Model `00:54`

The default move — bolt copilots onto existing workflows, harvest ~20% more engineering output — is a category error. The image is a horse-drawn cart with a more powerful engine strapped to it. You get a faster cart.

The gain is real but **bounded and non-compounding**, because the workflow, the approval chain, and the org chart all stay fixed.

## 3. Extract the Domain Knowledge `01:55`

**The hinge of the entire talk.** The blocker to automating a company is no longer model capability — the models are already smart enough. The blocker is **domain knowledge**: company-specific context locked in senior people's heads, in Slack, in email threads, in meetings, in documents nobody wrote down.

Drop a frontier model into a business without that context and it produces confident nonsense.

So the work is *extraction*: turning tacit institutional knowledge into structured context a model can read, call as tools, and iterate on. Without this there is nothing for a loop to reason over.

## 4. The Recursive Self-Improving Loop `02:24`

The core framework — five layers which, once wired together in any part of the business, make that part improve on its own:

| Layer | What it is |
|---|---|
| **1. Sensor** | Ingest every real signal the company generates: support tickets, customer emails, cancellations, code changes, telemetry |
| **2. Policy** | Explicit rules for what the system may do autonomously vs. what needs a human signature |
| **3. Tool** | Deterministic APIs and skills the agent can call: query a database, check a calendar, send an email, update a record |
| **4. Quality gate** | Nothing commits without passing evals, safety filters, and human review on high-risk actions |
| **5. Learning** | The system observes where it failed in the real world and feeds that back to the top of the loop |

**The loop only becomes genuinely self-improving when all five run without a human in the middle.** Four out of five is a workflow, not a loop.

## 5. The Holy Shit Moment at YC `04:12`

The proof case, and the emotional centre of the talk.

YC built an internal agent letting partners query founder history in natural language — *"when did I last meet this founder?"* Useful, unremarkable, roughly a 20–30% improvement.

The step change came from putting a **monitoring agent on top of it**. It watched every query, tracked successes and failures, and when a query failed it diagnosed the root cause: do we need a different tool, a new database view, better indexing, an updated skill?

Then, overnight and unprompted, it **wrote the fix, opened a pull request against the YC codebase, had a separate agent review it, merged it, and deployed**. By morning, the query that failed the night before simply worked. No human touched it.

Reported arc: fixed-tool agent (2025) → monitoring layer proposing fixes (early 2026) → full write/review/merge/deploy overnight (by May 2026).

This is categorically different from productivity assistance. **The system detected its own defect and regulated itself back to working.**

## 6. Self-Optimizing Product and Support Loops `05:50`

The same pattern, pointed at customer-facing functions:

- **Product loop:** an agent watches the signup/sales funnel for friction, researches candidate fixes, runs A/B tests, ships the winner, repeats — with no PM convening the decision.
- **Support loop:** inbound tickets and suggestions are evaluated against the roadmap; off-strategy requests are declined, accepted ones are coded and deployed back to the customer.

In both, the human decision step traditionally sitting in the middle is removed — and the sensor → policy → tool → gate → learning structure is what makes removing it safe.

## 7. Burn Tokens, Not Headcount `06:29`

Once the loops exist, the binding constraint stops being headcount and becomes **token spend**. So deliberately over-spend on inference rather than hire.

Two practical tests he offers:
- Measure high performers by AI adoption and token consumption. *(He concedes the metric is gameable, but says it points attention the right way.)*
- Before opening any req, ask whether a well-designed loop plus human supervision could do that function instead.

Numbers cited on stage — **note these are unaudited, sourced to a single write-up, and at least one commentator has publicly flagged the RPE figure as unverified:**
- YC companies reaching Demo Day at ~5× revenue per employee vs. ~18 months earlier (Nov 2024 baseline)
- Spring 2026 batch companies doing with 5–6 people what used to take 20–30 — high token bills, very low payroll, positive margins

> **`tepui`'s reading:** this is a claim about *allocation*, not permission to be wasteful. Spending $500/month on inference instead of $8,000/month on a hire is the point. Spending $500 where $60 would do is just a bad loop — see [cost.md](cost.md).

## 8. Middle Management Is Over `07:23`

Middle management exists to solve a coordination problem: routing information, aligning work, chasing status. AI solves that same problem faster, so the layer has no remaining justification.

Two human roles survive:
- **IC (individual contributor)** — now expected to bring a *working prototype*, not an idea or a deck.
- **DRI (directly responsible individual)** — one named owner per outcome. **Never a committee.**

## 9. Make Everything Legible to AI `08:05`

**The prerequisite for everything above, and the most actionable instruction in the talk.**

The company brain can only reason over what was captured. The governing rule: *recording is what makes something real to the system.* If an interaction wasn't recorded, it didn't happen as far as the intelligence is concerned.

Practically: store partner emails, Slack, and documents; record meetings; then **diarize and synthesize raw recordings into navigable, compressed form** that fits in context, rather than leaving them as unusable audio.

The audit he asks founders to run: *what does this company know that exists only in someone's head, or in an expired chat?* That is the surface area AI currently cannot touch.

> **`tepui`'s reading:** recording humans is a consent and privacy decision before it is a technical one. Policy first, tooling second.

## 10. Regenerating the YC User Manual `09:40`

The flagship legibility example. YC had ~2,000 hours of recorded office hours (about three months of partner sessions). Over **a single weekend** they regenerated YC's entire user manual from that raw corpus — reported at ~150 pages, and dramatically better than the hand-written original, because it was synthesized from what partners *actually advise* rather than what someone once wrote down.

It is now a living document, regenerating on a rolling basis (reported monthly), absorbing new advice or discarding it as the corpus grows.

This is the sensor → learning loop applied to institutional knowledge rather than to code.

## 11. Software Is Ephemeral, Context Is Valuable `11:19`

**The most counterintuitive claim.** Because frontier models improve every few months, internal software — dashboards, workflows, tools — should be treated as **disposable and regenerated every one to two months**, not maintained as a permanent artifact.

What must never be thrown away is **context**: the data, the domain knowledge, the reasoning behind past decisions, the operational understanding of why things work the way they do.

The storage prescription is deliberately low-tech and model-agnostic — **markdown, structured logs, plain-language runbooks** — so the corpus survives model turnover and can be re-ingested by whatever comes next.

*Store data preciously. Treat code as cheap.*

> **`tepui`'s reading:** this is the single strongest argument for the repo's shape. Loops are regenerable; `memory/` and `company/` are not. That's why they're the only two places company facts may live.

## 12. Where Humans Still Matter `12:18`

Humans don't disappear — they **relocate from the middle of the org to its perimeter**. The closing image: a company brain at the centre (accumulated data, email, skills, institutional knowledge) with humans arrayed around the edge, at the interface where the intelligence meets reality.

Four zones reserved for humans:
1. **Genuinely novel situations** outside the training distribution
2. **High-stakes, emotionally loaded moments**
3. **Ethical judgment** requiring real moral reasoning (his example: co-founder disputes)
4. **Sales and relationship conversations** — which he expects to stay human for 20+ years

And the career reframe: the valuable skill shifts from writing code fast to **designing systems that learn**. The winners in five years won't be the best prompters — they'll be the people who built companies that improve on their own.

He closes by challenging founders — especially at sub-50-person companies, for whom he says there's *no excuse* — with the question: **building from scratch today, would you choose this shape?**

---

## How these map onto this repo

| Principle | Where it lives in `tepui` |
|---|---|
| 3. Extract domain knowledge | `company/` + each loop's `setup.md` interview |
| 4. The five-layer loop | The literal directory structure of `loops/<name>/` |
| 5. Monitoring agent | Phase 1's learning layer — failed queries open PRs |
| 7. Burn tokens not headcount | `docs/cost.md` — engineered spend, not careless spend |
| 8. IC / DRI | `roles/`, and one DRI per entry in `registry.yaml` |
| 9. Legibility | Everything is markdown in git, by construction |
| 11. Software ephemeral, context precious | Loops are regenerable; `memory/` and `company/` are sacred |
| 12. Humans at the edge | `policy.md` per loop — what needs a signature |

### Sources

Primary: the video description and chapter markers. Secondary write-ups used to reconstruct the substance include [Towards AI](https://towardsai.com/p/machine-learning/how-to-build-a-self-improving-company-with-ai), [StartupHub](https://www.startuphub.ai/ai-news/artificial-intelligence/2026/ai-native-companies-building-self-improving-organizations), [Chief of AI](https://chiefofai.substack.com/p/brief-34-the-self-improving-company) (which flags the 5× RPE figure as unaudited), and [flatnine](https://flatnine.co/blog/the-self-improving-company).
