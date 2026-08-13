#!/usr/bin/env bash
# Stop only the daemons this sandbox started, identified by pidfile.
#
# Deliberately not `pkill -f uvicorn`/`pkill -f node`: that would kill unrelated
# processes on the machine. Nor a `pgrep -f STACK_DAEMON=<name>` marker — env
# assignments never reach a child's cmdline, so that pattern matches only the
# shell that typed it.
set -u

STACK_SANDBOX="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_LOG_DIR="$STACK_SANDBOX/logs"

for name in switchboard ccr headroom devtools; do
	pidfile="$STACK_LOG_DIR/$name.pid"
	if [ ! -f "$pidfile" ]; then
		echo "$name not running (no pidfile)"
		continue
	fi
	pid="$(cat "$pidfile" 2>/dev/null || true)"
	if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
		echo "$name not running (stale pidfile cleared)"
		# Cleared with the pidfile: a chain marker outliving its daemon would tell
		# server.py to route around a hop that is not even running.
		rm -f "$pidfile" "$STACK_LOG_DIR/$name.chain"
		continue
	fi
	# Kill the process group as well: `ccr start` and uvicorn both fork children
	# that would otherwise keep the port bound after the parent dies.
	kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
	sleep 1
	if kill -0 "$pid" 2>/dev/null; then
		kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
		echo "stopped $name (pid $pid, forced)"
	else
		echo "stopped $name (pid $pid)"
	fi
	rm -f "$pidfile" "$STACK_LOG_DIR/$name.chain"
done
