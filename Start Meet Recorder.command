#!/bin/bash
# Double-click to start Meet Recorder on a Mac. The first time, it installs what it needs.
# If macOS says it cannot be opened: right-click the file, choose Open, then Open again.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1

if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Node.js is needed. Installing it with Homebrew..."
    brew install node
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js is needed. The download page is opening: install it, then open Start Meet Recorder again."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

# Install the app's parts the first time, and again whenever an update changed them.
install() {
  cmp -s package-lock.json node_modules/.mrb-installed && return 0
  echo "Installing the app (one time, about a minute)..."
  if npm ci --no-fund --no-audit --loglevel=error; then
    cp package-lock.json node_modules/.mrb-installed
  else
    echo "The install stopped. Check the internet connection and open Start Meet Recorder again."
    read -n 1 -s -r -p "Press any key to close."
    exit 1
  fi
}

# The app ends with code 75 after it has updated itself: start it again (no new browser tab, the page reloads).
args=()
while true; do
  install
  node setup.js
  echo
  node server.js "${args[@]}"
  [ $? -eq 75 ] || break
  echo "Updated. Starting again..."
  args=(--no-open)
done
