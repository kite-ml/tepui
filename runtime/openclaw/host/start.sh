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
grep -iE 'slack|channel' "$STATE_DIR/gateway.log" | tail -3 || true
