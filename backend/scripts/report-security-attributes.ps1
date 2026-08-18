# Applivery SOAR — security-attestation attribute reporter (Windows)
#
# Reads the local hardware/OS security posture — Secure Boot, Virtualization-
# Based Security (VBS), Credential Guard, memory integrity (HVCI), an ELAM
# proxy, BitLocker, and TPM readiness — and POSTs it to the generic
# self-reported-attributes webhook. Those attributes then feed the
# dashboard's Compliance Policy "Self-Reported Attribute" condition type
# directly (see WINDOWS_ATTR_ALIASES in the backend for the raw-name →
# canonical-name mapping), so a policy can flag a device "Non-Compliant" the
# moment one of these is reported as off/false and trigger a remediation
# workflow — e.g. re-running the "Virtualization-Based Security (VBS)" or
# "Credential Guard (LSA protection)" MDM actions.
#
# WHY NOT A LIVE MDM <Get> COMMAND: the HealthAttestation CSP's stated values
# (SecureBootEnabled, ElamEnabled, BitLockerStatus, etc.) aren't a simple
# synchronous device query — Windows populates them via a TPM-quoted,
# nonce/challenge round trip through Microsoft's own Health Attestation
# Service, established at MDM enrollment time. Applivery has no documented
# passthrough for reading HealthAttestation CSP nodes back (unlike script
# logs, which this app already reconciles). This script gets the same
# underlying signal — read straight off the device via WMI/CIM, the same
# APIs Windows itself uses to populate that CSP — on a schedule, without
# depending on unconfirmed MDM plumbing.
#
# Same stopgap model as report-installed-apps.ps1: a plain PowerShell script,
# nothing installed beyond a scheduled task, safe to read end-to-end before
# running — local read-only enumeration plus one outbound HTTPS POST.
#
# INSTALL
#   1. Copy this file somewhere stable, e.g. C:\ProgramData\Applivery\report-security-attributes.ps1
#   2. Fill in the three CONFIG values below (pre-filled automatically if
#      you downloaded this from Settings > Applivery SOAR Agent > Security
#      Attestation Reporting in the dashboard).
#   3. Schedule it with Task Scheduler, running as SYSTEM (required — several
#      of these queries, e.g. Get-Tpm and the DeviceGuard WMI namespace,
#      need elevated/system context to return complete data):
#
#        schtasks /create /tn "Applivery Report Security Attributes" ^
#          /tr "powershell.exe -ExecutionPolicy Bypass -File C:\ProgramData\Applivery\report-security-attributes.ps1" ^
#          /sc HOURLY /mo 6 /ru SYSTEM /rl HIGHEST /f
#
#      For a fleet-wide schedule, deploy the same command via your existing
#      Windows Policy/script deployment (Script/OMA-URI Library in Workflows).

$ErrorActionPreference = "Stop"

# ── CONFIG — filled in automatically if downloaded from Settings ──
$WebhookUrl    = "__WEBHOOK_URL__"
$WorkspaceSlug = "__WORKSPACE_SLUG__"
$ReportSecret  = "__REPORT_SECRET__"

$Serial = (Get-CimInstance Win32_BIOS).SerialNumber
if ([string]::IsNullOrWhiteSpace($Serial)) {
    Write-Error "report-security-attributes.ps1: could not read serial number — aborting."
    exit 1
}

$Attributes = @{}

# ── Secure Boot ──
# Confirm-SecureBootUEFI throws (rather than returning $false) on non-UEFI
# firmware, so SecureBootAvailable distinguishes "off" from "not applicable
# to this hardware" — a BIOS-mode device shouldn't be flagged the same way
# as a UEFI device that had Secure Boot turned off.
try {
    $Attributes["SecureBootEnabled"] = [bool](Confirm-SecureBootUEFI)
    $Attributes["SecureBootAvailable"] = $true
} catch {
    $Attributes["SecureBootEnabled"] = $false
    $Attributes["SecureBootAvailable"] = $false
}

# ── VBS / Credential Guard / memory integrity (HVCI) ──
# Win32_DeviceGuard: VirtualizationBasedSecurityStatus (0=not enabled,
# 1=enabled but not running, 2=enabled and running) and
# SecurityServicesRunning (array; 1=Credential Guard, 2=HVCI/memory
# integrity — both may be present). Confirmed via Microsoft's own
# Device Guard/Credential Guard docs.
try {
    $dg = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard -ErrorAction Stop
    $vbsStatus = $dg.VirtualizationBasedSecurityStatus
    $running = @($dg.SecurityServicesRunning)
    $Attributes["VbsEnabled"] = ($vbsStatus -ge 1)
    $Attributes["VbsRunning"] = ($vbsStatus -eq 2)
    $Attributes["CredentialGuardRunning"] = ($running -contains 1)
    $Attributes["HvciRunning"] = ($running -contains 2)
} catch {
    Write-Warning "report-security-attributes.ps1: Win32_DeviceGuard query failed (older build, or DeviceGuard namespace unavailable): $_"
    $Attributes["VbsEnabled"] = $false
    $Attributes["VbsRunning"] = $false
    $Attributes["CredentialGuardRunning"] = $false
    $Attributes["HvciRunning"] = $false
}

# ── ELAM (Early Launch Anti-Malware) ──
# No WMI class exposes ELAM status directly for third-party querying the way
# Win32_DeviceGuard does for VBS/Credential Guard, and this only matches what
# HealthAttestation itself reports on anyway: whether a Microsoft first-party
# ELAM driver (Windows Defender's WdBoot) loaded at boot. Proxied here via
# that driver's reported run state.
try {
    $wdBoot = Get-CimInstance -ClassName Win32_SystemDriver -Filter "Name='WdBoot'" -ErrorAction Stop
    $Attributes["ElamEnabled"] = [bool]($wdBoot -and $wdBoot.State -eq "Running")
} catch {
    $Attributes["ElamEnabled"] = $false
}

# ── BitLocker ──
try {
    $bl = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop
    $Attributes["BitLockerStatus"] = [bool]($bl.ProtectionStatus -eq "On")
} catch {
    Write-Warning "report-security-attributes.ps1: Get-BitLockerVolume failed (module unavailable or access denied): $_"
    $Attributes["BitLockerStatus"] = $false
}

# ── TPM ──
try {
    $tpm = Get-Tpm -ErrorAction Stop
    $Attributes["TpmReady"] = [bool]$tpm.TpmReady
} catch {
    $Attributes["TpmReady"] = $false
}

$Body = @{
    platform     = "windows"
    serialNumber = $Serial
    attributes   = $Attributes
    agentVersion = "report-security-attributes.ps1/1.0"
    reportedAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
} | ConvertTo-Json -Depth 4 -Compress

try {
    Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $Body -ContentType "application/json" -Headers @{
        "X-Workspace-Slug"       = $WorkspaceSlug
        "X-Device-Report-Secret" = $ReportSecret
    } | Out-Null
    Write-Output "report-security-attributes.ps1: reported $($Attributes.Count) attribute(s) for serial $Serial."
} catch {
    Write-Error "report-security-attributes.ps1: report failed: $_"
    exit 1
}
