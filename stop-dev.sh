#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.dev/pids"

if [[ ! -f "$PID_FILE" ]]; then
  printf 'No development processes recorded.\n'
  exit 0
fi

while IFS= read -r pid; do
  if [[ "$pid" =~ ^[0-9]+$ ]]; then kill "$pid" 2>/dev/null || true; fi
done <"$PID_FILE"
rm -f "$PID_FILE"
printf 'Development processes stopped.\n'
