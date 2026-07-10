#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT/.alza-timer.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Server neběží."
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
fi

rm -f "$PID_FILE"
echo "Alza Presenter Timer zastaven."
