#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

PORT="${KAZIMO_PORT:-8080}"
URL="http://localhost:$PORT"
PROFILE="${KAZIMO_BROWSER_PROFILE:-$HOME/.kazimo/browser-profile}"

if [ -z "${KAZIMO_BROWSER:-}" ]; then
  echo "KAZIMO_BROWSER must point to a chromium-based browser binary" >&2
  exit 1
fi

NODE_ENV=production bun packages/kazimod/src/index.ts &
DAEMON_PID=$!
trap 'kill "$DAEMON_PID" 2>/dev/null' EXIT INT TERM

until curl -sf "$URL/api/config" >/dev/null 2>&1; do sleep 0.5; done

mkdir -p "$PROFILE"

"$KAZIMO_BROWSER" \
  --kiosk \
  --noerrdialogs \
  --no-first-run \
  --disable-session-crashed-bubble \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --user-data-dir="$PROFILE" \
  "$URL"
