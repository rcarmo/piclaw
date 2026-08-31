# PiClaw - Minimal Pi Coding Agent Sandbox
ARG DEBIAN_TRIXIE_SLIM_IMAGE="docker.io/library/debian:trixie-slim@sha256:4ffb3a1511099754cddc70eb1b12e50ffdb67619aa0ab6c13fcd800a78ef7c7a"

FROM ${DEBIAN_TRIXIE_SLIM_IMAGE} AS builder

ARG TARGETARCH
ARG HOMEBREW_BREW_GIT_REMOTES=""
ARG HOMEBREW_CORE_GIT_REMOTES=""
ARG PI_CODING_AGENT_VERSION=""
ARG BUN_VERSION=""
ARG TAILSCALE_VERSION="1.96.4"
# Keep x64 builds portable even on hosts without AVX2.
ARG BUN_PREFER_BASELINE="always"

ENV DEBIAN_FRONTEND=noninteractive \
    TERM=xterm-256color \
    LANG=C.UTF-8 \
    LANGUAGE=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    HOME=/home/agent \
    HOMEBREW_NO_AUTO_UPDATE=1 \
    HOMEBREW_NO_INSTALL_CLEANUP=1 \
    HOMEBREW_CACHE=/tmp/homebrew-cache \
    HOMEBREW_BREW_GIT_REMOTES=${HOMEBREW_BREW_GIT_REMOTES} \
    HOMEBREW_CORE_GIT_REMOTES=${HOMEBREW_CORE_GIT_REMOTES} \
    PI_CODING_AGENT_VERSION=${PI_CODING_AGENT_VERSION} \
    BUN_INSTALL=/usr/local/lib/bun \
    BUN_VERSION=${BUN_VERSION} \
    BUN_PREFER_BASELINE=${BUN_PREFER_BASELINE} \
    PATH=/usr/local/lib/bun/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /tmp

# Builder-only system packages.
RUN apt-get update && \
    apt-get install -y --no-install-recommends tzdata && \
    apt-get install -y --no-install-recommends \
    ca-certificates curl wget unzip bzip2 \
    bash-completion sudo less man \
    git vim tmux htop tree ripgrep jq \
    net-tools iproute2 dnsutils \
    rsync file strace \
    build-essential cmake make pkg-config \
    procps psmisc sqlite3 openssh-client sshfs fuse3 && \
    apt-get autoremove -y && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -G sudo agent && \
    echo 'agent:agent' | chpasswd && \
    echo 'agent ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

COPY scripts/docker/install-agent-runtime.sh /tmp/install-agent-runtime.sh
COPY scripts/docker/install-restic-release.sh /tmp/install-restic-release.sh
COPY scripts/docker/build-piclaw-package.sh /tmp/build-piclaw-package.sh
COPY BUN_VERSION /tmp/BUN_VERSION
COPY RESTIC_VERSION /tmp/RESTIC_VERSION
COPY package.json /tmp/piclaw-package.json
RUN chmod +x /tmp/install-agent-runtime.sh /tmp/install-restic-release.sh /tmp/build-piclaw-package.sh && \
    /tmp/install-restic-release.sh

USER agent
WORKDIR /home/agent
RUN /tmp/install-agent-runtime.sh

COPY --chown=agent:agent package.json bun.lock README.md LICENSE BUN_VERSION RESTIC_VERSION /home/agent/piclaw/
COPY --chown=agent:agent scripts/postinstall.ts /home/agent/piclaw/scripts/postinstall.ts
COPY --chown=agent:agent scripts/prepare-local-install.ts /home/agent/piclaw/scripts/prepare-local-install.ts
COPY --chown=agent:agent docs/install-from-repo.md /home/agent/piclaw/docs/install-from-repo.md
COPY --chown=agent:agent runtime/ /home/agent/piclaw/runtime/
RUN /tmp/build-piclaw-package.sh
RUN PI_CLI="$(readlink -f /usr/local/lib/bun/bin/pi)" && \
    sudo -n sed -i '1s/env node/env bun/' "$PI_CLI" && \
    sudo -n chmod +x "$PI_CLI" && \
    head -n 1 "$PI_CLI"
RUN rm -rf /home/agent/piclaw /home/agent/.cache /home/agent/.bun && \
    sudo rm -f /tmp/install-agent-runtime.sh /tmp/install-restic-release.sh /tmp/build-piclaw-package.sh

FROM scratch AS installed-runtime

# Keep only the installed runtime artifacts from the builder stage.
COPY --from=builder /usr/local/lib/bun/bin/ /usr/local/lib/bun/bin/
COPY --from=builder /usr/local/lib/bun/install/global/ /usr/local/lib/bun/install/global/
COPY --from=builder /usr/local/bin/restic /usr/local/bin/restic
COPY --from=builder /home/linuxbrew/.linuxbrew /home/linuxbrew/.linuxbrew
COPY --from=builder /home/agent/.bashrc /etc/skel.agent/.bashrc
COPY --from=builder /home/agent/.profile /etc/skel.agent/.profile

FROM ${DEBIAN_TRIXIE_SLIM_IMAGE} AS runtime

ARG TARGETARCH
ARG HOMEBREW_BREW_GIT_REMOTES=""
ARG HOMEBREW_CORE_GIT_REMOTES=""
ARG PI_CODING_AGENT_VERSION=""
ARG BUN_VERSION=""
ARG TAILSCALE_VERSION="1.96.4"
ARG BUN_PREFER_BASELINE="always"

