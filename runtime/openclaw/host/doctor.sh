#!/usr/bin/env bash
# tepui doctor — every check is something that actually bit us during setup.
# Exit code: number of hard failures.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
COMPANY="${TEPUI_COMPANY:-$ROOT/company}"
FAILS=0
ok()   { printf "  ✓ %s\n" "$1"; }
bad()  { printf "  ✗ %s\n      fix: %s\n" "$1" "$2"; FAILS=$((FAILS+1)); }
warn() { printf "  ⚠ %s\n" "$1"; }

echo "tepui doctor"

# Node: openclaw requires >=24.15; Homebrew often ships older. (Bit us: 24.5.)
[[ -x /tmp/node24/bin/node ]] && export PATH="/tmp/node24/bin:$PATH"
NV=$(node --version 2>/dev/null | tr -d v)
if [[ -z "$NV" ]]; then bad "node not found" "install Node 24.15+"
elif [[ "$(printf '%s\n24.15.0\n' "$NV" | sort -V | head -1)" != "24.15.0" ]]; then
  bad "node $NV too old for openclaw" "install Node >=24.15 (or place one at /tmp/node24)"
else ok "node $NV"; fi

# OpenClaw, pinned. (Bit us: docs describe a newer CLI than the pin.)
OCM=""
for C in /opt/homebrew/lib/node_modules/openclaw/openclaw.mjs /usr/local/lib/node_modules/openclaw/openclaw.mjs; do
  [[ -f "$C" ]] && OCM="$C" && break
done
if [[ -z "$OCM" ]]; then bad "openclaw not installed" "npm i -g openclaw@2026.7.1"
else
  V=$(node "$OCM" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  [[ "$V" == "2026.7.1" ]] && ok "openclaw $V (matches pin)" || warn "openclaw $V != pinned 2026.7.1 — CLI surface may differ"
fi

# Slack plugin. (Bit us: global npm install is invisible without a load path.)
if [[ -d /opt/homebrew/lib/node_modules/@openclaw/slack || -d /usr/local/lib/node_modules/@openclaw/slack ]]; then
  ok "slack plugin installed"
else bad "slack plugin missing" "npm i -g @openclaw/slack@2026.7.1"; fi

# Docker + sandbox image. (Bit us: runtime refuses to substitute a plain image.)
if docker info >/dev/null 2>&1; then
  ok "docker daemon up"
  if docker image inspect openclaw-sandbox:bookworm-slim >/dev/null 2>&1; then
    ok "sandbox image present"
  else bad "sandbox image missing" "docker build -t openclaw-sandbox:bookworm-slim $ROOT/runtime/openclaw/sandbox"; fi
else bad "docker not running" "start Docker Desktop / colima"; fi

# Secrets file. (Bit us: a subtree split once left .env stageable.)
ENVF="$ROOT/runtime/openclaw/local/.env"
if [[ -f "$ENVF" ]]; then
  P=$(stat -f %Lp "$ENVF" 2>/dev/null || stat -c %a "$ENVF" 2>/dev/null)
  [[ "$P" == "600" ]] && ok ".env present, mode 600" || warn ".env mode $P — chmod 600 it"
  for K in NVIDIA_API_KEY SLACK_BOT_TOKEN SLACK_APP_TOKEN; do
    grep -q "^$K=" "$ENVF" && ok "$K set" || warn "$K missing from .env"
  done
  if git -C "$ROOT" check-ignore -q "$ENVF"; then ok ".env is gitignored"
  else bad ".env NOT gitignored" "fix .gitignore before anything else"; fi
else bad ".env missing" "create $ENVF (see docs/slack-setup.md)"; fi

# Company overlay + compile.
if [[ -d "$COMPANY" ]]; then
  if node "$ROOT/runtime/openclaw/compile.ts" "$COMPANY" --out /tmp/tepui-doctor-out >/dev/null 2>&1; then
    ok "compile passes"; rm -rf /tmp/tepui-doctor-out
  else bad "compile fails" "node runtime/openclaw/compile.ts $COMPANY"; fi
else bad "company/ missing" "cp -r company.example company"; fi

# Live processes (informational).
lsof -ti:18888 >/dev/null 2>&1 && ok "gateway running :18888" || warn "gateway not running (start.sh)"
curl -sf http://127.0.0.1:${TEPUI_PROXY_PORT:-18900}/healthz >/dev/null 2>&1 \
  && ok "budget proxy running :${TEPUI_PROXY_PORT:-18900}" || warn "budget proxy not running"

echo
[[ $FAILS -eq 0 ]] && echo "all checks passed" || echo "$FAILS hard failure(s)"
exit $FAILS
