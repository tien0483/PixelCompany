#!/usr/bin/env bash
# Agent Stack activator. MUST be sourced, not executed:
#
#   cd <repo> && source backends/agent_stack/activate-stack.sh && claude
#
# Everything it changes is scoped to the current shell (PATH, venv, env vars).
# The switchboard daemon itself is no longer this script's job in a PixelCompany
# checkout — the runtime spawns it (src/stack/stack-process.ts) the same way it
# spawns Manager. Sourcing this is what a *shell* needs: `rtk` on PATH and the
# proxy env. Skill links are handled here and, headlessly, by
# scripts/link-stack-skills.mjs.

# --- guard: sourced, not executed -------------------------------------------
# ${BASH_SOURCE[0]} == $0 means it was run as a subprocess, where every export
# would be discarded on exit and the user would get a silent no-op.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	echo "activate-stack.sh must be sourced, not executed:" >&2
	echo "  source backends/agent_stack/activate-stack.sh" >&2
	exit 1
fi

STACK_SANDBOX="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_FLAGS_FILE="$STACK_SANDBOX/stack-flags.json"
STACK_LOG_DIR="$STACK_SANDBOX/logs"
STACK_UI_PORT="${STACK_UI_PORT:-8000}"
STACK_CCR_PORT="${STACK_CCR_PORT:-3456}"
STACK_HEADROOM_PORT="${STACK_HEADROOM_PORT:-8787}"
STACK_DEVTOOLS_PORT="${STACK_DEVTOOLS_PORT:-3001}"
mkdir -p "$STACK_LOG_DIR"

# Read a boolean flag out of stack-flags.json without needing jq.
stack_flag() {
	python3 - "$STACK_FLAGS_FILE" "$1" <<-'PY' 2>/dev/null
		import json, sys
		try:
		    with open(sys.argv[1]) as f:
		        print("1" if json.load(f).get(sys.argv[2]) else "")
		except Exception:
		    print("1")  # missing/corrupt flags file: default the tool ON
	PY
}

stack_port_up() {
	python3 - "$1" <<-'PY'
		import socket, sys
		s = socket.socket(); s.settimeout(0.25)
		sys.exit(0 if s.connect_ex(("127.0.0.1", int(sys.argv[1]))) == 0 else 1)
	PY
}

# stack_wait_port <port> <name> — block until a just-started daemon is listening.
# Uses bash's /dev/tcp rather than stack_port_up because this polls up to 50
# times and a python3 process per probe would cost more than the wait itself.
stack_wait_port() {
	local port="$1" name="$2" i=0
	while [ "$i" -lt 50 ]; do
		if (: <"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
			return 0
		fi
		sleep 0.1
		i=$((i + 1))
	done
	echo "   $name did not open port $port within 5s — see logs/$name.log" >&2
	return 1
}

# Track daemons by pidfile, not by matching process text. `pgrep -f uvicorn`
# would hit any unrelated uvicorn on the box (this machine runs one for another
# project) plus the grep's own shell; and an env-var marker like
# `pgrep -f STACK_DAEMON=ccr` matches only the shell that typed it, never the
# daemon — env assignments do not appear in a child's cmdline.
stack_daemon_running() {
	local pidfile="$STACK_LOG_DIR/$1.pid" pid
	[ -f "$pidfile" ] || return 1
	pid="$(cat "$pidfile" 2>/dev/null)"
	[ -n "$pid" ] || return 1
	kill -0 "$pid" 2>/dev/null
}

# stack_start_daemon <name> <required-binary> <command...>
# The required binary is named separately because some commands are launched
# through `env`, and checking $1 would only ever verify `env` exists.
stack_start_daemon() {
	local name="$1" require="$2"
	shift 2
	if stack_daemon_running "$name"; then
		echo "   $name already running (pid $(cat "$STACK_LOG_DIR/$name.pid"))"
		return 0
	fi
	if ! command -v "$require" >/dev/null 2>&1; then
		echo "   $name SKIPPED — '$require' not installed in sandbox" >&2
		return 1
	fi
	# `exec` replaces the subshell with the daemon, so $! is the daemon's own pid
	# and the pidfile stays accurate. Logs go to a file, not /dev/null: a daemon
	# that dies on startup must be diagnosable instead of silently absent.
	(cd "$STACK_SANDBOX" && exec nohup "$@" >>"$STACK_LOG_DIR/$name.log" 2>&1) &
	local pid=$!
	echo "$pid" >"$STACK_LOG_DIR/$name.pid"
	disown "$pid" 2>/dev/null || true
	echo "   $name started (pid $pid, log: logs/$name.log)"
}

# --- 1. scoped PATH ---------------------------------------------------------
case ":$PATH:" in
*":$STACK_SANDBOX/bin:"*) ;;
*) export PATH="$STACK_SANDBOX/bin:$STACK_SANDBOX/node_modules/.bin:$PATH" ;;
esac

