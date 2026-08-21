# Slack setup

Slack is the human interface to tepui: you talk to `ops` in a channel, and `ops` delegates. This is the runbook for the parts only a human can do.

## One app per agent

You address agents individually — `@tepui-ops`, `@tepui-analyst`, `@tepui-marketing` — and that requires **one Slack app per agent**, because in Slack one app is one bot user is one `@handle`. OpenClaw supports this through `channels.slack.accounts.*`, with each account opening its own Socket Mode connection, and `bindings` routing on `accountId`.

This costs more setup (three apps, six tokens) but buys something beyond ergonomics: **Slack channel membership becomes an access-control layer that mirrors the org chart.** Invite `@tepui-marketing` only where marketing should operate, and the capability boundary is visible in the UI rather than buried in `org.yaml`.

`intake` deliberately gets **no** Slack app. It is the quarantine agent, reached by delegation from `ops` — making it directly addressable would hand anyone a channel straight into the agent designed to absorb hostile text.

**Socket Mode, not Events API.** Socket Mode opens an *outbound* WebSocket to Slack, so the gateway needs **no public URL, no DNS, no TLS, no reverse proxy, and no inbound firewall rule.** That is what lets the same config run on a laptop, a GCP VM with zero ingress, and a Mac mini behind home NAT — which is the whole portability requirement.

---

## 1. Install the plugin

Slack is **not** bundled in core (only Telegram and Reef are):

```bash
openclaw plugins install @openclaw/slack
```

⚠️ Our image is pinned by digest and the container is largely read-only, so bake this into the image or mount a writable plugin directory. Installing it into a container that gets recreated will silently lose it.

## 2. Create the Slack app

At [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.

1. **Socket Mode** → toggle **Enable Socket Mode** on. Slack will make you create an **App-Level Token** — give it the `connections:write` scope. This is `SLACK_APP_TOKEN` and starts `xapp-`.
2. **OAuth & Permissions** → add these **Bot Token Scopes**:
   ```
   app_mentions:read   assistant:write   channels:history   channels:read
   chat:write          chat:write.customize                 commands
   groups:history      groups:read       im:history         im:read
   im:write            users:read
   ```
   `chat:write.customize` is optional but worth having — it lets each agent post under its own name and icon, so `ops`, `analyst`, and `marketing` are visually distinct rather than one anonymous bot.
3. **Event Subscriptions** → enable, and subscribe to bot events:
   ```
   app_mention   message.channels   message.groups   message.im
   ```
4. **Install to Workspace**. Copy the **Bot User OAuth Token** — this is `SLACK_BOT_TOKEN` and starts `xoxb-`.
5. Invite the bot to each channel: `/invite @yourbot`.

## 3. Get the channel IDs

Use **IDs, not names** — names are mutable, IDs are not, and the compiler rejects anything that is not a `C...` ID.

In Slack: right-click a channel → **View channel details** → the ID is at the bottom of the dialog.

## 4. Wire it up

Run the helper once per agent — it prompts hidden, verifies against Slack, and writes to the gitignored `.env`:

```bash
./deploy/slack/finish-setup.sh ops
./deploy/slack/finish-setup.sh analyst
./deploy/slack/finish-setup.sh marketing
```

Each agent's tokens land as `SLACK_BOT_TOKEN_OPS` / `SLACK_APP_TOKEN_OPS` and so on, matching the `slack_account` value in `org.overlay.yaml`. Then `pnpm compile`.

**Optionally pin an agent to specific channels** by adding IDs alongside its account:

```yaml
employees:
  analyst:
    slack_account: analyst
    slack_channels: ["C0DEF456ANALYTICS"]   # only answers here
```

Without `slack_channels`, an agent answers wherever its app is invited. The compiler emits `bindings.json5` routing each channel to its agent, and sets `requireMention: true` on every bound channel.

**`requireMention` is deliberate.** In a shared workspace an agent that replies to every message is a nuisance, not a colleague. You address it explicitly: `@ops what did we spend yesterday?`

## 5. Security settings that matter

| Setting | Value | Why |
|---|---|---|
| `requireMention` | `true` on every bound channel | Set by the compiler. Do not disable it in a channel with humans |
| `dmPolicy` | `pairing` | DMs from arbitrary workspace members should not reach an agent unprompted |
| `unfurlLinks` | `false` (default) | Unfurling makes the gateway fetch attacker-supplied URLs |
| `dangerouslyAllowNameMatching` | leave **off** | The name says it |

⚠️ **Slack is an untrusted-input surface.** Anything a human or an integration posts is attacker-influenceable — a pasted email, a webhook from a form, a link preview. Loops that read arbitrary Slack content belong to the `intake` agent, which holds no credentials and cannot exec. See [PLAN.md](../PLAN.md) §2.4.
