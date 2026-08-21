#!/usr/bin/env bash
# Nightly SQLite backup. The state DB holds jobs, run history, and sessions —
# losing it loses history, not loops (loops live in git). Push to a bucket the
# VM can only WRITE to, so a compromised gateway cannot delete its own trail.
set -euo pipefail
BUCKET="${BUCKET:?set BUCKET}"
DB="${DB:-/srv/tepui/state/state/openclaw.sqlite}"
OUT="/tmp/openclaw-$(date -u +%Y%m%dT%H%M%SZ).sqlite"

# .backup is safe on a live WAL database; cp is not.
sqlite3 "$DB" ".backup '$OUT'"
gzip -9 "$OUT"
gcloud storage cp "$OUT.gz" "gs://$BUCKET/openclaw/"
rm -f "$OUT.gz"