ENV DEBIAN_FRONTEND=noninteractive \
    TERM=xterm-256color \
    LANG=C.UTF-8 \
    LANGUAGE=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    HOME=/home/agent \
    HOMEBREW_NO_AUTO_UPDATE=1 \
    HOMEBREW_NO_INSTALL_CLEANUP=1 \
    HOMEBREW_CACHE=/tmp/homebrew-cache \
    HOMEBREW_BREW_GIT_REMOTES=${HOMEBREW_BREW_GIT_REMOTES} \
    HOMEBREW_CORE_GIT_REMOTES=${HOMEBREW_CORE_GIT_REMOTES} \
    PI_CODING_AGENT_VERSION=${PI_CODING_AGENT_VERSION} \
    BUN_INSTALL=/usr/local/lib/bun \
    BUN_VERSION=${BUN_VERSION} \
    BUN_PREFER_BASELINE=${BUN_PREFER_BASELINE} \
    PATH=/usr/local/lib/bun/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /tmp

# Runtime-only system packages. Keep the operator toolbox, but drop the build toolchain.
RUN set -eux; \
    apt-get update && \
    apt-get install -y --no-install-recommends tzdata && \
    apt-get install -y --no-install-recommends \
    ca-certificates curl wget unzip bzip2 \
    bash-completion sudo less man \
    git vim tmux htop tree ripgrep jq \
    net-tools iproute2 dnsutils \
    rsync file strace make \
    procps psmisc supervisor sqlite3 openssh-client sshfs fuse3 && \
    case "${TARGETARCH}" in \
      amd64) tailscale_arch='amd64' ;; \
      arm64) tailscale_arch='arm64' ;; \
      arm) tailscale_arch='arm' ;; \
      386) tailscale_arch='386' ;; \
      *) echo "Unsupported Tailscale architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    tailscale_pkg="tailscale_${TAILSCALE_VERSION}_${tailscale_arch}.tgz" && \
    tailscale_url="https://pkgs.tailscale.com/stable/${tailscale_pkg}" && \
    tailscale_tmp="$(mktemp -d)" && \
    trap 'rm -rf "$tailscale_tmp"' EXIT && \
    curl -fsSL "$tailscale_url" -o "$tailscale_tmp/tailscale.tgz" && \
    curl -fsSL "${tailscale_url}.sha256" -o "$tailscale_tmp/tailscale.tgz.sha256" && \
    printf '%s  %s\n' "$(cat "$tailscale_tmp/tailscale.tgz.sha256")" "$tailscale_tmp/tailscale.tgz" | sha256sum -c - && \
    tar -xzf "$tailscale_tmp/tailscale.tgz" -C "$tailscale_tmp" && \
    install -m 0755 "$tailscale_tmp/tailscale_${TAILSCALE_VERSION}_${tailscale_arch}/tailscale" /usr/local/bin/tailscale && \
    install -m 0755 "$tailscale_tmp/tailscale_${TAILSCALE_VERSION}_${tailscale_arch}/tailscaled" /usr/local/bin/tailscaled && \
    rm -rf "$tailscale_tmp" && \
    trap - EXIT && \
    mkdir -p /etc/supervisor/conf.d /var/log/supervisor /var/log/piclaw /var/run/supervisor /etc/skel.agent && \
    apt-get autoremove -y && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -G sudo agent && \
    echo 'agent:agent' | chpasswd && \
    echo 'agent ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown -R agent:agent /var/log/piclaw

COPY entrypoint.sh /entrypoint.sh
COPY supervisor/supervisord.conf /etc/supervisor/supervisord.conf
COPY supervisor/conf.d/ /etc/supervisor/conf.d/
COPY supervisor/run-piclaw.sh /usr/local/bin/run-piclaw.sh
COPY supervisor/supervisord.workspace.conf /usr/local/share/piclaw/supervisor/supervisord.conf
COPY supervisor/conf.d/ /usr/local/share/piclaw/supervisor/conf.d/
COPY --from=installed-runtime /usr/local/lib/bun/bin /usr/local/lib/bun/bin
COPY --from=installed-runtime /usr/local/lib/bun/install/global /usr/local/lib/bun/install/global
COPY --from=installed-runtime /usr/local/bin/restic /usr/local/bin/restic
COPY --from=installed-runtime --chown=agent:agent /home/linuxbrew/.linuxbrew /home/linuxbrew/.linuxbrew
COPY --from=installed-runtime /etc/skel.agent/.bashrc /etc/skel.agent/.bashrc
COPY --from=installed-runtime /etc/skel.agent/.profile /etc/skel.agent/.profile
COPY --chown=agent:agent skel/ /usr/local/share/piclaw/workspace-skel/
COPY --chown=agent:agent runtime/skills/ /usr/local/share/piclaw/agent-skills/
RUN ln -sf /usr/local/lib/bun/bin/bun /usr/local/bin/bun && \
    if [ -f /usr/local/lib/bun/bin/bunx ]; then ln -sf /usr/local/lib/bun/bin/bunx /usr/local/bin/bunx; else ln -sf /usr/local/lib/bun/bin/bun /usr/local/bin/bunx; fi && \
    ln -sf /usr/local/lib/bun/bin/pi /usr/local/bin/pi && \
    ln -sf /usr/local/lib/bun/bin/piclaw /usr/local/bin/piclaw && \
    mkdir -p /home/agent/.pi/agent/skills /home/agent/.pi/agent/sessions \
             /home/agent/.pi/agent/extensions /home/agent/.pi/agent/prompts /home/agent/.pi/agent/themes && \
    chown -R agent:agent /home/agent /etc/skel.agent /usr/local/share/piclaw && \
    chmod +x /entrypoint.sh /usr/local/bin/run-piclaw.sh /usr/local/bin/restic

ENTRYPOINT ["/entrypoint.sh"]
