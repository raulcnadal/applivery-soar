#!/bin/bash
# Applivery SOAR — security-attestation attribute reporter (macOS)
#
# Reads local hardware/OS security posture — FileVault, firewall, XProtect
# presence, Secure Token, screen lock, MDM enrollment, OS build, and disk
# usage — and POSTs it to the generic self-reported-attributes webhook.
# Those attributes then feed the dashboard's Compliance Policy "Self-Reported
# Attribute" condition type directly (see MACOS_ATTR_ALIASES in the backend
# for the raw-name → canonical-name mapping, shared with the Windows
# equivalent so a policy author writes ONE condition — e.g.
# "diskEncryptionEnabled" — that works across both fleets).
#
# WHY A LOCAL SCRIPT INSTEAD OF A LIVE MDM QUERY: same reasoning as
# report-security-attributes.ps1 on Windows — Applivery has no documented,
# confirmed passthrough for reading this level of security detail (FileVault
# status, Secure Token, local firewall state) back from its MDM channel for
# every enrollment type. This reads the same signal straight off the device,
# on a schedule, without depending on unconfirmed MDM plumbing.
#
# WHAT THIS DOESN'T COVER: XProtect (macOS's built-in malware scanner) has no
# user-facing on/off toggle — it's part of the OS and always active unless
# System Integrity Protection itself has been disabled, so "antivirusEnabled"
# here is really "XProtect.bundle is present" (true on any unmodified macOS
# install), not a live scan-engine health check. Screen lock and Secure Token
# are per-user settings (macOS stores them in the console user's own defaults
# domain / user record), so this script resolves the current console user and
# reads/queries as that user — a machine with no one logged in reports these
# as unknown (false) rather than guessing.
#
# Same stopgap model as report-installed-apps.sh: a plain shell script,
# nothing installed beyond a scheduled job, safe to read end-to-end before
# running — local read-only enumeration plus one outbound HTTPS POST.
#
# INSTALL
#   1. Copy this file somewhere stable, e.g. /usr/local/applivery/report-security-attributes.sh
#   2. Fill in the three CONFIG values below (pre-filled automatically if
#      you downloaded this from Settings > Applivery SOAR Agent > Security
#      Attestation Reporting in the dashboard).
#   3. Make it executable: chmod +x report-security-attributes.sh
#   4. Schedule it as a LaunchDaemon (root context — needed to read the
#      console user's Secure Token / screen lock state via `sudo -u`, and to
#      run reliably with no one logged in):
#
#        cat > /Library/LaunchDaemons/com.applivery.report-security-attributes.plist <<'PLIST'
#        <?xml version="1.0" encoding="UTF-8"?>
#        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
#        <plist version="1.0"><dict>
#          <key>Label</key><string>com.applivery.report-security-attributes</string>
#          <key>ProgramArguments</key>
#          <array><string>/bin/bash</string><string>/usr/local/applivery/report-security-attributes.sh</string></array>
#          <key>StartInterval</key><integer>21600</integer> <!-- every 6 hours -->
#          <key>RunAtLoad</key><true/>
#        </dict></plist>
#        PLIST
#        chown root:wheel /Library/LaunchDaemons/com.applivery.report-security-attributes.plist
#        chmod 644 /Library/LaunchDaemons/com.applivery.report-security-attributes.plist
#        launchctl load /Library/LaunchDaemons/com.applivery.report-security-attributes.plist
#
#      Deploy the same plist fleet-wide via your existing macOS Policy/script
#      deployment (Script/OMA-URI Library in Workflows).

set -uo pipefail

# ── CONFIG — filled in automatically if downloaded from Settings ──
WEBHOOK_URL="__WEBHOOK_URL__"
WORKSPACE_SLUG="__WORKSPACE_SLUG__"
REPORT_SECRET="__REPORT_SECRET__"

SERIAL=$(ioreg -l 2>/dev/null | awk -F'"' '/IOPlatformSerialNumber/{print $4; exit}')
if [ -z "$SERIAL" ]; then
  echo "report-security-attributes.sh: could not read serial number — aborting." >&2
  exit 1
fi

# The user actually sitting at the console, if any — Secure Token and screen
# lock are per-user settings, not machine-wide ones. Falls back to "" (no one
# logged in / running over SSH), in which case those two attributes are
# reported as unknown rather than guessed.
CONSOLE_USER=$(stat -f%Su /dev/console 2>/dev/null || true)
if [ "$CONSOLE_USER" = "root" ] || [ -z "$CONSOLE_USER" ]; then
  CONSOLE_USER=""
fi
run_as_console_user() {
  if [ -n "$CONSOLE_USER" ]; then
    sudo -u "$CONSOLE_USER" "$@" 2>/dev/null
  else
    return 1
  fi
}

