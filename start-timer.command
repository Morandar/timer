#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT/.alza-timer.pid"
LOG_FILE="$ROOT/.alza-timer.log"
PORT="${PORT:-3000}"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    open "http://localhost:${PORT}/control"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

nohup node "$ROOT/server.js" > "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"
sleep 1

if ! kill -0 "$PID" 2>/dev/null; then
  echo "Server se nepodařilo spustit. Zkontroluj $LOG_FILE"
  exit 1
fi

open "http://localhost:${PORT}/control"
echo "Alza Presenter Timer běží. Ovládání: http://localhost:${PORT}/control"
