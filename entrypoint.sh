#!/usr/bin/env bash
# entrypoint.sh – Docker container entrypoint for the Pibox image.
#
# Initialises /home/agent from skel, optionally remaps the runtime agent user to
# PUID/PGID, syncs supervisor configs from workspace defaults, and execs
# supervisord as PID 1.
# Idempotent: uses a marker file to skip re-init on container restart.
set -euo pipefail

MARKER_FILE="/home/agent/.container_initialized"
HOME_DIR="/home/agent"
SKEL_DIR="/etc/skel.agent"
WORKSPACE_SKEL_DIR="/usr/local/share/piclaw/workspace-skel"
AGENT_SKILLS_SEED_DIR="/usr/local/share/piclaw/agent-skills"
DEFAULT_SUPERVISOR_CONF="/etc/supervisor/supervisord.conf"
SUPERVISOR_CONF_ENV_SET="${SUPERVISOR_CONF+x}"
SUPERVISOR_CONF="${SUPERVISOR_CONF:-$DEFAULT_SUPERVISOR_CONF}"
WORKSPACE_SUPERVISOR_DIR="/workspace/.piclaw/supervisor"
SUPERVISOR_DEFAULTS_DIR="/usr/local/share/piclaw/supervisor"

log() {
    echo "[entrypoint] $*"
}

validate_numeric_id() {
    local label="$1"
    local value="$2"

    if [[ ! "$value" =~ ^[0-9]+$ ]]; then
        echo "Invalid $label: $value (must be a numeric id)" >&2
        exit 1
    fi

    if [ "$value" -lt 1 ]; then
        echo "Invalid $label: $value (must be >= 1)" >&2
        exit 1
    fi
}

chown_if_exists() {
    local path="$1"
    if [ -e "$path" ]; then
        chown -R agent:agent "$path" 2>/dev/null || true
    fi
}

record_runtime_ids() {
    if [ -d "$HOME_DIR" ]; then
        echo "$(id -u agent):$(id -g agent)" > "$MARKER_FILE"
        chown agent:agent "$MARKER_FILE" 2>/dev/null || true
    fi
}

apply_puid_pgid_remap() {
    local requested_uid="${PUID:-}"
    local requested_gid="${PGID:-}"

    if [ -z "$requested_uid" ] && [ -z "$requested_gid" ]; then
        return
    fi

    local current_uid current_gid target_uid target_gid
    current_uid="$(id -u agent)"
    current_gid="$(id -g agent)"
    target_uid="${requested_uid:-$current_uid}"
    target_gid="${requested_gid:-$current_gid}"

    validate_numeric_id "PUID" "$target_uid"
    validate_numeric_id "PGID" "$target_gid"

    if [ "$target_uid" = "$current_uid" ] && [ "$target_gid" = "$current_gid" ]; then
        return
    fi

    log "Applying runtime uid/gid remap for agent: ${current_uid}:${current_gid} -> ${target_uid}:${target_gid}"

    if [ "$target_gid" != "$current_gid" ]; then
        local existing_group
        existing_group="$(getent group "$target_gid" | cut -d: -f1 || true)"
        if [ -n "$existing_group" ] && [ "$existing_group" != "agent" ]; then
            echo "Cannot apply PGID=$target_gid: gid already belongs to group '$existing_group'" >&2
            exit 1
        fi
        groupmod -o -g "$target_gid" agent
    fi

    if [ "$target_uid" != "$current_uid" ]; then
        local existing_user
        existing_user="$(getent passwd "$target_uid" | cut -d: -f1 || true)"
        if [ -n "$existing_user" ] && [ "$existing_user" != "agent" ]; then
            echo "Cannot apply PUID=$target_uid: uid already belongs to user '$existing_user'" >&2
            exit 1
        fi
        usermod -o -u "$target_uid" agent
    fi

    # Reconcile ownership only for agent-managed paths. Avoid recursively chowning
    # the entire /workspace bind mount, which may intentionally contain host-owned
    # project files outside piclaw-managed state.
    chown_if_exists "$HOME_DIR"
    chown_if_exists /config
    chown_if_exists /home/linuxbrew/.linuxbrew
    chown_if_exists /var/log/piclaw
    chown_if_exists /workspace/.piclaw
    chown_if_exists /workspace/.pi
    chown_if_exists /workspace/AGENTS.md

    record_runtime_ids
}