# ── FileVault ──
FILEVAULT_ENABLED=false
if fdesetup status 2>/dev/null | grep -q "FileVault is On"; then
  FILEVAULT_ENABLED=true
fi

# ── Firewall ──
# /Library/Preferences/com.apple.alf globalstate: 0 = off, 1 = on for
# specific services, 2 = on for essential services (both count as "on").
FIREWALL_STATE=$(defaults read /Library/Preferences/com.apple.alf globalstate 2>/dev/null || echo "0")
FIREWALL_ENABLED=false
if [ "$FIREWALL_STATE" != "0" ]; then
  FIREWALL_ENABLED=true
fi

# ── XProtect ── (see header comment — presence, not a live scan-engine check)
XPROTECT_ENABLED=false
if [ -d "/Library/Apple/System/Library/CoreServices/XProtect.bundle" ] || [ -d "/System/Library/CoreServices/XProtect.bundle" ]; then
  XPROTECT_ENABLED=true
fi

# ── Secure Token (console user only) ──
SECURE_TOKEN_ENABLED=false
if [ -n "$CONSOLE_USER" ]; then
  if sysadminctl -secureTokenStatus "$CONSOLE_USER" 2>&1 | grep -qi "ENABLED"; then
    SECURE_TOKEN_ENABLED=true
  fi
fi

# ── Screen lock (console user only) ──
SCREEN_LOCK_ENABLED=false
if [ -n "$CONSOLE_USER" ]; then
  ASK_PW=$(run_as_console_user defaults read com.apple.screensaver askForPassword || echo "0")
  if [ "$ASK_PW" = "1" ]; then
    SCREEN_LOCK_ENABLED=true
  fi
fi

# ── MDM enrollment ──
MDM_ENROLLED=false
if profiles status -type enrollment 2>/dev/null | grep -q "MDM enrollment: Yes"; then
  MDM_ENROLLED=true
fi

# ── OS build / disk usage / uptime ──
OS_BUILD=$(sw_vers -buildVersion 2>/dev/null || echo "")
DISK_LINE=$(df -k / 2>/dev/null | tail -1)
DISK_FREE_GB=$(printf '%s' "$DISK_LINE" | awk '{printf "%.1f", $4/1024/1024}')
DISK_USED_PCT=$(printf '%s' "$DISK_LINE" | awk '{gsub("%","",$5); print $5}')
BOOT_EPOCH=$(sysctl -n kern.boottime 2>/dev/null | awk -F'[= ,]+' '{print $4}')
UPTIME_DAYS=0
if [ -n "$BOOT_EPOCH" ]; then
  NOW_EPOCH=$(date +%s)
  UPTIME_DAYS=$(( (NOW_EPOCH - BOOT_EPOCH) / 86400 ))
fi

REPORTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

{
  printf '{"platform":"macos","serialNumber":"%s","attributes":{' "$SERIAL"
  printf '"FileVaultEnabled":%s,' "$FILEVAULT_ENABLED"
  printf '"FirewallEnabled":%s,' "$FIREWALL_ENABLED"
  printf '"XProtectEnabled":%s,' "$XPROTECT_ENABLED"
  printf '"SecureTokenEnabled":%s,' "$SECURE_TOKEN_ENABLED"
  printf '"ScreenLockEnabled":%s,' "$SCREEN_LOCK_ENABLED"
  printf '"MdmEnrolled":%s,' "$MDM_ENROLLED"
  printf '"OsBuildNumber":"%s",' "$OS_BUILD"
  printf '"DiskFreeGb":%s,' "${DISK_FREE_GB:-0}"
  printf '"DiskUsedPercent":%s,' "${DISK_USED_PCT:-0}"
  printf '"UptimeDays":%s' "$UPTIME_DAYS"
  printf '},"agentVersion":"report-security-attributes.sh/1.0","reportedAt":"%s"}' "$REPORTED_AT"
} > "$BODY_FILE"

HTTP_STATUS=$(curl -sS -o /tmp/applivery-security-report-response.json -w "%{http_code}" \
  -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Workspace-Slug: $WORKSPACE_SLUG" \
  -H "X-Device-Report-Secret: $REPORT_SECRET" \
  --data-binary @"$BODY_FILE")

if [ "$HTTP_STATUS" -ge 200 ] && [ "$HTTP_STATUS" -lt 300 ]; then
  echo "report-security-attributes.sh: reported security attributes for serial $SERIAL (HTTP $HTTP_STATUS)."
else
  echo "report-security-attributes.sh: report failed (HTTP $HTTP_STATUS) — see /tmp/applivery-security-report-response.json" >&2
  exit 1
fi
