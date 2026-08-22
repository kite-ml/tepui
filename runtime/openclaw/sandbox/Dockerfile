# Sandbox image for agent tool execution.
#
# Every agent with sandbox.mode != off runs its exec/read/write/edit tools
# inside a throwaway container from this image. It is the boundary between an
# agent doing something dumb (or something it was talked into) and the host.
#
# python3 is required — OpenClaw's write/edit helpers depend on it and the
# runtime explicitly refuses to substitute a plain debian:bookworm-slim.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ca-certificates git curl ripgrep jq \
      && rm -rf /var/lib/apt/lists/*

# ffmpeg for the video-editor agent. Kept in the sandbox image rather than on
# the host, so video work has no path to the host filesystem.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
      && rm -rf /var/lib/apt/lists/*

# Non-root by default. The sandbox also runs with no network and a read-only
# root filesystem, so in-turn package installs will fail by design — bake what
# you need into this image instead.
RUN useradd -m -u 1000 agent || true
USER agent
WORKDIR /workspace
