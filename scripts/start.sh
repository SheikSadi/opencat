#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$DIR/data/listener.pid"
LOG_FILE="$DIR/data/listener.log"

mkdir -p "$DIR/data"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p "$PID" > /dev/null 2>&1; then
    echo "⚠️ Listener is already running with PID $PID."
    exit 0
  fi
fi

echo "🚀 Starting OpenCode Slack listener in background..."
nohup node --experimental-strip-types "$DIR/src/index.ts" > "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo $NEW_PID > "$PID_FILE"

sleep 3
if ps -p "$NEW_PID" > /dev/null 2>&1; then
  echo "✅ Listener started successfully (PID: $NEW_PID). Logs at: $LOG_FILE"
else
  echo "❌ Listener failed to start. Last log lines:"
  tail -n 20 "$LOG_FILE"
  exit 1
fi
