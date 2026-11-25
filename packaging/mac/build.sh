#!/bin/bash
# Builds the ICAIRE Echo desktop app for Mac (Apple silicon): dist/ICAIRE-Echo-<version>-mac.dmg.
# The app is a Tauri window (desktop/) with everything inside it: its own Node.js, the app's packages and the
# transcriber (whisper-cli, built from source with Apple's Metal). Nothing is installed on the Mac; models download
# inside the app when they are first needed; your things live in ~/Library/Application Support/ICAIRE Echo.
#
#   bash packaging/mac/build.sh     (Apple silicon Mac with Xcode's command line tools, cmake, Rust, and npm ci done)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$REPO/dist"
STAGE="$REPO/desktop/stage"
WORK="$DIST/work"
NODE_VERSION="${NODE_VERSION:-24.10.0}"
WHISPER_TAG="${WHISPER_TAG:-v1.9.5}"
[ "$(uname -m)" = arm64 ] || { echo "Build on an Apple silicon Mac (the voice engine has no Intel build)." >&2; exit 1; }
VERSION="$(node -p "require('$REPO/package.json').version")"
echo "== ICAIRE Echo $VERSION for Mac"
mkdir -p "$DIST"
rm -rf "$WORK" "$STAGE"
mkdir -p "$WORK" "$STAGE/app/bin"

# 1. Node.js: the official build, checked against nodejs.org's checksums
NODE_PKG="node-v$NODE_VERSION-darwin-arm64"
curl -fsSL -o "$WORK/$NODE_PKG.tar.gz" "https://nodejs.org/dist/v$NODE_VERSION/$NODE_PKG.tar.gz"
curl -fsSL -o "$WORK/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
(cd "$WORK" && /usr/bin/grep " $NODE_PKG.tar.gz\$" SHASUMS256.txt | shasum -a 256 -c -)
tar -xzf "$WORK/$NODE_PKG.tar.gz" -C "$WORK"
cp "$WORK/$NODE_PKG/bin/node" "$STAGE/node"
NODE_BIN="$WORK/$NODE_PKG/bin"

# 2. the app's own files (what git tracks, without tests, packaging, the desktop shell and notes)
git -C "$REPO" ls-files | /usr/bin/grep -vE '^(test|packaging|desktop|docs|\.github)/|^(TODO|PRODUCT|DESIGN)\.md$' > "$WORK/files.txt"
rsync -a --files-from="$WORK/files.txt" "$REPO/" "$STAGE/app/"

# 3. the packages, installed with the bundled Node so native parts match it; other platforms' engines removed
(cd "$STAGE/app" && PATH="$NODE_BIN:$PATH" npm ci --omit=dev --no-audit --no-fund --loglevel=error)
find "$STAGE/app/node_modules/onnxruntime-node/bin" -mindepth 2 -maxdepth 2 -type d ! -name darwin -exec rm -rf {} +
find "$STAGE/app/node_modules" -maxdepth 1 -type d -name 'sherpa-onnx-*' ! -name 'sherpa-onnx-node' ! -name 'sherpa-onnx-darwin-arm64' -exec rm -rf {} +
rm -rf "$STAGE/app/node_modules/.bin"

# 4. the transcriber: whisper.cpp built as one program (no libraries beside it), Metal inside
git clone -q --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp "$WORK/whisper.cpp"
cmake -S "$WORK/whisper.cpp" -B "$WORK/whisper.cpp/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.5 >/dev/null
cmake --build "$WORK/whisper.cpp/build" --config Release --target whisper-cli -j "$(sysctl -n hw.ncpu)" >/dev/null 2>&1
cp "$WORK/whisper.cpp/build/bin/whisper-cli" "$STAGE/app/bin/whisper-cli"
if otool -L "$STAGE/app/bin/whisper-cli" | tail -n +2 | /usr/bin/grep -vE '/usr/lib/|/System/Library/'; then
  echo "whisper-cli needs libraries outside macOS; it would not run on another Mac." >&2
  exit 1
fi
chmod +x "$STAGE/node" "$STAGE/app/bin/whisper-cli"

# 5. the desktop app around it (Tauri), with the version from package.json
(cd "$REPO/desktop" && npx tauri build --bundles app --config "{\"version\":\"$VERSION\"}")
BUNDLE="$REPO/desktop/target/release/bundle"

# 6. the disk image: the app and a shortcut to Applications (plain hdiutil: Tauri's own step mounts the image and
#    can fail when macOS is still looking inside it)
DMG="$DIST/ICAIRE-Echo-$VERSION-mac.dmg"
rm -rf "$WORK/dmg" "$DMG"
mkdir -p "$WORK/dmg"
cp -R "$BUNDLE/macos/ICAIRE Echo.app" "$WORK/dmg/"
ln -s /Applications "$WORK/dmg/Applications"
hdiutil create -quiet -volname "ICAIRE Echo" -srcfolder "$WORK/dmg" -format UDZO -fs HFS+ "$DMG"
rm -rf "$WORK"
echo "== $(du -sh "$BUNDLE/macos/ICAIRE Echo.app" | cut -f1) app, $(du -h "$DIST/ICAIRE-Echo-$VERSION-mac.dmg" | cut -f1) disk image: $DIST/ICAIRE-Echo-$VERSION-mac.dmg"
