import { appliveryClient } from "../../services/appliveryClient";
import { prisma } from "../../services/prisma";
import { platformPathSegment } from "../devices/deviceNormalize";
import { MDM_ACTIONS } from "../devices/mdmActions";
import { renderTemplate } from "./templateRender";
import { fetchScriptLogSummaryEntry } from "./scriptLogApi";

/**
 * Faithful port of `_execute_mdm_action` (main.py:5518-5999) — dispatches one
 * MDM command to a device, returning `{ok, detail}` (never throws for a
 * normal API-rejection outcome, matching the original's (ok, detail) tuple
 * contract). This is THE dispatch point every workflow step of type
 * 'mdm_action' calls through (workflows.execution.ts), same as the original.
 */

export const UNCONFIRMED_API_ACTIONS = new Set<string>(["deviceLocation"]);

const FIREWALL_GROUP_PREFIX = "BPSOAR-FW";
function firewallGroupTag(ruleSetId: string): string {
  return `${FIREWALL_GROUP_PREFIX}-${ruleSetId}`;
}

/** Port of `_record_firewall_remediation_dispatch` (main.py:5238) — adapted to this schema's one-row-per-(workspace,device,ruleset) shape instead of the original's per-device JSON dict. */
async function recordFirewallRemediationDispatch(workspaceSlug: string, deviceId: string | null | undefined, ruleSet: { id: string; name: string }, applying: boolean): Promise<void> {
  if (!deviceId) return;
  if (applying) {
    await prisma.firewallRemediationState.upsert({
      where: { workspaceSlug_deviceId_rulesetId: { workspaceSlug, deviceId, rulesetId: ruleSet.id } },
      create: {
        workspaceSlug,
        deviceId,
        rulesetId: ruleSet.id,
        appliedState: { ruleSetId: ruleSet.id, ruleSetName: ruleSet.name, groupTag: firewallGroupTag(ruleSet.id), appliedAt: new Date().toISOString() } as any,
      },
      update: {
        appliedState: { ruleSetId: ruleSet.id, ruleSetName: ruleSet.name, groupTag: firewallGroupTag(ruleSet.id), appliedAt: new Date().toISOString() } as any,
      },
    });
  } else {
    await prisma.firewallRemediationState.deleteMany({ where: { workspaceSlug, deviceId, rulesetId: ruleSet.id } });
  }
}

export interface MdmActionResult {
  ok: boolean;
  detail: string;
}

export interface WorkflowResumeRef {
  pendingToken: string;
  slugKey: string;
}

/**
 * `deploymentModel` is the WORKFLOW's own declared deployment model (set in
 * the builder), not something read off the real device — a defensive
 * re-check in case a workflow's steps were edited after the platform/model
 * changed. `deviceContext` is the same `{device: {...}}` object
 * http_request/notification steps template against, passed through here so
 * 'customOmaUri'/'scheduleOsUpdate' can template their own fields the same
 * way. `deviceId` is Applivery's own internal device id (NOT
 * platformDeviceId) — only needed by 'runScript' for tracking. `workflowResume`
 * is set only when this dispatch comes from a durable engine 'run_script_wait'
 * step (main.py's `workflow_resume` kwarg on `_execute_mdm_action`) — stashed
 * onto the ScriptRunTracking row so script_log_reconciler_loop can resume the
 * parked chain the moment the real result is known.
 */
