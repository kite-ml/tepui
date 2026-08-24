#!/usr/bin/env bash
# Run ON the VM (via IAP SSH) after provision.sh created it. Idempotent.
# Everything lands under /srv/tepui (the persistent state disk mount).
set -euo pipefail
echo "==> packages"
sudo apt-get update -q && sudo apt-get install -y -q git curl ca-certificates sqlite3 >/dev/null
command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sudo sh; }

echo "==> node 24 (openclaw needs >=24.15; distro node is older)"
if [ ! -x /usr/local/node24/bin/node ]; then
  NV=v24.19.0
  curl -fsSL "https://nodejs.org/dist/$NV/node-$NV-linux-x64.tar.gz" | sudo tar xz -C /usr/local
  sudo mv "/usr/local/node-$NV-linux-x64" /usr/local/node24
fi
export PATH=/usr/local/node24/bin:$PATH
node --version

echo "==> openclaw (pinned) + slack plugin into node24's global"
# sudo strips PATH, and npm's shebang needs `node` on it — hence env PATH.
/usr/local/node24/bin/npm ls -g openclaw 2>/dev/null | grep -q 2026.7.1 \
  || sudo env "PATH=/usr/local/node24/bin:$PATH" /usr/local/node24/bin/npm install -g openclaw@2026.7.1 @openclaw/slack@2026.7.1
echo "==> service user + dirs on the state disk"
id tepui >/dev/null 2>&1 || sudo useradd -r -m -d /srv/tepui -s /usr/sbin/nologin tepui
sudo usermod -aG docker tepui
sudo mkdir -p /srv/tepui/state/config && sudo chown -R tepui:tepui /srv/tepui

echo "==> repo dependencies (compile.ts imports yaml)"
cd /srv/tepui/tepui-kite
sudo env "PATH=/usr/local/node24/bin:$PATH" /usr/local/node24/bin/npm install --no-package-lock --omit=dev --silent
sudo chown -R tepui:tepui /srv/tepui/tepui-kite/node_modules

echo "==> sandbox image"
sudo docker image inspect openclaw-sandbox:bookworm-slim >/dev/null 2>&1 \
  || sudo docker build -t openclaw-sandbox:bookworm-slim /srv/tepui/tepui-kite/runtime/openclaw/sandbox

echo "==> systemd"
sudo cp /srv/tepui/tepui-kite/deploy/gcp/systemd/tepui-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable tepui-proxy tepui-gateway
echo "bootstrap done — start with: sudo systemctl start tepui-proxy tepui-gateway"