# --- 2. sandbox python venv -------------------------------------------------
# `.venv`, matching backends/manager, so the runtime's venv-first interpreter
# probe finds this one the same way `resolveVenvPythonPath` finds Manager's.
if [ -f "$STACK_SANDBOX/.venv/bin/activate" ]; then
	# shellcheck disable=SC1091
	source "$STACK_SANDBOX/.venv/bin/activate"
else
	echo "venv missing — run: uv sync   (in $STACK_SANDBOX)" >&2
fi

# --- 3. skills into workspace ----------------------------------------------
# Symlinks, never `cp -r`: the sandbox stays the single source of truth, the link
# is obvious in `ls -l`, and `rm` fully reverts it. An existing entry is left
# alone rather than clobbered.
stack_link_skill() {
	local src="$1" name="$2" label="$3"
	[ -d "$src" ] || return 1
	for target_dir in ".claude/skills" ".agent/skills" ".cursor/skills"; do
		if [ -e "$target_dir/$name" ] || [ -L "$target_dir/$name" ]; then
			continue
		fi
		mkdir -p "$target_dir"
		ln -s "$src" "$target_dir/$name" 2>/dev/null || true
	done
	echo "$label: linked $name into .claude/skills, .agent/skills, .cursor/skills"
}

stack_link_file() {
	local src="$1" dest="$2" label="$3"
	[ -f "$src" ] || return 1
	if [ -e "$dest" ] || [ -L "$dest" ]; then
		return 0
	fi
	mkdir -p "$(dirname "$dest")"
	ln -s "$src" "$dest" 2>/dev/null || true
	echo "$label: linked $(basename "$dest")"
}

stack_has_ua_graph() {
	for dir in .understand-anything .ua; do
		[ -f "$dir/knowledge-graph.json" ] && return 0
	done
	return 1
}

stack_unlink_ua_skills() {
	local removed=0
	for target_dir in ".claude/skills" ".agent/skills" ".cursor/skills"; do
		[ -d "$target_dir" ] || continue
		for entry in "$target_dir"/understand "$target_dir"/understand-*; do
			[ -L "$entry" ] || continue
			rm -f "$entry" 2>/dev/null && removed=$((removed + 1))
		done
	done
	[ "$removed" -gt 0 ] && echo "Understand-Anything: removed $removed skill link(s) — no .ua graph in this project"
}

if [ -n "$(stack_flag ENABLE_CAVEMAN)" ]; then
	stack_link_skill "$STACK_SANDBOX/skills/caveman" caveman "Caveman"
fi

