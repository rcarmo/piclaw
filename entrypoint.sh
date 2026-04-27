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
SUPERVISORD_BIN="${SUPERVISORD_BIN:-/usr/bin/supervisord}"
SUPERVISOR_VALIDATE_SCRIPT="${SUPERVISOR_VALIDATE_SCRIPT:-/usr/local/lib/bun/install/global/node_modules/piclaw/runtime/scripts/validate-supervisor-config.ts}"
WORKSPACE_SUPERVISOR_DIR="/workspace/.piclaw/supervisor"
SUPERVISOR_DEFAULTS_DIR="/usr/local/share/piclaw/supervisor"
WORKSPACE_SUPERVISOR_MANIFEST="$WORKSPACE_SUPERVISOR_DIR/.defaults-manifest"
SUPERVISOR_PID=""
SUPERVISOR_SHUTDOWN_REQUESTED=0

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

file_sha256() {
    local path="$1"
    sha256sum "$path" | awk '{print $1}'
}

load_supervisor_manifest() {
    local manifest_path="$1"
    local -n manifest_ref="$2"

    if [ ! -f "$manifest_path" ]; then
        return
    fi

    while IFS=$'\t' read -r rel hash; do
        [ -n "$rel" ] || continue
        [ -n "$hash" ] || continue
        manifest_ref["$rel"]="$hash"
    done < "$manifest_path"
}

sync_workspace_supervisor_defaults() {
    local defaults_dir="$1"
    local workspace_dir="$2"
    local manifest_path="$3"

    [ -d "$defaults_dir" ] || return 0

    mkdir -p "$workspace_dir/conf.d"
    chown agent:agent /workspace/.piclaw "$workspace_dir" "$workspace_dir/conf.d" 2>/dev/null || true

    local manifest_exists=0
    if [ -f "$manifest_path" ]; then
        manifest_exists=1
    fi

    declare -A previous_hashes=()
    load_supervisor_manifest "$manifest_path" previous_hashes

    while IFS= read -r -d '' source; do
        local rel="${source#$defaults_dir/}"
        local target="$workspace_dir/$rel"
        local source_hash
        source_hash="$(file_sha256 "$source")"
        mkdir -p "$(dirname "$target")"

        if [ ! -f "$target" ]; then
            cp "$source" "$target"
            chown agent:agent "$target" 2>/dev/null || true
            continue
        fi

        local target_hash
        target_hash="$(file_sha256 "$target")"
        local previous_hash="${previous_hashes[$rel]:-}"

        if [ -n "$previous_hash" ]; then
            if [ "$target_hash" = "$previous_hash" ] && [ "$source_hash" != "$target_hash" ]; then
                cp "$source" "$target"
                chown agent:agent "$target" 2>/dev/null || true
            fi
            continue
        fi

        if [ "$manifest_exists" -eq 0 ] && [ "$source_hash" != "$target_hash" ]; then
            local backup="$target.preseed.$(date +%s%N).bak"
            cp "$target" "$backup"
            chown agent:agent "$backup" 2>/dev/null || true
            cp "$source" "$target"
            chown agent:agent "$target" 2>/dev/null || true
            log "Reseeded workspace supervisor default $rel (previous copy backed up to $(basename "$backup"))"
        fi
    done < <(find "$defaults_dir" -maxdepth 2 -type f \( -name 'supervisord.conf' -o -path "$defaults_dir/conf.d/*.conf" \) -print0)

    : > "$manifest_path"
    while IFS= read -r -d '' source; do
        local rel="${source#$defaults_dir/}"
        printf '%s\t%s\n' "$rel" "$(file_sha256 "$source")" >> "$manifest_path"
    done < <(find "$defaults_dir" -maxdepth 2 -type f \( -name 'supervisord.conf' -o -path "$defaults_dir/conf.d/*.conf" \) -print0)
    chown agent:agent "$manifest_path" 2>/dev/null || true
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

validate_supervisor_config() {
    local conf="$1"
    if [ ! -f "$conf" ]; then
        return 1
    fi
    if [ ! -f "$SUPERVISOR_VALIDATE_SCRIPT" ]; then
        echo "Missing supervisor validator script at $SUPERVISOR_VALIDATE_SCRIPT" >&2
        return 1
    fi
    bun "$SUPERVISOR_VALIDATE_SCRIPT" "$conf" >/tmp/piclaw-supervisord-validate.log 2>&1
}

forward_supervisor_signal() {
    local signal="$1"

    if [ -n "$SUPERVISOR_PID" ] && kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
        kill -"$signal" "$SUPERVISOR_PID" 2>/dev/null || true
    else
        SUPERVISOR_SHUTDOWN_REQUESTED=1
    fi
}

run_supervisord_managed() {
    local conf="$1"
    local exit_code=0

    SUPERVISOR_PID=""
    SUPERVISOR_SHUTDOWN_REQUESTED=0
    trap 'forward_supervisor_signal TERM' TERM
    trap 'forward_supervisor_signal INT' INT
    trap 'forward_supervisor_signal HUP' HUP
    trap 'forward_supervisor_signal QUIT' QUIT

    "$SUPERVISORD_BIN" -n -c "$conf" &
    SUPERVISOR_PID=$!

    if [ "$SUPERVISOR_SHUTDOWN_REQUESTED" -eq 1 ]; then
        forward_supervisor_signal TERM
    fi

    wait "$SUPERVISOR_PID" || exit_code=$?
    SUPERVISOR_PID=""
    trap - TERM INT HUP QUIT
    return "$exit_code"
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

if [ -d "/workspace" ] && [ ! -d "/workspace/logs" ]; then
    mkdir -p /workspace/logs
    chown agent:agent /workspace/logs 2>/dev/null || true
fi

if [ -d "/workspace" ]; then
    sync_workspace_supervisor_defaults \
        "$SUPERVISOR_DEFAULTS_DIR" \
        "$WORKSPACE_SUPERVISOR_DIR" \
        "$WORKSPACE_SUPERVISOR_MANIFEST"

    if [ "$SUPERVISOR_CONF" = "$DEFAULT_SUPERVISOR_CONF" ] && [ -f "$WORKSPACE_SUPERVISOR_DIR/supervisord.conf" ]; then
        SUPERVISOR_CONF="$WORKSPACE_SUPERVISOR_DIR/supervisord.conf"
    fi
fi

mkdir -p /var/log/piclaw /var/run/supervisor
chown -R agent:agent /var/log/piclaw
chmod 755 /usr/local/bin/run-piclaw.sh 2>/dev/null || true

log "=== PiClaw - Pi Coding Agent Sandbox ==="

if [ ! -x "$SUPERVISORD_BIN" ]; then
    echo "Missing supervisord binary at $SUPERVISORD_BIN" >&2
    exit 1
fi

SUPERVISOR_CONF="$(resolve_supervisor_conf "$SUPERVISOR_CONF")" || exit 1
log "Starting supervisord with config: $SUPERVISOR_CONF"

run_supervisord_managed "$SUPERVISOR_CONF"
exit $?
