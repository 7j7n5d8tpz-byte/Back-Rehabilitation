#!/bin/bash
# Install (or remove) the background agent that deploys back-rehab-app to Netlify
# whenever its files change.
#
#   ./install-watcher.sh            install and start
#   ./install-watcher.sh uninstall  stop and remove
#   ./install-watcher.sh status     is it loaded, and what did it last do
#
# Safe to re-run: it replaces any existing agent.

set -euo pipefail

LABEL="dk.brendstrup.backrehab.deploy"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HERE/.." && pwd)/back-rehab-app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/back-rehab-deploy.log"
DOMAIN="gui/$(id -u)"

action="${1:-install}"

case "$action" in

  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Watcher removed. Deploy manually with: python3 deploy.py"
    exit 0
    ;;

  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "Watcher: loaded"
    else
      echo "Watcher: NOT loaded"
    fi
    if [ -f "$HERE/.netlify-state.json" ]; then
      echo "Last deploy: $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["at"])' "$HERE/.netlify-state.json" 2>/dev/null || echo unknown)"
    fi
    echo "--- last 20 log lines ---"
    tail -n 20 "$LOG" 2>/dev/null || echo "(no log yet)"
    exit 0
    ;;

  install) ;;
  *) echo "Unknown option: $action"; exit 1 ;;
esac

PYTHON="$(command -v python3 || true)"
if [ -z "$PYTHON" ]; then
  echo "python3 not found. Install Xcode Command Line Tools: xcode-select --install"
  exit 1
fi

if [ ! -d "$APP_DIR" ]; then
  echo "Cannot find $APP_DIR"
  exit 1
fi

# The agent has no interactive terminal, so the token and the site must already be set up.
if [ ! -f "$HERE/.netlify-site.json" ]; then
  echo "Set the site up first — the watcher can't answer prompts:"
  echo "    python3 deploy.py --set-token"
  echo "    python3 deploy.py"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$HERE/deploy.py</string>
    <string>--watch-mode</string>
  </array>

  <key>WatchPaths</key>
  <array>
    <string>$APP_DIR</string>
    <string>$APP_DIR/index.html</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$HERE</string>

  <key>RunAtLoad</key>
  <false/>

  <!-- Netlify allows 3 deploys per minute. 30s between runs keeps us under that
       even if something starts rewriting the file in a loop. -->
  <key>ThrottleInterval</key>
  <integer>30</integer>

  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"

echo "Watcher installed."
echo "  watching : $APP_DIR"
echo "  log      : $LOG"
echo
echo "Test it:  touch \"$APP_DIR/index.html\" && sleep 12 && tail -n 5 \"$LOG\""
