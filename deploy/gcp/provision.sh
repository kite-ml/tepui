#!/usr/bin/env bash
# Provision the tepui gateway on GCP.
#
# This VM runs an agent runtime with exec, reading attacker-influenceable text,
# on a platform whose own threat model excludes prompt injection.
#
# If you place it in a project that also runs production services, the network
# isolation below is not decoration — it is the thing standing between a
# compromised agent and those services. A separate project is cheaper and
# stronger; this is the fallback when you cannot have one.
#
# Portability constraint: nothing here is GCP-specific except the VM, the
# network, and the backup bucket. The same docker compose runs on a Mac mini.
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT to your GCP project id}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
NAME="${NAME:-tepui-gateway}"
NET="${NET:-tepui-vpc}"
MACHINE="${MACHINE:-e2-medium}"     # 4GB. e2-micro's free tier OOMs the build.

echo "==> dedicated VPC (no peering to 'default', so no path to existing services)"
gcloud compute networks create "$NET" --project="$PROJECT" \
  --subnet-mode=custom --description="tepui agent runtime — isolated from default" 2>/dev/null || echo "    exists"
gcloud compute networks subnets create "${NET}-${REGION}" --project="$PROJECT" \
  --network="$NET" --region="$REGION" --range=10.90.0.0/24 2>/dev/null || echo "    subnet exists"

echo "==> firewall: no ingress at all"
# Deliberately NO allow-ingress rules. GCP denies ingress by default; the only
# inbound path is Tailscale, which is an outbound connection.

echo "==> firewall: block lateral movement, allow the internet"
# Denies reaching RFC1918 and the metadata server. Slack (outbound WSS) and the
# model API still work; reaching a private service in another VPC does not.
gcloud compute firewall-rules create "${NET}-deny-egress-private" --project="$PROJECT" \
  --network="$NET" --direction=EGRESS --action=DENY --rules=all --priority=1000 \
  --destination-ranges=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 \
  --description="agent must not reach private ranges" 2>/dev/null || echo "    exists"
# NOTE: 169.254.169.254 is deliberately NOT blocked. It serves OS Login SSH keys
# and the guest agent, so blocking it makes the VM unmanageable. It is safe here
# specifically because --no-service-account leaves no token on it worth stealing.
gcloud compute firewall-rules create "${NET}-allow-egress-internet" --project="$PROJECT" \
  --network="$NET" --direction=EGRESS --action=ALLOW --rules=tcp:443,tcp:80,udp:41641,udp:3478 \
  --destination-ranges=0.0.0.0/0 --priority=1100 \
  --description="https + tailscale" 2>/dev/null || echo "    exists"

echo "==> Cloud NAT (--no-address blocks OUTBOUND too, not just inbound)"
gcloud compute routers create tepui-router --project="$PROJECT" \
  --network="$NET" --region="$REGION" 2>/dev/null || echo "    exists"
gcloud compute routers nats create tepui-nat --project="$PROJECT" \
  --router=tepui-router --region="$REGION" \
  --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges 2>/dev/null || echo "    exists"

echo "==> SSH via IAP only"
gcloud compute firewall-rules create "${NET}-allow-iap-ssh" --project="$PROJECT" \
  --network="$NET" --direction=INGRESS --action=ALLOW --rules=tcp:22 \
  --source-ranges=35.235.240.0/20 --target-tags=tepui \
  --description="SSH via IAP tunnel only — never a public IP" 2>/dev/null || echo "    exists"

echo "==> VM"
gcloud compute instances create "$NAME" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB --boot-disk-type=pd-balanced \
  --create-disk=name="${NAME}-state",size=20GB,type=pd-balanced,auto-delete=no,device-name=tepui-state \
  --subnet="${NET}-${REGION}" --no-address \
  --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
  --no-service-account --no-scopes \
  --metadata=enable-oslogin=TRUE \
  --tags=tepui \
  --labels=app=tepui,managed-by=tepui-core
