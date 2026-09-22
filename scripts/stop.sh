#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$DIR/data/listener.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p "$PID" > /dev/null 2>&1; then
    echo "🛑 Stopping listener (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    sleep 2
    if ps -p "$PID" > /dev/null 2>&1; then
      kill -9 "$PID" 2>/dev/null || true
    fi
  else
    echo "ℹ️ Process $PID not found."
  fi
  rm -f "$PID_FILE"
fi

# Also check for any orphaned opencode serve instances if needed
OPENCODE_PIDS=$(pgrep -f "opencode serve --port 4096" || true)
if [ -n "$OPENCODE_PIDS" ]; then
  echo "🛑 Stopping background OpenCode server (PIDs: $OPENCODE_PIDS)..."
  kill $OPENCODE_PIDS 2>/dev/null || true
fi

echo "✅ OpenCode Slack listener stopped."
