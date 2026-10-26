#!/bin/sh
# Build the app bundle with only tools that ship with macOS (osacompile, PlistBuddy,
# codesign). The app carries just its own code — no game pictures; those are read
# from the user's copy of the game the first time it runs.
#   sh mac/build.sh "<path>/Stardew Desk.app" <bundle id> [project folder]
set -e
cd "$(dirname "$0")/.."
APP="$1"; ID="$2"; PROJ="$3"
PLIST="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy

rm -rf "$APP"
mkdir -p "$(dirname "$APP")"
osacompile -l JavaScript -s -o "$APP" mac/host.js

# Add the key, or overwrite it if osacompile already wrote one.
put() { $PB -c "Add :$1 $2 \"$3\"" "$PLIST" 2>/dev/null || $PB -c "Set :$1 \"$3\"" "$PLIST"; }
put CFBundleIdentifier string "$ID"
put CFBundleName string "Stardew Desk"
put CFBundleShortVersionString string "1.0"
put LSUIElement bool true
put LSMinimumSystemVersion string 14.0
put NSDesktopFolderUsageDescription string "信箱提醒：只比对桌面上的文件名，看看有没有新文件，不读取文件内容。"
put NSDownloadsFolderUsageDescription string "信箱提醒：只比对下载文件夹里的文件名，看看有没有新文件，不读取文件内容。"
# where the project lives, so the menu's "update" item can reinstall from it
[ -n "$PROJ" ] && put SDVProjectDir string "$PROJ"

R="$APP/Contents/Resources"
# our own icon (mac/AppIcon.icns) instead of the script-applet scroll
cp mac/AppIcon.icns "$R/applet.icns"
put CFBundleIconFile string applet
# osacompile also ships an asset-catalog icon called "applet" and points CFBundleIconName
# at it; macOS prefers the catalog over CFBundleIconFile, which showed the generic
# script-applet icon even though applet.icns was ours. Drop the key so the .icns wins.
$PB -c "Delete :CFBundleIconName" "$PLIST" 2>/dev/null || true
mkdir -p "$R/scene"
cp scene/*.html scene/*.js "$R/scene/"
cp -R scene/lib "$R/scene/lib"
cp mac/musicx.js "$R/musicx.js"
xattr -cr "$APP" 2>/dev/null || true     # Finder/quarantine detritus breaks the seal
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
touch "$APP"   # let Finder and the Dock pick up the new icon