export async function executeMdmAction(
  headers: Record<string, string>,
  orgBase: string,
  workspaceSlug: string,
  platform: string,
  platformDeviceId: string,
  actionKey: string,
  deploymentModel: string | null | undefined,
  params: Record<string, any> | null | undefined,
  deviceId?: string | null,
  deviceContext?: Record<string, unknown>,
  workflowResume?: WorkflowResumeRef | null,
): Promise<MdmActionResult> {
  const p = params ?? {};
  const action = MDM_ACTIONS[actionKey];
  if (!action) return { ok: false, detail: `Unknown MDM action '${actionKey}'` };
  if (!platformDeviceId) return { ok: false, detail: "Device is missing a platform device ID" };

  const platformPath = platformPathSegment(platform);
  if (!platformPath) return { ok: false, detail: `Unsupported platform '${platform}'` };

  if (action.platforms && !action.platforms.includes(platformPath)) {
    return { ok: false, detail: `'${action.label}' is not supported on ${platformPath}` };
  }

  const allowedModels = action.deploymentModels?.[platform];
  if (allowedModels?.length && deploymentModel && !allowedModels.includes(deploymentModel)) {
    return { ok: false, detail: `'${action.label}' requires ${allowedModels.join("/")} deployment mode (workflow targets ${deploymentModel})` };
  }

  if (UNCONFIRMED_API_ACTIONS.has(actionKey)) {
    return { ok: false, detail: `'${action.label}' is not yet wired to a verified Applivery API call — run it from the Applivery Dashboard directly for now.` };
  }

  for (const field of action.fields ?? []) {
    if (field.required && !String(p[field.key] ?? "").trim()) {
      return { ok: false, detail: `'${action.label}' requires a value for '${field.label}'` };
    }
  }

  try {
    if (actionKey === "runScript") {
      return await executeRunScript(headers, orgBase, workspaceSlug, platform, platformPath, platformDeviceId, p, deviceId, deviceContext, workflowResume);
    }

    if (actionKey === "applyFirewallRuleSet" || actionKey === "restoreFirewallRuleSet") {
      const ruleSetId = p.ruleSetId;
      if (!ruleSetId) return { ok: false, detail: "No Firewall Rule Set selected" };
      const ruleSet = await prisma.firewallRuleSet.findFirst({ where: { workspaceSlug, id: ruleSetId } });
      if (!ruleSet) return { ok: false, detail: "Firewall Rule Set not found — it may have been deleted" };
      const applying = actionKey === "applyFirewallRuleSet";
      const resolvedLibraryId = applying ? ruleSet.applyLibraryId : ruleSet.restoreLibraryId;
      if (!resolvedLibraryId) {
        return { ok: false, detail: `'${ruleSet.name}' hasn't finished provisioning its on-device script — try saving it again in the Firewall Policy Library.` };
      }
      const { ok, detail } = await executeMdmAction(
        headers, orgBase, workspaceSlug, platform, platformDeviceId, "runScript", deploymentModel,
        { libraryId: resolvedLibraryId }, deviceId, deviceContext,
      );
      if (!ok) return { ok: false, detail };
      await recordFirewallRemediationDispatch(workspaceSlug, deviceId, ruleSet, applying);
      return { ok: true, detail: `${applying ? "Applied" : "Restored device from"} firewall rule set '${ruleSet.name}'` };
    }

    let res: { status: number; data?: unknown };

    if (actionKey === "deleteDevice" && platformPath === "android" && deploymentModel === "cope") {
      // "Relinquish ownership" — COPE-specific unenroll flavor. Removes
      // company management/the work profile only; NOT a data wipe.
      const url = `${orgBase}/mdm/android/enterprise/devices/${platformDeviceId}/commands`;
      res = await appliveryClient.post(url, { type: "RELINQUISH_OWNERSHIP" }, { headers });
    } else if (actionKey === "deleteDevice") {
      const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${platformDeviceId}`;
      res = await appliveryClient.delete(url, { headers });
    } else if (actionKey === "installApp" || actionKey === "uninstallApp") {
      const body = { entity: "application", action: actionKey === "installApp" ? "install" : "uninstall", id: p.appId || "" };
      const url = `${orgBase}/mdm/${platformPath}/enterprise/devices/${platformDeviceId}/action`;
      res = await appliveryClient.post(url, body, { headers });
    } else if (platformPath === "apple" && ["setBluetooth", "setDataRoaming", "setVoiceRoaming", "setPersonalHotspot", "setTimeZone", "setSoftwareUpdateCadence"].includes(actionKey)) {
      const cadenceMap: Record<string, number> = { "Show all available": 0, "Prefer oldest available": 1, "Prefer latest available": 2 };
      const settingsItemMap: Record<string, Record<string, unknown>> = {
        setBluetooth: { Item: "Bluetooth", Enabled: p.enabled === "Enabled" },
        setDataRoaming: { Item: "DataRoaming", Enabled: p.enabled === "Enabled" },
        setVoiceRoaming: { Item: "VoiceRoaming", Enabled: p.enabled === "Enabled" },
        setPersonalHotspot: { Item: "PersonalHotspot", Enabled: p.enabled === "Enabled" },
        setTimeZone: { Item: "TimeZone", TimeZone: p.timeZone || "" },
        setSoftwareUpdateCadence: { Item: "SoftwareUpdateSettings", RecommendationCadence: cadenceMap[p.cadence] ?? 0 },
      };
      const body = { RequestType: "Settings", Settings: [settingsItemMap[actionKey]] };
      const url = `${orgBase}/mdm/apple/enterprise/commands/device/${platformDeviceId}`;
      res = await appliveryClient.post(url, body, { headers });
    } else if (platformPath === "apple" && actionKey === "setRemoteDesktop") {
      const body = { RequestType: p.enabled === "Enabled" ? "EnableRemoteDesktop" : "DisableRemoteDesktop" };
      const url = `${orgBase}/mdm/apple/enterprise/commands/device/${platformDeviceId}`;
      res = await appliveryClient.post(url, body, { headers });
    } else if (platformPath === "apple") {
      const requestTypeMap: Record<string, string> = {
        wipeDevice: "EraseDevice", lockDevice: "DeviceLock", clearPasscode: "ClearPasscode",
        rebootDevice: "RestartDevice", shutdownDevice: "ShutDownDevice",
        enableLostMode: "EnableLostMode", disableLostMode: "DisableLostMode",
        playLostModeSound: "PlayLostModeSound", syncDevice: "DeviceInformation",
        scheduleOsUpdate: "ScheduleOSUpdate", removeProfile: "RemoveProfile",
        getActivationLockBypassCode: "ActivationLockBypassCode", rotateFileVaultKey: "RotateFileVaultKey",
        recoveryLock: "SetRecoveryLock", unlockUserAccount: "UnlockUserAccount",
        clearRestrictionsPassword: "ClearRestrictionsPassword",
      };
      const body: Record<string, unknown> = { RequestType: requestTypeMap[actionKey] ?? actionKey };
      if (actionKey === "wipeDevice" && platform === "macos") body.PIN = "123456";
      if (actionKey === "enableLostMode") {
        if (p.message) body.Message = p.message;
        if (p.phoneNumber) body.PhoneNumber = p.phoneNumber;
        if (p.footnote) body.Footnote = p.footnote;
      }
      if (actionKey === "scheduleOsUpdate") {
        let targetVersion = String(p.productVersion || "");
        if (targetVersion && deviceContext) {
          try {
            targetVersion = renderTemplate(targetVersion, deviceContext);
          } catch {
            /* fall through with unrendered value, matching original's bare except */
          }
        }
        if (!targetVersion.trim()) {
          return {
            ok: false,
            detail:
              "'Schedule OS update' resolved to an empty target version — the OS Lifecycle catalog has no confirmed latest version for this device yet, or this workflow wasn't triggered with that data available.",
          };
        }
        body.Updates = [{ ProductVersion: targetVersion, InstallAction: p.installAction || "Default" }];
      }
      if (actionKey === "removeProfile") body.Identifier = p.identifier || "";
      if (actionKey === "rotateFileVaultKey") {
        body.KeyType = "personal";
        body.FileVaultUnlock = p.currentPassword ? { Password: p.currentPassword } : {};
      }
      if (actionKey === "recoveryLock") {
        body.NewPassword = p.newPassword || "";
        if (p.currentPassword) body.CurrentPassword = p.currentPassword;
      }
      if (actionKey === "unlockUserAccount") body.UserName = p.userName || "";
      const url = `${orgBase}/mdm/apple/enterprise/commands/device/${platformDeviceId}`;
      res = await appliveryClient.post(url, body, { headers });
    } else if (platformPath === "android" && (actionKey === "disableDevice" || actionKey === "enableDevice")) {
      const url = `${orgBase}/mdm/android/enterprise/devices/${platformDeviceId}`;
      res = await appliveryClient.put(url, { state: actionKey === "disableDevice" ? "DISABLED" : "ACTIVE" }, { headers });
    } else if (platformPath === "android") {
      const androidTypeMap: Record<string, string> = {
        lockDevice: "LOCK", clearPasscode: "RESET_PASSWORD", rebootDevice: "REBOOT",
        enableLostMode: "START_LOST_MODE", disableLostMode: "STOP_LOST_MODE", clearAppData: "CLEAR_APP_DATA",
      };
      const body: Record<string, unknown> = { type: androidTypeMap[actionKey] ?? actionKey.toUpperCase() };
      if (actionKey === "clearPasscode" && p.newPassword) body.newPassword = p.newPassword;
      if (actionKey === "enableLostMode") {
        if (p.message) body.startLostModeParams = { lostMessage: { defaultMessage: p.message } };
        if (p.phoneNumber) body.startLostModeParams = { ...(body.startLostModeParams as object | undefined), lostPhoneNumber: { defaultMessage: p.phoneNumber } };
      }
      if (actionKey === "clearAppData" && p.packageNames) {
        const packageNames = String(p.packageNames).split(",").map((s) => s.trim()).filter(Boolean);
        body.clearAppsDataParams = { packageNames };
      }
      const url = `${orgBase}/mdm/android/enterprise/devices/${platformDeviceId}/commands`;
      res = await appliveryClient.post(url, body, { headers });
    } else if (platformPath === "aosp") {
      const aospTypeMap: Record<string, string> = { lockDevice: "LOCK", clearPasscode: "RESET_PASSWORD", rebootDevice: "REBOOT", clearAppData: "CLEAR_APP_DATA" };
      const body: Record<string, unknown> = { command: aospTypeMap[actionKey] ?? actionKey.toUpperCase() };
      if (actionKey === "clearPasscode" && p.newPassword) body.params = { newPassword: p.newPassword };
      if (actionKey === "clearAppData" && p.packageNames) {
        const packageNames = String(p.packageNames).split(",").map((s) => s.trim()).filter(Boolean);
        body.params = { packageNames };
      }
      const url = `${orgBase}/mdm/aosp/enterprise/devices/${platformDeviceId}/commands`;
      res = await appliveryClient.post(url, body, { headers });
    } else if (actionKey === "wipeDevice" || actionKey === "rebootDevice") {
      const body: Record<string, unknown> = { entity: "command", action: actionKey === "wipeDevice" ? "wipe" : "reboot" };
      if (actionKey === "wipeDevice") body.type = p.wipeType || "default";
      const url = `${orgBase}/mdm/windows/enterprise/devices/${platformDeviceId}/action`;
      res = await appliveryClient.post(url, body, { headers });
    } else if (actionKey === "setRemovableStorageWindows") {
      const blocked = p.enabled === "Block all";
      const configs = [
        { path: "./Device/Vendor/MSFT/Policy/Config/Storage/RemovableDiskDenyWriteAccess", action: "Replace", format: "int", value: blocked ? "1" : "0" },
        { path: "./Device/Vendor/MSFT/Policy/Config/Storage/WPDDevicesDenyWriteAccessPerDevice", action: "Replace", format: "chr", value: blocked ? "<enabled/>" : "<disabled/>" },
        { path: "./Device/Vendor/MSFT/Policy/Config/Storage/WPDDevicesDenyReadAccessPerDevice", action: "Replace", format: "chr", value: blocked ? "<enabled/>" : "<disabled/>" },
        { path: "./Device/Vendor/MSFT/Policy/Config/ADMX_RemovableStorage/CDandDVD_DenyWrite_Access_2", action: "Replace", format: "chr", value: blocked ? "<enabled/>" : "<disabled/>" },
      ];
      const url = `${orgBase}/mdm/windows/enterprise/devices/${platformDeviceId}/commands`;
      res = await appliveryClient.post(url, { commands: configs.map((c) => ({ config: c })) }, { headers });
    } else {
      // windows — SyncML OMA-URI configuration
      let path: string, omaAction: string, value: string, fmt: string;
      if (actionKey === "customOmaUri") {
        path = p.path || "";
        omaAction = p.action || "Replace";
        value = p.value || "";
        if (value && deviceContext) {
          try {
            value = renderTemplate(value, deviceContext);
          } catch {
            /* fall through with unrendered value */
          }
        }
        fmt = p.format || "chr";
      } else if (["setBluetoothWindows", "setWifiWindows", "setCameraWindows"].includes(actionKey)) {
        const allowed = p.enabled === "Allow";
        const toggleMap: Record<string, [string, string, string]> = {
          setBluetoothWindows: ["./Device/Vendor/MSFT/Policy/Config/Connectivity/AllowBluetooth", "2", "0"],
          setWifiWindows: ["./Device/Vendor/MSFT/Policy/Config/Wifi/AllowWiFi", "1", "0"],
          setCameraWindows: ["./Device/Vendor/MSFT/Policy/Config/Camera/AllowCamera", "1", "0"],
        };
        const [p0, allowValue, blockValue] = toggleMap[actionKey];
        path = p0; omaAction = "Replace"; value = allowed ? allowValue : blockValue; fmt = "int";
      } else if (actionKey === "enableVbsWindows") {
        path = "./Device/Vendor/MSFT/Policy/Config/DeviceGuard/EnableVirtualizationBasedSecurity";
        omaAction = "Replace"; value = p.enabled === "Enable" ? "1" : "0"; fmt = "int";
      } else if (actionKey === "setCredentialGuardWindows") {
        path = "./Device/Vendor/MSFT/Policy/Config/DeviceGuard/LsaCfgFlags";
        omaAction = "Replace";
        const modeMap: Record<string, string> = { Disabled: "0", "Enabled without lock (recommended for UEM)": "2", "Enabled with UEFI lock": "1" };
        value = modeMap[p.mode] ?? "2"; fmt = "int";
      } else if (actionKey === "mdmUnenrollWindows") {
        path = "./Vendor/MSFT/DMClient/Unenroll"; omaAction = "Exec"; value = p.providerId || ""; fmt = "chr";
      } else if (actionKey === "autopilotResetWindows") {
        path = "./Vendor/MSFT/RemoteWipe/AutomaticRedeployment/doAutomaticRedeployment"; omaAction = "Exec"; value = ""; fmt = "chr";
      } else {
        const pathActionMap: Record<string, [string, string]> = {
          lockDevice: ["./Vendor/MSFT/RemoteLock/DeviceLock", "Exec"],
          syncDevice: ["./DevInfo/DevId", "Get"],
        };
        const [p0, a0] = pathActionMap[actionKey] ?? [actionKey, "Exec"];
        path = p0; omaAction = a0; value = ""; fmt = "chr";
      }
      const body = { commands: [{ config: { path, action: omaAction, format: fmt, value } }] };
      const url = `${orgBase}/mdm/windows/enterprise/devices/${platformDeviceId}/commands`;
      res = await appliveryClient.post(url, body, { headers });
    }

    if (res.status < 300) return { ok: true, detail: `${action.label} accepted (${res.status})` };
    return { ok: false, detail: `API returned ${res.status}: ${String(JSON.stringify(res.data ?? "")).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Port of the 'runScript' branch (main.py:5575-5678) — UNDOCUMENTED but
 * confirmed-working direct execution: PUTting a `scripts` array onto the
 * device (same endpoint used for tags/policy assignments) runs the
 * referenced script Asset immediately, no Policy involved. The device's
 * CURRENT scripts array is read first and the new/updated entry merged in
 * by id (this endpoint's array fields are full-replace, and other scripts
 * may already be assigned via a Policy).
 */
async function executeRunScript(
  headers: Record<string, string>,
  orgBase: string,
  workspaceSlug: string,
  platform: string,
  platformPath: string,
  platformDeviceId: string,
  params: Record<string, any>,
  deviceId: string | null | undefined,
  deviceContext?: Record<string, unknown>,
  workflowResume?: WorkflowResumeRef | null,
): Promise<MdmActionResult> {
  const libraryId = params.libraryId;
  if (!libraryId) return { ok: false, detail: "No script selected from the Library" };
  const entry = await prisma.actionLibraryEntry.findFirst({ where: { workspaceSlug, id: libraryId, type: "script" } });
  if (!entry) return { ok: false, detail: "Script library entry not found — it may have been deleted" };
  const entryPlatformPath = platformPathSegment(entry.platform);
  if (entryPlatformPath !== platformPath) {
    return { ok: false, detail: `'${entry.name}' is a ${entry.platform} script — this device is ${platform}` };
  }
  const assetId = entry.assetId;
  if (!assetId) return { ok: false, detail: "Script library entry is missing its Applivery script Asset ID" };

  // Applivery interpolates {{device.x}}/{{user.x}} in `arguments` itself at
  // execution time (confirmed via Applivery's own docs) — unlike
  // customOmaUri's `value`, this is passed through untouched, no local
  // template rendering.
  const scriptArguments = entry.arguments || "";
  const scope = entry.scope || "machine";
  const resetDate = new Date().toISOString(); // already "YYYY-MM-DDTHH:mm:ss.sssZ" — matches the original's hand-rolled equivalent

  const deviceUrl = `${orgBase}/mdm/${platformPath}/enterprise/devices/${platformDeviceId}`;
  const getRes = await appliveryClient.get(deviceUrl, { headers });
  let currentScripts: Array<Record<string, unknown>> = [];
  if (getRes.status < 300) {
    try {
      const rawScripts = ((getRes.data as any)?.data?.scripts as any[]) ?? [];
      for (const s of rawScripts) {
        if (!s || typeof s !== "object" || !s.id) continue;
        const sanitized: Record<string, unknown> = { id: s.id, type: s.type || "once", resetDate: s.resetDate, arguments: s.arguments || "", scope: s.scope || "machine" };
        if (s.type === "loop" && s.loopTime !== undefined && s.loopTime !== null) sanitized.loopTime = s.loopTime;
        currentScripts.push(sanitized);
      }
    } catch {
      currentScripts = [];
    }
  }

  const newEntry = { id: assetId, type: "once", resetDate, arguments: scriptArguments, scope };
  const merged = [...currentScripts.filter((s) => s.id !== assetId), newEntry];

  // Snapshot this script's current success/error counts BEFORE dispatch —
  // script_log_reconciler_loop compares against this baseline to detect the
  // NEW execution our PUT below causes, since Applivery's script-logs/summary
  // only exposes rolling totals per (device, script), never "just the latest
  // run". Best-effort: a failure here just skips tracking, never blocks the
  // actual script run. Port of main.py:5639-5654.
  let baselineSuccess = 0;
  let baselineError = 0;
  try {
    const baselineEntry = await fetchScriptLogSummaryEntry(headers, orgBase, platformPath, platformDeviceId, assetId);
    if (baselineEntry) {
      baselineSuccess = baselineEntry.status?.success ?? 0;
      baselineError = baselineEntry.status?.error ?? 0;
    }
  } catch {
    /* best-effort — see comment above */
  }

  const res = await appliveryClient.put(deviceUrl, { scripts: merged }, { headers });
  if (res.status >= 300) return { ok: false, detail: `API returned ${res.status}: ${String(JSON.stringify(res.data ?? "")).slice(0, 200)}` };

  // Best-effort dispatch record for later Audit Log follow-up —
  // script_log_reconciler_loop (scriptLogReconciler.ts) polls these rows
  // until the counts move past the baseline above, then writes the outcome
  // to the Audit Log (and, if `workflowResume` is set, resumes the durable
  // engine's parked 'run_script_wait' chain). Port of main.py:5660-5676.
  try {
    const deviceName = ((deviceContext as any)?.device as any)?.displayName ?? null;
    await prisma.scriptRunTracking.create({
      data: {
        workspaceSlug, deviceId: deviceId ?? "", deviceName,
        platformPath, platformDeviceId, assetId, scriptName: entry.name || assetId,
        baselineSuccess, baselineError, attempts: 0,
        workflowResume: workflowResume ? (workflowResume as any) : undefined,
      },
    });
  } catch (e) {
    console.warn(`[runScript] Failed to record dispatch for Audit Log follow-up: ${e}`);
  }

  return { ok: true, detail: `Ran script '${entry.name || assetId}' directly on device (scope=${scope})` };
}
