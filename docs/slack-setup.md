# Slack setup

Slack is the human interface to tepui: you talk to `ops` in a channel, and `ops` delegates. This is the runbook for the parts only a human can do.

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

Put the tokens in the gitignored `.env` (never in git):

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

Put the channel IDs in `tepui-company/org.overlay.yaml`:

```yaml
employees:
  ops:
    slack_channels: ["C0ABC123OPS"]
  analyst:
    slack_channels: ["C0DEF456ANALYTICS"]
```

Then `pnpm compile`. The compiler emits `bindings.json5` routing each channel to its agent, and sets `requireMention: true` on every bound channel.

**`requireMention` is deliberate.** In a shared workspace an agent that replies to every message is a nuisance, not a colleague. You address it explicitly: `@ops what did we spend yesterday?`

## 5. Security settings that matter

| Setting | Value | Why |
|---|---|---|
| `requireMention` | `true` on every bound channel | Set by the compiler. Do not disable it in a channel with humans |
| `dmPolicy` | `pairing` | DMs from arbitrary workspace members should not reach an agent unprompted |
| `unfurlLinks` | `false` (default) | Unfurling makes the gateway fetch attacker-supplied URLs |
| `dangerouslyAllowNameMatching` | leave **off** | The name says it |

⚠️ **Slack is an untrusted-input surface.** Anything a human or an integration posts is attacker-influenceable — a pasted email, a webhook from a form, a link preview. Loops that read arbitrary Slack content belong to the `intake` agent, which holds no credentials and cannot exec. See [PLAN.md](../PLAN.md) §2.4.