if [ -n "$(stack_flag ENABLE_PONYTAIL)" ]; then
	ponytail_root="$STACK_SANDBOX/src-ponytail"
	if [ -d "$ponytail_root/skills" ]; then
		ponytail_linked=0
		for ponytail_skill in "$ponytail_root/skills"/*/; do
			[ -d "$ponytail_skill" ] || continue
			ponytail_name="$(basename "$ponytail_skill")"
			stack_link_skill "$ponytail_root/skills/$ponytail_name" "$ponytail_name" "Ponytail" >/dev/null && ponytail_linked=$((ponytail_linked + 1))
		done
		echo "Ponytail: $ponytail_linked skill(s) available in .claude/skills, .agent/skills, .cursor/skills"
		stack_link_file "$ponytail_root/.cursor/rules/ponytail.mdc" ".cursor/rules/ponytail.mdc" "Ponytail"
		stack_link_file "$ponytail_root/.agents/rules/ponytail.md" ".agents/rules/ponytail.md" "Ponytail"
	else
		echo "   Ponytail SKIPPED — clone to $ponytail_root (git clone --depth 1 https://github.com/DietrichGebert/ponytail.git)" >&2
	fi
fi

if [ -n "$(stack_flag ENABLE_UA)" ]; then
	if stack_has_ua_graph; then
		# Understand-Anything ships no binary — it is a set of SKILL.md dirs, which is
		# Claude Code, Gemini CLI, and Cursor skill compatible, so they link in directly.
		ua_skills="$STACK_SANDBOX/src-understand-anything/understand-anything-plugin/skills"
		if [ -d "$ua_skills" ]; then
			ua_linked=0
			for ua_skill in "$ua_skills"/*/; do
				[ -d "$ua_skill" ] || continue
				ua_name="$(basename "$ua_skill")"
				stack_link_skill "$ua_skills/$ua_name" "$ua_name" "UA" >/dev/null && ua_linked=$((ua_linked + 1))
			done
			echo "Understand-Anything: $ua_linked skill(s) available in .claude/skills, .agent/skills, .cursor/skills"
			# The skill resolves its own plugin root at runtime and only probes
			# $CLAUDE_PLUGIN_ROOT, ~/.understand-anything-plugin and a few $HOME paths —
			# never .claude/skills — so without this link /understand exits early.
			if [ ! -e "$HOME/.understand-anything-plugin" ]; then
				echo "   warning: $HOME/.understand-anything-plugin missing — /understand cannot find its plugin root" >&2
			fi
			if [ ! -d "$ua_skills/../packages/core/dist" ]; then
				echo "   warning: UA core not built — run 'pnpm run build' in packages/core" >&2
			fi
		fi
	else
		stack_unlink_ua_skills
	fi
fi

# --- 4. point Claude Code at the local switchboard proxy -------------------
export ANTHROPIC_BASE_URL="http://127.0.0.1:$STACK_UI_PORT"
# Placeholder only. If the switchboard has to fall back to api.anthropic.com
# directly it swaps in STACK_UPSTREAM_ANTHROPIC_API_KEY server-side, so no live
# credential is exported into the session.
export ANTHROPIC_API_KEY="sk-dummy-key-for-sandbox"
# CLAUDE_CODE_SUBAGENT_MODEL is deliberately left alone. It used to default to
# `openrouter,deepseek/deepseek-chat`, which only resolves if CCR has an
# openrouter provider configured — the shipped config-router.json does not, so
# the default silently pointed every subagent at a provider that does not exist.
# Set it yourself if you have the routing to back it up.

# --- 5. daemons -------------------------------------------------------------
echo "Agent Stack Sandbox — starting daemons"
if stack_port_up "$STACK_UI_PORT" && ! stack_daemon_running switchboard; then
	echo "   switchboard SKIPPED — port $STACK_UI_PORT already taken by something else" >&2
else
	stack_start_daemon switchboard uvicorn uvicorn server:app \
		--host 127.0.0.1 --port "$STACK_UI_PORT"
fi

if [ -n "$(stack_flag ENABLE_CCR)" ]; then
	# CCR hardcodes os.homedir()/.claude-code-router for its config, auth files
	# and logs — there is no env override in the shipped bundle. Pointing HOME at
	# a sandbox-local dir is what keeps it from writing into the real ~ and
	# colliding with any global CCR install.
	# This CCR version generates its own config-router.json on first start and
	# ignores the older Providers/Router config.json schema entirely, so no
	# template is seeded here — writing one would just be inert clutter. Edit the
	# generated file to add your provider/credentials; the shipped default routes
	# to CodeWhisperer with empty credentials and will fail auth until you do.
	mkdir -p "$STACK_SANDBOX/ccr-home/.claude-code-router"
	stack_start_daemon ccr ccr env HOME="$STACK_SANDBOX/ccr-home" ccr start
	if [ ! -s "$STACK_SANDBOX/ccr-home/.claude-code-router/config-router.json" ]; then
		echo "   ccr: configure providers in ccr-home/.claude-code-router/config-router.json"
	fi
fi

