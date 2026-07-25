#!/bin/bash
# Applivery SOAR — installed-app inventory reporter (macOS)
#
# Reports every app found in /Applications, /System/Applications, and
# ~/Applications to the App Lists compliance feature, using each app's real
# CFBundleIdentifier read straight from its Info.plist. That's the exact
# same identifier Apple's App Store search and Applivery's own MDM API
# report back (see Identifier/identifier on the per-device applications
# endpoint) — so a report from this script matches App List entries built
# via search precisely, no guessing or name-matching involved.
#
# Also reports each app's version (CFBundleShortVersionString, falling back
# to CFBundleVersion) — same precedence Applivery's own MDM API uses for
# Apple apps. This feeds the Vulnerability Service integration's per-app CVE
# matching in addition to App Lists; a device only shows up in vulnerability
# results for a given app once a version is known for it, from whichever
# source (MDM or this script) reported one most recently.
#
# This is a stopgap for anyone who hasn't installed the (future) Applivery
# SOAR agent yet — it's a plain shell script POSTing to one HTTP
# endpoint, nothing installed or "managed" on this Mac beyond a scheduled
# job. Safe to inspect end-to-end before running: it only performs local,
# read-only enumeration plus a single outbound HTTPS POST.
#
# INSTALL
#   1. Copy this file somewhere stable, e.g. /usr/local/applivery/report-installed-apps.sh
#   2. Fill in the three CONFIG values below (pre-filled automatically if
#      you downloaded this from Settings > Device Data Webhook > App
#      Inventory Reporting in the dashboard).
#   3. Make it executable: chmod +x report-installed-apps.sh
#   4. Schedule it — either a user LaunchAgent or a system LaunchDaemon.
#      Simplest for testing, a per-user cron-style LaunchAgent:
#
#        cat > ~/Library/LaunchAgents/com.applivery.report-installed-apps.plist <<'PLIST'
#        <?xml version="1.0" encoding="UTF-8"?>
#        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
#        <plist version="1.0"><dict>
#          <key>Label</key><string>com.applivery.report-installed-apps</string>
#          <key>ProgramArguments</key>
#          <array><string>/bin/bash</string><string>/usr/local/applivery/report-installed-apps.sh</string></array>
#          <key>StartInterval</key><integer>21600</integer> <!-- every 6 hours -->
#          <key>RunAtLoad</key><true/>
#        </dict></plist>
#        PLIST
#        launchctl load ~/Library/LaunchAgents/com.applivery.report-installed-apps.plist
#
#      For a fleet-wide, no-login-required schedule, deploy the same plist
#      as a LaunchDaemon (/Library/LaunchDaemons/, owned by root:wheel,
#      permissions 644) via your existing macOS Policy/script deployment —
#      exactly the same mechanism this app already uses to run Applivery
#      Policy scripts (see the Script/OMA-URI Library in Workflows).

set -uo pipefail

# ── CONFIG — filled in automatically if downloaded from Settings ──
WEBHOOK_URL="__WEBHOOK_URL__"
WORKSPACE_SLUG="__WORKSPACE_SLUG__"
REPORT_SECRET="__REPORT_SECRET__"

SERIAL=$(ioreg -l 2>/dev/null | awk -F'"' '/IOPlatformSerialNumber/{print $4; exit}')
if [ -z "$SERIAL" ]; then
  echo "report-installed-apps.sh: could not read serial number — aborting." >&2
  exit 1
fi

TMP_JSON=$(mktemp)
BODY_FILE=$(mktemp)
trap 'rm -f "$TMP_JSON" "$BODY_FILE"' EXIT
echo -n "[" > "$TMP_JSON"

first=true
count=0
for app_dir in /Applications/*.app /Applications/*/*.app /System/Applications/*.app "$HOME/Applications"/*.app; do
  [ -d "$app_dir" ] || continue
  info_plist="$app_dir/Contents/Info.plist"
  [ -f "$info_plist" ] || continue
  bundle_id=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$info_plist" 2>/dev/null || true)
  [ -z "$bundle_id" ] && continue
  name=$(basename "$app_dir" .app)
  # CFBundleShortVersionString is the human "1.2.3"-style marketing version
  # (what Applivery's own MDM API reports as ShortVersion); CFBundleVersion
  # is the build-number fallback for the rare app that omits the former —
  # same precedence _fetch_and_store_installed_apps uses server-side.
  version=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$info_plist" 2>/dev/null || true)
  if [ -z "$version" ]; then
    version=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$info_plist" 2>/dev/null || true)
  fi
  # Dependency-free JSON string escaping — backslash and double-quote only,
  # which covers every realistic app name/bundle id/version string.
  esc_name=$(printf '%s' "$name" | sed 's/\\/\\\\/g; s/"/\\"/g')
  esc_id=$(printf '%s' "$bundle_id" | sed 's/\\/\\\\/g; s/"/\\"/g')
  if [ "$first" = true ]; then first=false; else echo -n "," >> "$TMP_JSON"; fi
  if [ -n "$version" ]; then
    esc_version=$(printf '%s' "$version" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"identifier":"%s","name":"%s","version":"%s"}' "$esc_id" "$esc_name" "$esc_version" >> "$TMP_JSON"
  else
    printf '{"identifier":"%s","name":"%s"}' "$esc_id" "$esc_name" >> "$TMP_JSON"
  fi
  count=$((count + 1))
done
echo -n "]" >> "$TMP_JSON"

REPORTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  printf '{"platform":"macos","serialNumber":"%s","apps":' "$SERIAL"
  cat "$TMP_JSON"
  printf ',"agentVersion":"report-installed-apps.sh/1.1","reportedAt":"%s"}' "$REPORTED_AT"
} > "$BODY_FILE"

HTTP_STATUS=$(curl -sS -o /tmp/applivery-app-report-response.json -w "%{http_code}" \
  -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Workspace-Slug: $WORKSPACE_SLUG" \
  -H "X-Device-Report-Secret: $REPORT_SECRET" \
  --data-binary @"$BODY_FILE")

if [ "$HTTP_STATUS" -ge 200 ] && [ "$HTTP_STATUS" -lt 300 ]; then
  echo "report-installed-apps.sh: reported $count app(s) for serial $SERIAL (HTTP $HTTP_STATUS)."
else
  echo "report-installed-apps.sh: report failed (HTTP $HTTP_STATUS) — see /tmp/applivery-app-report-response.json" >&2
  exit 1
fi
