#!/usr/bin/env bash
# Build, sign (Developer ID + hardened runtime), notarise, staple and package the
# macOS app as a DMG, then upload it to the GitHub release for a desktop-v* tag.
#   ./scripts/release-mac.sh desktop-v0.1.5
# Needs on this Mac: Xcode, wails, the "Developer ID Application: webfaCeMEdia Inc" identity,
# and notarytool credentials: NOTARY_KEY (AuthKey .p8 path), NOTARY_KEY_ID, NOTARY_ISSUER,
# or a keychain profile NOTARY_PROFILE.
set -euo pipefail
TAG=${1:?tag like desktop-v0.1.5}; VERSION=${TAG#desktop-v}
cd "$(dirname "$0")/.."
IDENTITY=${IDENTITY:-"Developer ID Application: webfaCeMEdia Inc (2SKCVAFWZ6)"}
APP="build/bin/webfaCe Desk.app"; DMG="build/bin/webfaCe-Desk-macOS.dmg"; ZIP="build/bin/webfaCe-Desk-macOS.zip"

echo "==> build $VERSION"
wails build -platform darwin/universal -clean -ldflags "-X main.version=$VERSION"
echo "==> sign"
codesign --force --deep --options runtime --timestamp --entitlements build/darwin/entitlements.plist --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "==> notarise"
ditto -c -k --keepParent "$APP" "$ZIP"
if [ -n "${NOTARY_PROFILE:-}" ]; then
  xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
else
  xcrun notarytool submit "$ZIP" --key "${NOTARY_KEY:?}" --key-id "${NOTARY_KEY_ID:?}" --issuer "${NOTARY_ISSUER:?}" --wait
fi
xcrun stapler staple "$APP"
spctl -a -vv "$APP"
echo "==> dmg"
rm -f "$DMG"; STAGE=$(mktemp -d); cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "webfaCe Desk" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null; rm -rf "$STAGE"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"
if [ -n "${NOTARY_PROFILE:-}" ]; then xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
else xcrun notarytool submit "$DMG" --key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER" --wait; fi
xcrun stapler staple "$DMG"
# the zip must carry the stapled app too
ditto -c -k --keepParent "$APP" "$ZIP"
echo "==> upload to $TAG"
gh release upload "$TAG" "$DMG" "$ZIP" --clobber --repo webfacemedia-inc/harness
echo "done: $DMG"
