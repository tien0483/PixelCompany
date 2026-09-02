#!/bin/sh
set -eu

REPO_URL="${REPO_URL:-https://github.com/tien0483/PixelCompany.git}"
PIXTIEL_HOME="${PIXTIEL_HOME:-$HOME/pixtiel}"

# 1. Platform checks
if [ "$(uname -s)" != "Linux" ]; then
	echo "Error: PIXTiel installs on Ubuntu Linux or WSL only. For Windows, see scripts/windows/README.md." >&2
	exit 1
fi

if [ -f /proc/version ]; then
	if ! grep -qi "microsoft" /proc/version; then
		echo "Notice: Non-WSL Linux detected. PIXTiel is supported on Linux and WSL."
	fi
fi

case "$PIXTIEL_HOME" in
	/mnt/*)
		echo "Error: Target directory ($PIXTIEL_HOME) is on a /mnt/ mount (9p Windows filesystem)." >&2
		echo "Clone to the native Linux filesystem (e.g. ~/pixtiel); node_modules on /mnt hangs forever." >&2
		exit 1
		;;
esac

# 2. Git prerequisite check
if ! command -v git >/dev/null 2>&1; then
	echo "install git first (sudo apt install git)" >&2
	exit 1
fi

# 3. Ensure Node >= 22 (via nvm if needed)
has_node22=0
if command -v node >/dev/null 2>&1; then
	node_ver="$(node -v 2>/dev/null || true)"
	node_major="$(echo "$node_ver" | sed 's/^v//' | cut -d. -f1)"
	if [ -n "$node_major" ] && [ "$node_major" -ge 22 ] 2>/dev/null; then
		has_node22=1
		echo "Node.js >= 22 already present ($node_ver)"
	fi
fi

if [ "$has_node22" -eq 0 ]; then
	export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
	if [ ! -s "$NVM_DIR/nvm.sh" ]; then
		echo "Installing nvm..."
		curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
	else
		echo "nvm already present ($NVM_DIR)"
	fi
	# shellcheck source=/dev/null
	[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
	echo "Installing Node.js 22 via nvm..."
	nvm install 22
	nvm use 22
	echo "Node.js $(node -v) installed"
fi

# 4. Ensure uv
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if command -v uv >/dev/null 2>&1; then
	echo "uv already present ($(uv --version))"
else
	echo "Installing uv..."
	curl -LsSf https://astral.sh/uv/install.sh | sh
	export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
	if command -v uv >/dev/null 2>&1; then
		echo "uv installed ($(uv --version))"
	else
		echo "Warning: uv installed but not found in PATH" >&2
	fi
fi

# 5. Ensure pnpm (via corepack if needed)
if command -v pnpm >/dev/null 2>&1; then
	echo "pnpm already present ($(pnpm -v))"
else
	echo "Setting up pnpm via corepack..."
	corepack enable
	corepack prepare pnpm@11 --activate
	echo "pnpm $(pnpm -v) activated"
fi

# 6. Clone or update repository
if [ -d "$PIXTIEL_HOME/.git" ]; then
	echo "Updating existing repository at $PIXTIEL_HOME..."
	git -C "$PIXTIEL_HOME" pull --ff-only
elif [ -d "$PIXTIEL_HOME" ]; then
	echo "Error: Target directory $PIXTIEL_HOME exists but is not a git repository." >&2
	exit 1
else
	echo "Cloning repository to $PIXTIEL_HOME..."
	git clone "$REPO_URL" "$PIXTIEL_HOME"
fi

# 7. Hand off to install.mjs with TTY restored
cd "$PIXTIEL_HOME"
if ( : < /dev/tty ) 2>/dev/null; then
	exec node scripts/install/install.mjs "$@" < /dev/tty
else
	if [ "$#" -eq 0 ]; then
		exec node scripts/install/install.mjs --features kanban,agent-stack,plan-editor
	else
		exec node scripts/install/install.mjs "$@"
	fi
fi
