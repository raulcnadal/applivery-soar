# Applivery SOAR — installed-app inventory reporter (Windows)
#
# Prefers `winget list` when winget.exe is available: its PackageIdentifier
# (e.g. "Mozilla.Firefox") is exactly what the App Lists feature's Winget
# search source returns, so a report from this script matches those App
# List entries precisely. Falls back to the registry Uninstall keys
# (DisplayName only — there's no single stable cross-vendor identifier
# there) if winget isn't installed on this device.
#
# Also reports each app's Version column (winget) / DisplayVersion value
# (registry fallback). This is what makes Windows app-version coverage for
# the Vulnerability Service integration reliable: Applivery's own MDM API
# has an undocumented, unconfirmed schema for per-device Windows installed
# apps, so this self-report script is the dependable source of Windows
# app-version data today — a device only shows up in vulnerability results
# for a given app once a version is known for it, from whichever source
# (MDM or this script) reported one most recently.
#
# This is a stopgap for anyone who hasn't installed the (future) Applivery
# SOAR agent yet — it's a plain PowerShell script POSTing to one
# HTTP endpoint, nothing installed or "managed" on this PC beyond a
# scheduled task. Safe to inspect end-to-end before running: it only
# performs local, read-only enumeration plus a single outbound HTTPS POST.
#
# INSTALL
#   1. Copy this file somewhere stable, e.g. C:\ProgramData\Applivery\report-installed-apps.ps1
#   2. Fill in the three CONFIG values below (pre-filled automatically if
#      you downloaded this from Settings > Applivery SOAR Agent > App
#      Inventory Reporting in the dashboard).
#   3. Schedule it with Task Scheduler, running as SYSTEM so it works
#      whether or not a user is logged in:
#
#        schtasks /create /tn "Applivery Report Installed Apps" ^
#          /tr "powershell.exe -ExecutionPolicy Bypass -File C:\ProgramData\Applivery\report-installed-apps.ps1" ^
#          /sc HOURLY /mo 6 /ru SYSTEM /rl HIGHEST /f
#
#      For a fleet-wide schedule, deploy the same command via your existing
#      Windows Policy/script deployment — exactly the same mechanism this
#      app already uses to run Applivery Policy scripts (see the
#      Script/OMA-URI Library in Workflows).

$ErrorActionPreference = "Stop"

# ── CONFIG — filled in automatically if downloaded from Settings ──
$WebhookUrl    = "__WEBHOOK_URL__"
$WorkspaceSlug = "__WORKSPACE_SLUG__"
$ReportSecret  = "__REPORT_SECRET__"

$Serial = (Get-CimInstance Win32_BIOS).SerialNumber
if ([string]::IsNullOrWhiteSpace($Serial)) {
    Write-Error "report-installed-apps.ps1: could not read serial number — aborting."
    exit 1
}

$Apps = @()

$winget = Get-Command winget.exe -ErrorAction SilentlyContinue
if ($winget) {
    try {
        $wingetOutput = & winget.exe list --accept-source-agreements 2>$null
        # winget's `list` output is a fixed-width table with no built-in
        # machine-readable format in most currently-deployed versions, so
        # every column's start position is located from the header row
        # instead of hardcoded indexes (they shift with locale/version, and
        # the trailing "Available"/"Source" columns aren't always present).
        $headerLine = $wingetOutput | Where-Object { $_ -match '^Name\s+Id\s+Version' } | Select-Object -First 1
        if ($headerLine) {
            $colNames = @('Name', 'Id', 'Version', 'Available', 'Source')
            $cols = foreach ($n in $colNames) {
                $idx = $headerLine.IndexOf($n)
                if ($idx -ge 0) { [PSCustomObject]@{ Name = $n; Start = $idx } }
            }
            $cols = $cols | Sort-Object Start
            $dataLines = $wingetOutput | Where-Object {
                $_ -and ($_ -notmatch '^Name\s+Id\s+Version') -and ($_ -notmatch '^-+$')
            }
            foreach ($line in $dataLines) {
                $values = @{}
                for ($i = 0; $i -lt $cols.Count; $i++) {
                    $start = $cols[$i].Start
                    if ($line.Length -le $start) { continue }
                    $end = if ($i + 1 -lt $cols.Count) { [Math]::Min($cols[$i + 1].Start, $line.Length) } else { $line.Length }
                    $values[$cols[$i].Name] = $line.Substring($start, $end - $start).Trim()
                }
                if ($values['Id']) {
                    $Apps += [PSCustomObject]@{ identifier = $values['Id']; name = $values['Name']; version = $values['Version'] }
                }
            }
        }
    } catch {
        Write-Warning "report-installed-apps.ps1: winget list failed, falling back to registry enumeration: $_"
    }
}

if ($Apps.Count -eq 0) {
    # Fallback: registry Uninstall keys. No cross-vendor stable identifier
    # exists here, so `identifier` is the DisplayName itself, lowercased —
    # only useful for App List entries added manually under a matching
    # name, not ones sourced from MS Store/Winget search (different ID
    # space entirely). DisplayVersion, when present, is the same version
    # string Windows' own "Apps & Features" page shows.
    $uninstallPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    $Apps = Get-ItemProperty -Path $uninstallPaths -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName } |
        Select-Object -Unique @{n = 'identifier'; e = { $_.DisplayName.ToLower() } }, @{n = 'name'; e = { $_.DisplayName } }, @{n = 'version'; e = { $_.DisplayVersion } }
}

$Body = @{
    platform     = "windows"
    serialNumber = $Serial
    apps         = $Apps
    agentVersion = "report-installed-apps.ps1/1.1"
    reportedAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
} | ConvertTo-Json -Depth 4 -Compress

try {
    Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $Body -ContentType "application/json" -Headers @{
        "X-Workspace-Slug"       = $WorkspaceSlug
        "X-Device-Report-Secret" = $ReportSecret
    } | Out-Null
    Write-Output "report-installed-apps.ps1: reported $($Apps.Count) app(s) for serial $Serial."
} catch {
    Write-Error "report-installed-apps.ps1: report failed: $_"
    exit 1
}
