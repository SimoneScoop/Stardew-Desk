#!/bin/sh
# Make a zip to share: the app (code only — no game pictures, no music, nothing of
# yours) plus a short how-to. Lands on your Desktop as Stardew-Desk-Mac.zip.
set -e
cd "$(dirname "$0")/.."
OUT="$HOME/Desktop/Stardew-Desk-Mac.zip"
TMP="$(mktemp -d)/Stardew Desk"
mkdir -p "$TMP"
sh mac/build.sh "$TMP/Stardew Desk.app" local.stardewdesk.app
cp mac/使用说明.txt "$TMP/使用说明.txt"
rm -f "$OUT"
ditto -c -k --sequesterRsrc --keepParent "$TMP" "$OUT"
rm -rf "$(dirname "$TMP")"
echo "分享版已放到桌面：$OUT"
du -h "$OUT" | cut -f1
