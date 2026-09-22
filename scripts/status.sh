#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$DIR/data/listener.pid"
LOG_FILE="$DIR/data/listener.log"

echo "=== OpenCode Slack Listener Status ==="
if systemctl --user is-active --quiet opencode-slack; then
  echo "🟢 Systemd Service (opencode-slack): ACTIVE & RUNNING"
elif [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p "$PID" > /dev/null 2>&1; then
    echo "🟢 Listener (Standalone): RUNNING (PID: $PID)"
  else
    echo "🔴 Listener: NOT RUNNING"
  fi
else
  echo "🔴 Listener: NOT RUNNING"
fi

if pgrep -f "opencode serve --port 4096" > /dev/null 2>&1; then
  echo "🟢 OpenCode Server (port 4096): RUNNING"
else
  echo "🔴 OpenCode Server (port 4096): NOT RUNNING"
fi

if [ -f "$LOG_FILE" ]; then
  echo ""
  echo "--- Recent Logs (last 10 lines) ---"
  tail -n 10 "$LOG_FILE"
fi
