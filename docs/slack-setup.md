# Slack setup

Slack is the human interface to tepui: you talk to `ops` in a channel, and `ops` delegates. This is the runbook for the parts only a human can do.

## One app, routed by channel

**One Slack app for the whole company.** You `@agent` and the *channel* decides who answers: `#design` reaches the designer, `#analytics` reaches the analyst. Two tokens total, not two per agent.

`ops` is the **catch-all** — it answers wherever the app is invited unless a narrower channel rule claims that channel — and it delegates to the others. So everything works from the moment the app is installed, before you have wired up a single channel ID.

Why not a handle per agent? In Slack **one app is one bot user is one `@handle`**, so `@agent-designer` would need its own app and its own token pair. That is supported (`slack_account: <name>` on any employee) and worth doing later for an agent you address constantly, but it is N apps for N handles, and channel routing gets you most of the way for a fifth of the setup.

`intake` gets no Slack route at all. It is the quarantine agent, reached only by delegation — making it addressable would hand anyone a channel straight into the agent designed to absorb hostile text.

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

Run the helper once — it prompts hidden, verifies against Slack, and writes to the gitignored `.env`:

```bash
./deploy/slack/finish-setup.sh
```

Tokens land as `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`. Then `pnpm compile`.

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