ensure_config_link() {
    local item="$1"
    local target="/config/$item"
    local link="$HOME_DIR/$item"

    mkdir -p /config

    if [ "$item" = ".pi" ]; then
        mkdir -p "$target/agent"
    else
        if [ ! -e "$target" ] && [ -e "$link" ] && [ ! -L "$link" ]; then
            cp -a "$link" "$target" 2>/dev/null || true
        fi
        if [ ! -e "$target" ]; then
            touch "$target"
        fi
    fi

    if [ -L "$link" ]; then
        local resolved
        resolved="$(readlink -f "$link" 2>/dev/null || true)"
        if [ "$resolved" = "$target" ]; then
            return
        fi
        rm -f "$link"
    fi

    if [ -e "$link" ] && [ ! -L "$link" ]; then
        if [ "$item" = ".pi" ]; then
            cp -a "$link/." "$target/" 2>/dev/null || true
            rm -rf "$link"
        else
            rm -f "$link"
        fi
    fi

    ln -sfn "$target" "$link"
}

apply_puid_pgid_remap

if [ ! -f "$MARKER_FILE" ] || [ ! -f "$HOME_DIR/.bashrc" ]; then
    log "Initializing home directory..."
    if [ -d "$SKEL_DIR" ] && [ "$(ls -A "$SKEL_DIR" 2>/dev/null)" ]; then
        cp -a "$SKEL_DIR/." "$HOME_DIR/"
    fi

    if [ ! -f "$HOME_DIR/.bashrc" ]; then
        cat > "$HOME_DIR/.bashrc" <<'BASHRC'
# piclaw-workspace-env-hook
[ -f /workspace/.env.sh ] && . /workspace/.env.sh
case $- in *i*) ;; *) return;; esac
HISTCONTROL=ignoreboth
shopt -s histappend
HISTSIZE=1000
HISTFILESIZE=2000
shopt -s checkwinsize
PS1='\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    alias grep='grep --color=auto'
fi
alias ll='ls -alF'
alias la='ls -A'
[ -x /home/linuxbrew/.linuxbrew/bin/brew ] && eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)"
export BUN_INSTALL="/usr/local/lib/bun"
export PATH="$BUN_INSTALL/bin:$PATH"
BASHRC
    fi

    if [ ! -f "$HOME_DIR/.profile" ]; then
        cat > "$HOME_DIR/.profile" <<'PROFILE'
[ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
[ -d "$HOME/bin" ] && PATH="$HOME/bin:$PATH"
PROFILE
    fi

    mkdir -p "$HOME_DIR/.pi/agent/skills" \
             "$HOME_DIR/.pi/agent/sessions" \
             "$HOME_DIR/.pi/agent/extensions" \
             "$HOME_DIR/.pi/agent/prompts" \
             "$HOME_DIR/.pi/agent/themes"

    chown -R agent:agent "$HOME_DIR"
    record_runtime_ids
fi

if [ -f "$HOME_DIR/.bashrc" ] && ! grep -Fq '# piclaw-workspace-env-hook' "$HOME_DIR/.bashrc" 2>/dev/null; then
    if grep -Fq 'case $- in *i*) ;; *) return;; esac' "$HOME_DIR/.bashrc" 2>/dev/null; then
        sed -i '/^case \$- in .*return;; esac$/i\
# piclaw-workspace-env-hook\
[ -f /workspace/.env.sh ] && . /workspace/.env.sh' "$HOME_DIR/.bashrc"
    else
        cat >> "$HOME_DIR/.bashrc" <<'BASHRC_ENV_HOOK'
# piclaw-workspace-env-hook
[ -f /workspace/.env.sh ] && . /workspace/.env.sh
BASHRC_ENV_HOOK
    fi
fi

# Always reconcile persistent config links, even on restart with existing marker.
ensure_config_link .pi
ensure_config_link .gitconfig
chown -R agent:agent /config/.pi 2>/dev/null || true
chown agent:agent /config/.gitconfig 2>/dev/null || true

if [ -d "$AGENT_SKILLS_SEED_DIR" ]; then
    mkdir -p /config/.pi/agent/skills
    if [ -z "$(find /config/.pi/agent/skills -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
        cp -a "$AGENT_SKILLS_SEED_DIR/." /config/.pi/agent/skills/
        chown -R agent:agent /config/.pi 2>/dev/null || true
    fi
fi

if [ -d "/workspace" ] && [ ! -f "/workspace/AGENTS.md" ]; then
    if [ -f "$WORKSPACE_SKEL_DIR/AGENTS.md" ]; then
        cp "$WORKSPACE_SKEL_DIR/AGENTS.md" /workspace/AGENTS.md
        chown agent:agent /workspace/AGENTS.md
    fi
fi

if [ -d "/workspace" ] && [ ! -d "/workspace/.pi/skills" ]; then
    if [ -d "$WORKSPACE_SKEL_DIR/.pi/skills" ]; then
        mkdir -p /workspace/.pi
        cp -a "$WORKSPACE_SKEL_DIR/.pi/skills" /workspace/.pi/skills
        chown -R agent:agent /workspace/.pi
    fi
fi

if [ -d "/workspace" ] && [ ! -d "/workspace/notes" ]; then
    if [ -d "$WORKSPACE_SKEL_DIR/notes" ]; then
        cp -a "$WORKSPACE_SKEL_DIR/notes" /workspace/notes
        chown -R agent:agent /workspace/notes
    fi
fi

if [ -d "/workspace" ] && [ ! -f "/workspace/notes/index.md" ]; then
    if [ -f "$WORKSPACE_SKEL_DIR/notes/index.md" ]; then
        mkdir -p /workspace/notes
        cp "$WORKSPACE_SKEL_DIR/notes/index.md" /workspace/notes/index.md
        chown agent:agent /workspace/notes/index.md
    fi
fi

if [ -d "/workspace" ] && [ ! -f "/workspace/notes/memory/README.md" ]; then
    if [ -f "$WORKSPACE_SKEL_DIR/notes/memory/README.md" ]; then
        mkdir -p /workspace/notes/memory
        cp "$WORKSPACE_SKEL_DIR/notes/memory/README.md" /workspace/notes/memory/README.md
        chown agent:agent /workspace/notes/memory/README.md
    fi
fi

if [ -d "/workspace" ]; then
    mkdir -p "$WORKSPACE_SUPERVISOR_DIR/conf.d"
    chown agent:agent /workspace/.piclaw "$WORKSPACE_SUPERVISOR_DIR" "$WORKSPACE_SUPERVISOR_DIR/conf.d" 2>/dev/null || true

    if [ -f "$SUPERVISOR_DEFAULTS_DIR/supervisord.conf" ] && [ ! -f "$WORKSPACE_SUPERVISOR_DIR/supervisord.conf" ]; then
        cp "$SUPERVISOR_DEFAULTS_DIR/supervisord.conf" "$WORKSPACE_SUPERVISOR_DIR/supervisord.conf"
        chown agent:agent "$WORKSPACE_SUPERVISOR_DIR/supervisord.conf"
    fi

    if [ -d "$SUPERVISOR_DEFAULTS_DIR/conf.d" ]; then
        while IFS= read -r -d '' conf; do
            conf_name="$(basename "$conf")"
            conf_target="$WORKSPACE_SUPERVISOR_DIR/conf.d/$conf_name"
            if [ ! -f "$conf_target" ]; then
                cp "$conf" "$conf_target"
                chown agent:agent "$conf_target"
            fi
        done < <(find "$SUPERVISOR_DEFAULTS_DIR/conf.d" -maxdepth 1 -type f -name '*.conf' -print0)
    fi

    if [ "$SUPERVISOR_CONF" = "$DEFAULT_SUPERVISOR_CONF" ] && [ -f "$WORKSPACE_SUPERVISOR_DIR/supervisord.conf" ]; then
        SUPERVISOR_CONF="$WORKSPACE_SUPERVISOR_DIR/supervisord.conf"
    fi
fi

mkdir -p /var/log/piclaw /var/run/supervisor
chown -R agent:agent /var/log/piclaw
chmod 755 /usr/local/bin/run-piclaw.sh 2>/dev/null || true

validate_supervisor_config() {
    local conf="$1"
    if [ ! -f "$conf" ]; then
        return 1
    fi
    /usr/bin/supervisord -n -c "$conf" -t >/tmp/piclaw-supervisord-validate.log 2>&1
}

resolve_supervisor_conf() {
    local requested="$1"

    if validate_supervisor_config "$requested"; then
        printf '%s\n' "$requested"
        return 0
    fi

    if [ "$SUPERVISOR_CONF_ENV_SET" = "x" ]; then
        echo "Supervisor config validation failed for explicit SUPERVISOR_CONF=$requested" >&2
        cat /tmp/piclaw-supervisord-validate.log >&2 2>/dev/null || true
        return 1
    fi

    if [ "$requested" != "$DEFAULT_SUPERVISOR_CONF" ] && validate_supervisor_config "$DEFAULT_SUPERVISOR_CONF"; then
        log "Supervisor config $requested failed validation; falling back to $DEFAULT_SUPERVISOR_CONF"
        cat /tmp/piclaw-supervisord-validate.log >&2 2>/dev/null || true
        printf '%s\n' "$DEFAULT_SUPERVISOR_CONF"
        return 0
    fi

    echo "Supervisor config validation failed for $requested" >&2
    cat /tmp/piclaw-supervisord-validate.log >&2 2>/dev/null || true
    return 1
}

log "=== PiClaw - Pi Coding Agent Sandbox ==="

if [ ! -x /usr/bin/supervisord ]; then
    echo "Missing supervisord binary at /usr/bin/supervisord" >&2
    exit 1
fi

SUPERVISOR_CONF="$(resolve_supervisor_conf "$SUPERVISOR_CONF")" || exit 1
log "Starting supervisord with config: $SUPERVISOR_CONF"

exec /usr/bin/supervisord -n -c "$SUPERVISOR_CONF"
