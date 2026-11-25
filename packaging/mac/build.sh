#!/bin/bash
# Builds "ICAIRE Echo.app" and "ICAIRE-Echo-<version>-mac.dmg" (Apple silicon) in dist/.
# Everything the app needs is inside it: its own Node.js, the app's packages, and the transcriber program
# (whisper-cli, built from source with Apple's Metal). Nothing is installed on the Mac; models are downloaded
# by the app when they are first needed, and your things live in ~/Library/Application Support/ICAIRE Echo.
#
#   bash packaging/mac/build.sh           (on an Apple silicon Mac with Xcode's command line tools and cmake)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$REPO/dist"
WORK="$DIST/work"
NODE_VERSION="${NODE_VERSION:-24.10.0}"
WHISPER_TAG="${WHISPER_TAG:-v1.9.5}"
[ "$(uname -m)" = arm64 ] || { echo "Build on an Apple silicon Mac (the voice engine has no Intel build)." >&2; exit 1; }
VERSION="$(node -p "require('$REPO/package.json').version")"
APP="$DIST/ICAIRE Echo.app"
RES="$APP/Contents/Resources"

echo "== ICAIRE Echo $VERSION for Mac"
mkdir -p "$DIST"
rm -rf "$WORK" "$APP"
mkdir -p "$WORK" "$APP/Contents/MacOS" "$RES/app/bin"

# 1. Node.js: the official build, checked against nodejs.org's checksums
NODE_PKG="node-v$NODE_VERSION-darwin-arm64"
curl -fsSL -o "$WORK/$NODE_PKG.tar.gz" "https://nodejs.org/dist/v$NODE_VERSION/$NODE_PKG.tar.gz"
curl -fsSL -o "$WORK/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
(cd "$WORK" && /usr/bin/grep " $NODE_PKG.tar.gz\$" SHASUMS256.txt | shasum -a 256 -c -)
tar -xzf "$WORK/$NODE_PKG.tar.gz" -C "$WORK"
cp "$WORK/$NODE_PKG/bin/node" "$RES/node"
NODE_BIN="$WORK/$NODE_PKG/bin"

# 2. the app's own files (what git tracks, without tests, packaging and the old installers)
git -C "$REPO" ls-files | /usr/bin/grep -vE '^(test|packaging|installer|docs|\.github)/|^Start |^TODO\.md$|^PRODUCT\.md$|^DESIGN\.md$' > "$WORK/files.txt"
rsync -a --files-from="$WORK/files.txt" "$REPO/" "$RES/app/"

# 3. the packages, installed with the bundled Node so native parts match it; other platforms' engines removed
(cd "$RES/app" && PATH="$NODE_BIN:$PATH" npm ci --omit=dev --no-audit --no-fund --loglevel=error)
ORT="$RES/app/node_modules/onnxruntime-node/bin"
find "$ORT" -mindepth 2 -maxdepth 2 -type d ! -name darwin -exec rm -rf {} +
find "$RES/app/node_modules" -maxdepth 1 -type d -name 'sherpa-onnx-*' ! -name 'sherpa-onnx-node' ! -name 'sherpa-onnx-darwin-arm64' -exec rm -rf {} +

# 4. the transcriber: whisper.cpp built as one program (no libraries beside it), Metal inside
git clone -q --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp "$WORK/whisper.cpp"
cmake -S "$WORK/whisper.cpp" -B "$WORK/whisper.cpp/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.5 >/dev/null
cmake --build "$WORK/whisper.cpp/build" --config Release --target whisper-cli -j "$(sysctl -n hw.ncpu)" >/dev/null
cp "$WORK/whisper.cpp/build/bin/whisper-cli" "$RES/app/bin/whisper-cli"
if otool -L "$RES/app/bin/whisper-cli" | tail -n +2 | /usr/bin/grep -vE '/usr/lib/|/System/Library/'; then
  echo "whisper-cli needs libraries outside macOS; it would not run on another Mac." >&2
  exit 1
fi
echo "$WHISPER_TAG" > "$RES/app/bin/whisper-version.txt"

# 5. the app around it: launcher, Info.plist, icon
cp "$REPO/packaging/mac/launcher.sh" "$APP/Contents/MacOS/ICAIRE Echo"
chmod +x "$APP/Contents/MacOS/ICAIRE Echo" "$RES/node" "$RES/app/bin/whisper-cli"
cp "$REPO/packaging/mac/AppIcon.icns" "$RES/AppIcon.icns"
sed "s/__VERSION__/$VERSION/g" "$REPO/packaging/mac/Info.plist" > "$APP/Contents/Info.plist"
# sign it for this Mac's own checks (not an Apple Developer ID: the first launch still asks)
codesign --force --deep --sign - "$APP" >/dev/null 2>&1

# 6. the disk image: the app and a shortcut to Applications
DMG="$DIST/ICAIRE-Echo-$VERSION-mac.dmg"
rm -rf "$WORK/dmg" "$DMG"
mkdir -p "$WORK/dmg"
cp -R "$APP" "$WORK/dmg/"
ln -s /Applications "$WORK/dmg/Applications"
hdiutil create -quiet -volname "ICAIRE Echo" -srcfolder "$WORK/dmg" -format UDZO -fs HFS+ "$DMG"
rm -rf "$WORK"
echo "== $(du -sh "$APP" | cut -f1) app, $(du -h "$DMG" | cut -f1) disk image: $DMG"
