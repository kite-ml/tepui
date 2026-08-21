#!/usr/bin/env bash
# Provision the tepui gateway on a plain GCP VM.
#
# DESIGN CONSTRAINT: nothing here is GCP-specific except the VM and the backup
# bucket. Slack reaches us over an OUTBOUND WebSocket (Socket Mode), operators
# reach us over Tailscale, and there is NO external ingress at all. Moving to a
# Mac mini later changes the host and one line of org.overlay.yaml — nothing else.
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT}"
ZONE="${ZONE:-us-central1-a}"
NAME="${NAME:-tepui-gateway}"
# e2-medium: 1 vCPU / 4GB, ~$24.46/mo. e2-micro's free tier is NOT viable —
# 1GB RAM (the build OOMs), ~22 baseline IOPS on 30GB pd-standard, and 1GiB/mo
# egress that a single image pull exceeds.
MACHINE="${MACHINE:-e2-medium}"

gcloud compute instances create "$NAME" \
  --project="$PROJECT" --zone="$ZONE" --machine-type="$MACHINE" \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB --boot-disk-type=pd-balanced \
  --create-disk=name="${NAME}-state",size=20GB,type=pd-balanced,auto-delete=no,device-name=tepui-state \
  --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
  --no-service-account --no-scopes \
  --metadata=enable-oslogin=TRUE \
  --tags=tepui

# NO ingress rules are created on purpose. The only inbound path is Tailscale.
# Verify nothing is open:
gcloud compute firewall-rules list --project="$PROJECT" \
  --filter="targetTags.list():tepui" --format="value(name,allowed)" || true

cat <<EOF

VM created. Next, on the box:

  gcloud compute ssh $NAME --zone=$ZONE --project=$PROJECT

  # 1. state disk (survives VM recreation)
  sudo mkfs.ext4 -F /dev/disk/by-id/google-tepui-state   # FIRST TIME ONLY
  sudo mkdir -p /srv/tepui && sudo mount /dev/disk/by-id/google-tepui-state /srv/tepui
  echo '/dev/disk/by-id/google-tepui-state /srv/tepui ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab

  # 2. swap as a shock absorber (NOT capacity)
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile
  sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

  # 3. docker + tailscale
  curl -fsSL https://get.docker.com | sudo sh
  curl -fsSL https://tailscale.com/install.sh | sudo sh
  sudo tailscale up --ssh --hostname=tepui-gateway

  # 4. repos + secrets, then bring it up
  sudo git clone <tepui-core>    /srv/tepui/tepui-core
  sudo git clone <tepui-company> /srv/tepui/tepui-company
  # write /srv/tepui/tepui-core/runtime/openclaw/local/.env  (chmod 600)
  cd /srv/tepui/tepui-core/runtime/openclaw/local && sudo docker compose up -d

IMPORTANT on this VM:
  - set the gateway memory limit to 1500m, not 3G — 4GB total must also host
    dockerd, tailscaled, and up to maxConcurrent sandbox containers
  - set subagents.max_concurrent: 2 in org.yaml
  - set paths.workspace_root: /srv/tepui/tepui-company in org.overlay.yaml
  - watch: journalctl -k | grep -i oom
EOF
