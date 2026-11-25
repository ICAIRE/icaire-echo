#!/bin/bash
# ICAIRE Echo for Mac. Starts the app in the background (it has no window of its own) and opens it in the
# browser; when it is already running, only opens it. Your recordings, voice-overs, models and the bot's sign-in
# are kept in ~/Library/Application Support/ICAIRE Echo, so a new version of the app never touches them.
# "Quit ICAIRE Echo" under More in the app ends it. What it does is written to ~/Library/Logs/ICAIRE Echo/echo.log.
CONTENTS="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$CONTENTS/Resources/node"
APP="$CONTENTS/Resources/app"
DATA="$HOME/Library/Application Support/ICAIRE Echo"
LOGDIR="$HOME/Library/Logs/ICAIRE Echo"
PORT="${PORT:-4777}"
mkdir -p "$DATA" "$LOGDIR"
LOG="$LOGDIR/echo.log"
echo "--- $(date) $(/usr/bin/defaults read "$CONTENTS/Info" CFBundleShortVersionString 2>/dev/null)" >> "$LOG"

# already running: just show it
if /usr/bin/curl -fs -o /dev/null --max-time 2 "http://localhost:$PORT/api/state"; then
  /usr/bin/open "http://localhost:$PORT"
  exit 0
fi

# once: bring over what the earlier Meet Recorder kept in ~/Meet Recorder (moved, on the same disk)
OLD="$HOME/Meet Recorder"
for d in recordings voiceovers models bot-profile; do
  if [ -d "$OLD/$d" ] && [ ! -L "$OLD/$d" ] && [ ! -e "$DATA/$d" ]; then
    /bin/mv "$OLD/$d" "$DATA/$d" && echo "moved $d from $OLD" >> "$LOG"
  fi
done

export ECHO_DATA="$DATA" ECHO_PACKAGED=1 MRB_BACKGROUND=1 PORT
cd "$APP" || exit 1
nohup "$NODE" server.js >> "$LOG" 2>&1 &
disown
exit 0
