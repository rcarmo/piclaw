#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/workspace/.local/bin"
CONFIG_DIR="/workspace/.config/gh"

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"

ARCH="$(uname -m)"
case "$ARCH" in
x86_64) GH_ARCH="amd64" ;;
aarch64 | arm64) GH_ARCH="arm64" ;;
*)
	echo "Unsupported architecture: $ARCH" >&2
	exit 1
	;;
esac

GH_VERSION="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | jq -r .tag_name | sed 's/^v//')"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$TMP_DIR"
curl -fLO "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz"
tar -xzf "gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz"

cp "gh_${GH_VERSION}_linux_${GH_ARCH}/bin/gh" "${INSTALL_DIR}/gh"
chmod +x "${INSTALL_DIR}/gh"

cat <<'EOF'

Installed gh to /workspace/.local/bin/gh

Make sure /workspace/.env.sh contains:

export PATH="/workspace/.local/bin:$PATH"
export GH_CONFIG_DIR=/workspace/.config/gh
mkdir -p /workspace/.config/gh

Then run:
  source /workspace/.env.sh
  gh --version
  gh auth login

EOF
