#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_DIR="$ROOT_DIR/.dev"
mkdir -p "$DEV_DIR"

npm run build:contracts >/dev/null

npm run dev --workspace @decision-inbox/api >"$DEV_DIR/api.log" 2>&1 &
API_PID=$!
VITE_DEMO_MODE="${VITE_DEMO_MODE:-0}" npm run dev --workspace @decision-inbox/desktop >"$DEV_DIR/desktop.log" 2>&1 &
DESKTOP_PID=$!
printf '%s\n%s\n' "$API_PID" "$DESKTOP_PID" >"$DEV_DIR/pids"

printf 'BFF:      http://127.0.0.1:8787\n'
printf 'Renderer: http://127.0.0.1:5173\n'
printf 'Logs:     %s\n' "$DEV_DIR"
printf 'Stop:     ./stop-dev.sh\n'
