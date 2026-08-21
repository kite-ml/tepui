#!/usr/bin/env bash
# Register one Slack app per agent.
#
# Usage:  ./deploy/slack/finish-setup.sh <account>      e.g. ops | analyst | marketing
#
# One Slack app == one bot user == one @handle, so each agent that should be
# individually addressable needs its own app. Tokens are read with a hidden
# prompt and never passed as argv, so they stay out of shell history and `ps`.
set -euo pipefail
# Shared-app mode: no argument. Pass an account slug only if you have promoted
# one agent to its own Slack app (slack_account: <name> in org.overlay.yaml).
ACCOUNT="${1:-}"
if [[ -n "$ACCOUNT" ]]; then
  [[ "$ACCOUNT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "✗ account must be a lowercase slug"; exit 1; }
  SUFFIX="_$(echo "$ACCOUNT" | tr 'a-z-' 'A-Z_')"
else
  SUFFIX=""
fi
UP="${SUFFIX#_}"
ENV_FILE="$(cd "$(dirname "$0")/../../runtime/openclaw/local" && pwd)/.env"

echo "Registering Slack app${ACCOUNT:+ for agent: $ACCOUNT}"
read -rsp "  SLACK_BOT_TOKEN$SUFFIX (xoxb-...): " BOT; echo
read -rsp "  SLACK_APP_TOKEN$SUFFIX (xapp-...): " APP; echo

[[ "$BOT" == xoxb-* ]] || { echo "✗ bot token must start with xoxb-"; exit 1; }
[[ "$APP" == xapp-* ]] || { echo "✗ app token must start with xapp-"; exit 1; }

echo "→ verifying with Slack..."
RESP=$(curl -sS -H "Authorization: Bearer $BOT" https://slack.com/api/auth.test)
python3 - "$RESP" <<'PY'
import json,sys
d=json.loads(sys.argv[1])
if not d.get("ok"):
    print(f"  ✗ Slack rejected the bot token: {d.get('error')}"); sys.exit(1)
print(f"  ✓ team={d.get('team')}  handle=@{d.get('user')}  id={d.get('user_id')}")
PY

touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
grep -vE "^SLACK_(BOT|APP)_TOKEN$SUFFIX=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
{ cat "$ENV_FILE.tmp"; echo "SLACK_BOT_TOKEN$SUFFIX=$BOT"; echo "SLACK_APP_TOKEN$SUFFIX=$APP"; } > "$ENV_FILE"
rm -f "$ENV_FILE.tmp"; chmod 600 "$ENV_FILE"
echo "  ✓ saved to .env (mode 600, gitignored)"

# Activate the Slack channel now that the token is verified. Until this point
# the includes stay commented out, because the gateway fails closed on a
# missing secret and that would take the whole company OS down.
CFG="$(cd "$(dirname "$0")/../../runtime/openclaw/local" && pwd)/state/openclaw.json"
if [[ -f "$CFG" ]] && grep -q '^\s*// "channels"' "$CFG"; then
  python3 - "$CFG" <<'EOF'
import sys, re
p = sys.argv[1]; s = open(p).read()
s = re.sub(r'^(\s*)// ("(?:channels|bindings)":)', r'\1\2', s, flags=re.M)
open(p, "w").write(s)
EOF
  echo "  ✓ Slack channel activated in the gateway config"
  echo "    restart with: cd runtime/openclaw/local && docker compose restart gateway"
fi

echo
echo "→ channels the app can see (paste these IDs into org.overlay.yaml):"
curl -sS -H "Authorization: Bearer $BOT" \
  "https://slack.com/api/users.conversations?types=public_channel,private_channel&limit=100" \
| python3 -c "
import sys,json
ch=json.load(sys.stdin).get('channels',[])
if not ch: print('  (none — run /invite in a channel, then re-run)')
for c in ch: print(f\"  {c['id']}  #{c['name']}\")
"
echo
echo "ops is the catch-all, so it answers wherever the app is invited."
echo "Give another agent a room by putting its channel ID in slack_channels."
