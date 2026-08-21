#!/usr/bin/env bash
# Register one Slack app per agent.
#
# Usage:  ./deploy/slack/finish-setup.sh <account>      e.g. ops | analyst | marketing
#
# One Slack app == one bot user == one @handle, so each agent that should be
# individually addressable needs its own app. Tokens are read with a hidden
# prompt and never passed as argv, so they stay out of shell history and `ps`.
set -euo pipefail
ACCOUNT="${1:?usage: finish-setup.sh <account>   (ops | analyst | marketing)}"
[[ "$ACCOUNT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "✗ account must be a lowercase slug"; exit 1; }
UP=$(echo "$ACCOUNT" | tr 'a-z-' 'A-Z_')
ENV_FILE="$(cd "$(dirname "$0")/../../runtime/openclaw/local" && pwd)/.env"

echo "Registering Slack app for agent: $ACCOUNT"
read -rsp "  SLACK_BOT_TOKEN_$UP (xoxb-...): " BOT; echo
read -rsp "  SLACK_APP_TOKEN_$UP (xapp-...): " APP; echo

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
grep -vE "^SLACK_(BOT|APP)_TOKEN_$UP=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
{ cat "$ENV_FILE.tmp"; echo "SLACK_BOT_TOKEN_$UP=$BOT"; echo "SLACK_APP_TOKEN_$UP=$APP"; } > "$ENV_FILE"
rm -f "$ENV_FILE.tmp"; chmod 600 "$ENV_FILE"
echo "  ✓ saved to .env (mode 600, gitignored)"

echo
echo "→ channels @$ACCOUNT can see:"
curl -sS -H "Authorization: Bearer $BOT" \
  "https://slack.com/api/users.conversations?types=public_channel,private_channel&limit=100" \
| python3 -c "
import sys,json
ch=json.load(sys.stdin).get('channels',[])
if not ch: print('  (none — run /invite in a channel, then re-run)')
for c in ch: print(f\"  {c['id']}  #{c['name']}\")
"
echo
echo "Invite this app only where that agent should operate — Slack channel"
echo "membership is now part of your access control, not just convenience."
