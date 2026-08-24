# tepui

**Run a company's repetitive work with AI agents — with the org chart, permissions, and budgets written down as plain files.**

Named after the flat-topped mountains of Venezuela: an old, stable platform that other things grow on.

---

## The premise

AI models are already good enough to do real business work: drafting outreach, summarising analytics, triaging tickets, writing marketing copy. What most companies are missing is not intelligence — it is structure:

- who is responsible for what
- what each agent is allowed to touch
- how much each job may spend
- when a human must sign off

In a human company those live in job descriptions, budgets, and management. tepui writes them down as a few plain files and turns them into running agents. Because the files live in git, every change to who-can-do-what is reviewed like code — and the company's accumulated knowledge outlives any single model, vendor, or tool.

The goal is a small company that gets more done per person, safely: agents do the repetitive work and prepare drafts; people decide, approve, and handle everything genuinely new.

There is a longer game too. **The future value of a company will be the context it gathers — about its customers, its market, its own decisions and their outcomes — and how it uses that context, at scale, to make the next decisions.** Software is becoming cheap to regenerate; accumulated context is not. tepui is built for that: everything the agents learn and every decision made lands as plain files in a repo you own, not inside a vendor's product. Companies that own their own intelligence get to compound it. Companies that rent it start over every time they switch tools.

## Status — read this before adopting

**Works today**, verified against a live gateway:

- **Org chart as code.** Describe your agents in `org.yaml`; one command turns that into a running system.
- **Real permission boundaries.** An agent without a tool never even sees that the tool exists, so it cannot be talked into using it.
- **Live spending enforcement.** Every model call passes through a local gate with per-agent daily and per-run price caps; over the cap, the call is refused before money moves. Verified live, with the ledger feeding the daily digest.
- **Loops that run themselves.** Schedules declared in git are reconciled into the runtime; the daily digest wakes at 07:30, runs its collector, and posts to Slack — reporting failures and *silence* first, because a job that quietly stops is the documented way agent systems rot.
- **Slack.** One app; you talk to agents in channels.
- **Deploys anywhere.** The same setup runs on a laptop, a small cloud VM, or a Mac mini.

- automatic quality checks on loop output (`evals/`)
- a deeper learning step — today agents keep lessons in their `MEMORY.md` (read before every job, one line appended after; your edits always win) and the digest reports what changed; nothing yet rewrites a loop from its own history
- more loops. Shipping now: `daily-digest`, `content-draft` (drafts only, no publish key), `metrics-digest` (answers questions about data files; ships disabled until you use a commercial model endpoint, because it reads company data), `hello-world`

So today this is the structure and safety layer, real and tested. The loop library is the roadmap — see [PLAN.md](PLAN.md).

## How it works

Three kinds of files describe your company. A compiler turns them into configuration for [OpenClaw](https://github.com/openclaw/openclaw), the open-source runtime that actually runs the agents, connects Slack, and executes tools. (What OpenClaw provides versus what tepui adds: [docs/what-is-openclaw.md](docs/what-is-openclaw.md).)

### 1. The org chart — `org.yaml`

Your agents are employees, with a boss, a job, tools, and a budget:

```yaml
analyst:
  title: Analyst
  reports_to: ops                    # ops may hand work to analyst
  tools: { profile: readonly }       # can read, cannot change anything
  budget: { per_run_usd: 0.25, per_day_usd: 3.00 }

intake:
  title: Intake                      # reads email, tickets — outside text
  reads_untrusted_input: true
  skills: []                         # therefore: holds no keys, no tools that act
```

The compiler refuses configurations that break the safety rules — for example an agent that reads outside text while holding credentials. It fails the build rather than warning, because warnings get ignored.

### 2. Company context — `company/`

The half that makes it *your* company. The template ships `company.example/`; copy it and edit:

- `org.overlay.yaml` — names, model choices, Slack channels
- `agents/<name>/IDENTITY.md` — each agent's standing instructions. Generated from the org chart the first time, then yours to edit; the compiler never overwrites your edits
- `decisions/` — one file per significant decision: the question, the data consulted, the call, and a date to check whether it worked

Keep `company/` in a **private repo** that uses this one as `upstream`. Your context lives in paths this template does not have, so pulling core improvements never touches it. See [company.example/README.md](company.example/README.md).

### 3. Loops — `loops/`

A loop is one repeatable job, as a folder:

```
loops/weekly-report/
├── SKILL.md        what to do, as plain instructions
├── sensor.yaml     when to run — a schedule, or a watch script
├── policy.yaml     what it may touch: keys held, spend caps, what needs sign-off
├── evals/          checks the output must pass          (planned)
└── memory/         what it has learned; drafts kept     (planned)
```

A loop is not a chat. It wakes on its own, does the job, saves a draft, and stops. The watch scripts are cheap by design: checking "did anything change?" costs no model call at all — the model only wakes when the answer is yes.

**Publishing is always a human action.** A loop that must not send email simply never holds the email credential — there is nothing to trick it into.

## Safety, in plain terms

1. **Missing tools, not rules.** Agents are constrained by what they physically have, not by instructions. Instructions can be argued with; a tool that was never offered cannot.
2. **A padded room for outside text.** Anything reading tickets, inbound email, or web pages runs as an agent that holds nothing and can act on nothing. Verified live: fed a malicious message demanding it leak keys, it had one read-only status tool and nothing else.
3. **Money gets a ceiling.** Every job declares a per-run and per-day price cap, checked before the model is called — an unattended agent burning a fortune overnight is a documented industry failure. *Status: built and tested; wiring into the live gateway is the top roadmap item.*
4. **Git is the authority.** The runtime reads its permissions from files mounted read-only. Changing what an agent may do requires a commit — reviewable, revertable, attributable.

## Run it

```bash
git clone https://github.com/kite-ml/tepui && cd tepui
cp -r company.example company        # make it yours
pnpm install && pnpm compile         # org.yaml + company/ -> runtime config
# put your model API key in runtime/openclaw/local/.env  (never committed)
./runtime/openclaw/host/start.sh     # gateway + agents + Slack
```

Slack setup (one app, ~10 minutes): [docs/slack-setup.md](docs/slack-setup.md).
Cloud deployment on a small VM: [deploy/gcp/](deploy/gcp/).

## More

- [PLAN.md](PLAN.md) — the build plan and what's next
- [docs/principles.md](docs/principles.md) — the thinking this design comes from
- [docs/evidence.md](docs/evidence.md) — what actually breaks when companies run on agents, and the design answers
- [docs/cost.md](docs/cost.md) — keeping the model bill small
- [docs/what-is-openclaw.md](docs/what-is-openclaw.md) — exactly which parts are the runtime and which are tepui

MIT. Built by [Kite](https://kiteml.com).
