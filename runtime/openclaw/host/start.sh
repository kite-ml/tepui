#!/usr/bin/env bash
# Run the gateway ON THE HOST, with Docker beside it for sandboxing.
#
# This is the shape that actually works, and the shape the GCP VM runs:
#   - agent tool execution is sandboxed in throwaway containers, which needs
#     the gateway to reach a Docker daemon
#   - putting the gateway itself in a container would require mounting
#     docker.sock, which hands host control to anything that escapes the
#     sandbox — the exact thing the sandbox exists to prevent
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"          # repo root
COMPANY="$(cd "${TEPUI_COMPANY:-$ROOT/company}" && pwd)"
CONFIG_DIR="${TEPUI_CONFIG_DIR:-/tmp/tepui-host/config}"
STATE_DIR="${TEPUI_STATE_DIR:-/tmp/tepui-host/state}"

# Node >= 24.15 is required by openclaw; the system node may be older.
if [[ -x /tmp/node24/bin/node ]]; then export PATH="/tmp/node24/bin:$PATH"; fi
command -v node >/dev/null || { echo "✗ node not found"; exit 1; }

# Secrets come from the gitignored .env — never from the repo, never from argv.
ENV_FILE="$ROOT/runtime/openclaw/local/.env"
[[ -f "$ENV_FILE" ]] || { echo "✗ missing $ENV_FILE"; exit 1; }
set -a; source "$ENV_FILE"; set +a

# Compile fresh so the running config always matches git.
mkdir -p "$CONFIG_DIR/generated" "$STATE_DIR"
node "$ROOT/runtime/openclaw/compile.ts" "$COMPANY" \
  --workspace-root "$COMPANY" --out "$CONFIG_DIR/generated"

# The config stub holds no secrets, so it is regenerated every start from the
# template — no drift, and a fresh machine needs zero hand-editing.
# Gateway auth: without a configured token the gateway mints a random one per
# boot and the CLI (which sync depends on) cannot connect. Generate once,
# persist in the gitignored .env, substitute into the config each start.
if ! grep -q '^GATEWAY_TOKEN=' "$ENV_FILE"; then
  echo "GATEWAY_TOKEN=$(openssl rand -hex 24)" >> "$ENV_FILE"
  echo "→ generated gateway auth token into .env"
fi
GATEWAY_TOKEN=$(grep '^GATEWAY_TOKEN=' "$ENV_FILE" | cut -d= -f2)
export OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN"

SLACK_PLUGIN=""
for CAND in /opt/homebrew/lib/node_modules/@openclaw/slack /usr/local/lib/node_modules/@openclaw/slack; do
  [[ -d "$CAND" ]] && { SLACK_PLUGIN="$CAND"; break; }
done
sed -e "s|__SLACK_PLUGIN_PATH__|$SLACK_PLUGIN|" -e "s|__GATEWAY_TOKEN__|$GATEWAY_TOKEN|" \
  "$ROOT/runtime/openclaw/host/openclaw.json.template" > "$CONFIG_DIR/openclaw.json"
chmod 600 "$CONFIG_DIR/openclaw.json"
if [[ -z "$SLACK_PLUGIN" ]]; then
  echo "⚠ slack plugin not installed — channel will warn until: npm i -g @openclaw/slack@2026.7.1"
fi

# The budget proxy is the spend gate: every model call passes through it, and
# the gateway must never start without it — an unmetered gateway is exactly the
# unattended-burn failure the gate exists to prevent.
export TEPUI_SPEND_DIR="${TEPUI_SPEND_DIR:-$COMPANY/spend}"
if lsof -ti:${TEPUI_PROXY_PORT:-18900} >/dev/null 2>&1; then
  lsof -ti:${TEPUI_PROXY_PORT:-18900} | xargs kill -9; sleep 1
fi
nohup node "$ROOT/runtime/openclaw/proxy/budget-proxy.ts" "$COMPANY" > "$STATE_DIR/budget-proxy.log" 2>&1 &
for _ in $(seq 1 20); do
  curl -sf "http://127.0.0.1:${TEPUI_PROXY_PORT:-18900}/healthz" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:${TEPUI_PROXY_PORT:-18900}/healthz" >/dev/null \
  || { echo "✗ budget proxy failed to start:"; tail -5 "$STATE_DIR/budget-proxy.log"; exit 1; }
echo "→ budget proxy up (ledger: $TEPUI_SPEND_DIR)"

docker image inspect openclaw-sandbox:bookworm-slim >/dev/null 2>&1 \
  || { echo "→ building sandbox image (first run only)"; docker build -t openclaw-sandbox:bookworm-slim "$ROOT/runtime/openclaw/sandbox"; }

export OPENCLAW_CONFIG_PATH="$CONFIG_DIR/openclaw.json"
export OPENCLAW_STATE_DIR="$STATE_DIR"

if lsof -ti:18888 >/dev/null 2>&1; then
  echo "→ stopping the running gateway"; lsof -ti:18888 | xargs kill -9; sleep 2
fi

# Resolve openclaw explicitly. `npm root -g` is unreliable here: we prepend a
# pinned Node to PATH for the version requirement, which makes npm report THAT
# install's global root rather than the one openclaw actually lives in.
OCM=""
for CAND in \
  "/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs" \
  "/usr/local/lib/node_modules/openclaw/openclaw.mjs" \
  "$(npm root -g 2>/dev/null)/openclaw/openclaw.mjs"; do
  [[ -f "$CAND" ]] && { OCM="$CAND"; break; }
done
[[ -n "$OCM" ]] || { echo "✗ openclaw.mjs not found — npm install -g openclaw@2026.7.1"; exit 1; }
echo "→ starting gateway (config: $OPENCLAW_CONFIG_PATH)"
nohup node "$OCM" gateway > "$STATE_DIR/gateway.log" 2>&1 &
# Wait for readiness, but fail loudly instead of hanging forever if it crashes.
for _ in $(seq 1 90); do
  grep -q '\[gateway\] ready' "$STATE_DIR/gateway.log" 2>/dev/null && break
  if grep -qE 'Error:|failed to start' "$STATE_DIR/gateway.log" 2>/dev/null; then
    echo "✗ gateway failed to start:"; tail -12 "$STATE_DIR/gateway.log"; exit 1
  fi
  sleep 1
done
grep -q '\[gateway\] ready' "$STATE_DIR/gateway.log" || { echo "✗ timed out"; tail -12 "$STATE_DIR/gateway.log"; exit 1; }
echo "✓ ready — log: $STATE_DIR/gateway.log"
echo "→ reconciling sensors into the scheduler"
node "$ROOT/runtime/openclaw/sync.ts" "$COMPANY" || echo "⚠ sensor sync failed — loops will not run on schedule"
grep -iE 'slack|channel' "$STATE_DIR/gateway.log" | tail -3 || true