if [ -n "$(stack_flag ENABLE_HEADROOM)" ]; then
	# Headroom talks to Anthropic directly by default, so with CCR enabled the
	# two would run side by side instead of chained. --anthropic-api-url is what
	# actually makes headroom -> ccr -> provider a chain.
	# Cache mode + protected tool results avoid lossy double-compression with
	# Caveman/Ponytail — see config/headroom-proxy.json.
	headroom_mode="cache"
	headroom_protect="Read,Grep,Glob,Bash,Write,Edit"
	headroom_config="$STACK_SANDBOX/config/headroom-proxy.json"
	if [ -f "$headroom_config" ]; then
		read -r headroom_mode headroom_protect <<EOF
$(python3 - "$headroom_config" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        cfg = json.load(f)
    mode = cfg.get("mode") or "cache"
    tools = cfg.get("protectToolResults") or ["Read", "Grep", "Glob", "Bash", "Write", "Edit"]
    print(mode, ",".join(tools))
except Exception:
    print("cache", "Read,Grep,Glob,Bash,Write,Edit")
PY
)
EOF
	fi
	headroom_args=(proxy --host 127.0.0.1 --port "$STACK_HEADROOM_PORT" --mode "$headroom_mode")
	if [ -n "$headroom_protect" ]; then
		headroom_args+=(--protect-tool-results "$headroom_protect")
	fi
	headroom_chain=direct
	if [ -n "$(stack_flag ENABLE_CCR)" ]; then
		headroom_args+=(--anthropic-api-url "http://127.0.0.1:$STACK_CCR_PORT")
		headroom_chain=ccr
	fi
	stack_start_daemon headroom headroom headroom "${headroom_args[@]}"
	# These args are frozen for the life of the process, but stack-flags.json is not:
	# turning ENABLE_CCR off later cannot un-chain a headroom already pointed at CCR.
	# server.py reads this to route around a headroom whose upstream no longer matches
	# the flags, instead of silently sending everything through a disabled CCR.
	mkdir -p "$STACK_SANDBOX/logs"
	printf '%s\n' "$headroom_chain" >"$STACK_SANDBOX/logs/headroom.chain"
fi

if [ -n "$(stack_flag ENABLE_DEVTOOLS)" ]; then
	# npm's claude-devtools ships prebuilt binaries with no linux asset, so its
	# postinstall fails on this box. The upstream repo does have a non-Electron
	# "standalone" server target, so prefer a local build of that when present.
	devtools_standalone="$STACK_SANDBOX/src-claude-devtools/dist-standalone/index.cjs"
	if [ -f "$devtools_standalone" ]; then
		# The standalone server takes its port from $PORT and defaults to 3456 —
		# which is CCR's port. Setting PORT explicitly avoids that collision.
		stack_start_daemon devtools node \
			env PORT="$STACK_DEVTOOLS_PORT" HOST=127.0.0.1 node "$devtools_standalone"
	else
		stack_start_daemon devtools claude-devtools claude-devtools --port "$STACK_DEVTOOLS_PORT"
	fi
fi

# --- 6. wait for the hops that are actually in the request path -------------
# ANTHROPIC_BASE_URL was exported back in section 4, so a `claude` launched in
# the same breath as this script would otherwise fire its first request at a
# port that is still binding: the switchboard answers 502, Claude Code retries
# with backoff, and a daemon that came up 300ms late reads as a hang.
stack_wait_port "$STACK_UI_PORT" switchboard
if [ -n "$(stack_flag ENABLE_CCR)" ] && stack_daemon_running ccr; then
	stack_wait_port "$STACK_CCR_PORT" ccr
fi
if [ -n "$(stack_flag ENABLE_HEADROOM)" ] && stack_daemon_running headroom; then
	stack_wait_port "$STACK_HEADROOM_PORT" headroom
fi

echo
echo "Sandbox active. Other terminal tabs and other AI tools are unaffected."
echo "  Switchboard UI : http://127.0.0.1:$STACK_UI_PORT/ui"
echo "  Health / JSON  : http://127.0.0.1:$STACK_UI_PORT/health"
# Only advertise the dashboard if it actually came up — printing the URL for a
# SKIPPED daemon sends you to a dead port.
stack_daemon_running devtools && echo "  DevTools       : http://127.0.0.1:$STACK_DEVTOOLS_PORT"
echo "  Stop daemons   : $STACK_SANDBOX/stop-stack.sh"
