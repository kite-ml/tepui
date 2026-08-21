#!/usr/bin/env bash
# Run this AFTER creating the Slack app. It writes tokens to the gitignored
# .env and verifies them against Slack's API before you touch the gateway.
#
# Tokens are read with a hidden prompt and never echoed, never passed as
# argv (which would land in your shell history and in `ps`).
set -euo pipefail
ENV_FILE="$(cd "$(dirname "$0")/../../runtime/openclaw/local" && pwd)/.env"

read -rsp "SLACK_BOT_TOKEN (xoxb-...): " BOT;  echo
read -rsp "SLACK_APP_TOKEN (xapp-...): " APP;  echo

[[ "$BOT" == xoxb-* ]] || { echo "✗ bot token must start with xoxb-"; exit 1; }
[[ "$APP" == xapp-* ]] || { echo "✗ app token must start with xapp-"; exit 1; }

echo "→ verifying bot token with Slack..."
RESP=$(curl -sS -H "Authorization: Bearer $BOT" https://slack.com/api/auth.test)
python3 - "$RESP" <<'PY'
import json,sys
d=json.loads(sys.argv[1])
if not d.get("ok"):
    print(f"  ✗ Slack rejected the bot token: {d.get('error')}"); sys.exit(1)
print(f"  ✓ team={d.get('team')}  bot={d.get('user')}  id={d.get('user_id')}")
PY

echo "→ writing to $ENV_FILE"
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
grep -v '^SLACK_BOT_TOKEN=' "$ENV_FILE" | grep -v '^SLACK_APP_TOKEN=' > "$ENV_FILE.tmp" || true
{ cat "$ENV_FILE.tmp"; echo "SLACK_BOT_TOKEN=$BOT"; echo "SLACK_APP_TOKEN=$APP"; } > "$ENV_FILE"
rm -f "$ENV_FILE.tmp"; chmod 600 "$ENV_FILE"
echo "  ✓ saved (mode 600, gitignored)"

echo
echo "→ channels the bot is in (use these IDs in org.overlay.yaml):"
curl -sS -H "Authorization: Bearer $BOT" \
  "https://slack.com/api/users.conversations?types=public_channel,private_channel&limit=100" \
| python3 -c "
import sys,json
d=json.load(sys.stdin)
ch=d.get('channels',[])
if not ch:
    print('  (none yet — run /invite @tepui in a channel, then re-run this script)')
for c in ch: print(f\"  {c['id']}  #{c['name']}\")
"
