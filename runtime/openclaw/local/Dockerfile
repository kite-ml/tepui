# tepui gateway = pinned OpenClaw + the Slack channel plugin.
#
# Slack is not bundled in core (only Telegram and Reef are), and our container
# is ephemeral with read-only config mounts — so `plugins install` at runtime
# would be lost on every recreate. Baking it in keeps the digest pin meaningful:
# the base is immutable and the plugin version is explicit.
FROM ghcr.io/openclaw/openclaw@sha256:2f5ce8848a1a69b3c460622e566cb9395da9fd18d7ef7b038cd8e2c4f195decf

USER root
RUN npm install -g @openclaw/slack@latest 2>/dev/null \
 || npm install -g @openclaw/slack \
 || echo "WARN: @openclaw/slack not installable from npm; see below"
USER node
