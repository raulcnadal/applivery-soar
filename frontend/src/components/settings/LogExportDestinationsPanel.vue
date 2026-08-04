<script setup lang="ts">
// Log Export Destinations tab. Port of LogExportDestinations.jsx
// (wow-dashboard/src/components/settings/LogExportDestinations.jsx) +
// main.py:2260-2270's Settings panel wiring.
//
// Deliberately NOT a Modal — same architecture fix as the other 4 converted
// panels, but with the original's slightly different swap pattern: editing
// an EXISTING destination replaces that destination's own card row in
// place (`addingType === dest.id`), while creating a NEW one renders the
// form below the list (`addingType === 'new'`). Replaces the former
// LogExportDestinationDialog.vue Modal usage; this file itself
// (LogExportDestinationsPanel.vue) already rendered a correct card-style
// list-owning panel, so only the create/edit flow needed converting.
import { Alert, Button, Input } from "@applivery/bluesky-vue";
import { onMounted, reactive, ref } from "vue";
import { ICONS } from "../../lib/solarIcons";
import { useLogExportDestinationsStore, type LogExportDestination } from "../../stores/logExportDestinations";

const TYPE_META: Record<string, { label: string; icon: any; realtime: boolean }> = {
  syslog: { label: "Syslog", icon: ICONS.Routing, realtime: true },
  webhook: { label: "Webhook", icon: ICONS.LinkCircle, realtime: true },
  s3: { label: "S3", icon: ICONS.Database, realtime: false },
  nfs: { label: "NFS", icon: ICONS.Folder, realtime: false },
  sftp: { label: "SFTP", icon: ICONS.CloudDownload, realtime: false },
};

interface Form {
  name: string; type: string; enabled: boolean; format: string;
  host: string; port: string; facility: string; // syslog
  url: string; authHeaderValue: string; // webhook
  bucket: string; region: string; accessKeyId: string; secretAccessKey: string; endpointUrl: string; prefix: string; // s3
  path: string; // nfs
  sftpHost: string; sftpPort: string; username: string; password: string; remotePath: string; privateKey: string; privateKeyPassphrase: string; // sftp
}
function blankForm(): Form {
  return {
    name: "", type: "webhook", enabled: true, format: "json",
    host: "", port: "514", facility: "16",
    url: "", authHeaderValue: "",
    bucket: "", region: "", accessKeyId: "", secretAccessKey: "", endpointUrl: "", prefix: "",
    path: "",
    sftpHost: "", sftpPort: "22", username: "", password: "", remotePath: "/", privateKey: "", privateKeyPassphrase: "",
  };
}
function defaultConfigForType(): Form {
  return blankForm();
}

const store = useLogExportDestinationsStore();

// null = closed, 'new' = new-destination form below the list, <id> = editing
// that destination's card in place — 1:1 with the original's `addingType`.
const addingType = ref<string | null>(null);
const form = reactive<Form>(blankForm());
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const testResult = ref<string | null>(null);

function openNew() {
  addingType.value = "new";
  Object.assign(form, defaultConfigForType());
  saveError.value = null;
}
function openEdit(d: LogExportDestination) {
  addingType.value = d.id;
  const cfg = d.config ?? {};
  Object.assign(form, blankForm(), {
    name: d.name, type: d.type, enabled: d.enabled, format: d.format,
    host: cfg.host ?? "", port: cfg.port ? String(cfg.port) : "514", facility: cfg.facility !== undefined ? String(cfg.facility) : "16",
    url: cfg.url ?? "", authHeaderValue: cfg.authHeaderValue ?? "",
    bucket: cfg.bucket ?? "", region: cfg.region ?? "", accessKeyId: cfg.accessKeyId ?? "", secretAccessKey: "", endpointUrl: cfg.endpointUrl ?? "", prefix: cfg.prefix ?? "",
    path: cfg.path ?? "",
    sftpHost: d.type === "sftp" ? cfg.host ?? "" : "", sftpPort: d.type === "sftp" ? String(cfg.port ?? "22") : "22",
    username: cfg.username ?? "", password: "", remotePath: cfg.remotePath ?? "/", privateKey: "", privateKeyPassphrase: "",
  });
  saveError.value = null;
}
function closeEditor() {
  addingType.value = null;
}

async function remove(d: LogExportDestination) {
  if (!confirm(`Delete log export destination "${d.name}"?`)) return;
  await store.deleteDestination(d.id);
}
async function test(d: LogExportDestination) {
  testResult.value = null;
  try {
    await store.testDestination(d.id);
    testResult.value = `Test event sent to "${d.name}".`;
  } catch (err: any) {
    testResult.value = err?.response?.data?.detail || `Test failed for "${d.name}".`;
  }
}

function buildConfig(): Record<string, any> {
  switch (form.type) {
    case "syslog": return { host: form.host, port: Number(form.port) || 514, facility: Number(form.facility) || 16 };
    case "webhook": return { url: form.url, ...(form.authHeaderValue ? { authHeaderValue: form.authHeaderValue } : {}) };
    case "s3": return { bucket: form.bucket, region: form.region, accessKeyId: form.accessKeyId, secretAccessKey: form.secretAccessKey, endpointUrl: form.endpointUrl, prefix: form.prefix };
    case "nfs": return { path: form.path };
    case "sftp": return { host: form.sftpHost, port: Number(form.sftpPort) || 22, username: form.username, password: form.password, remotePath: form.remotePath, privateKey: form.privateKey, privateKeyPassphrase: form.privateKeyPassphrase };
    default: return {};
  }
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  const payload = { name: form.name, type: form.type, enabled: form.enabled, format: form.format, config: buildConfig() };
  try {
    const editingExisting = addingType.value !== "new" ? store.destinations.find((d) => d.id === addingType.value) : null;
    if (editingExisting) await store.updateDestination(editingExisting.id, payload);
    else await store.createDestination(payload);
    closeEditor();
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save destination.";
  } finally {
    isSaving.value = false;
  }
}

onMounted(async () => {
  await store.fetchDestinations();
});
</script>

<template>
  <div class="space-y-4">
    <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      Ships this workspace's audit trail somewhere outside the app. Syslog and webhook deliver in real time as events happen; S3, NFS, and SFTP export once a day.
      Google Drive/OneDrive aren't available yet — those need an OAuth app registration created on your end first.
    </p>
    <Alert v-if="store.error" type="danger">{{ store.error }}</Alert>
    <Alert v-if="testResult" type="info">{{ testResult }}</Alert>

    <div v-if="store.destinations.length === 0 && addingType === null" class="text-xs text-gray-400 py-6 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
      No log export destinations yet.
    </div>
    <div v-else class="space-y-2">
      <template v-for="d in store.destinations" :key="d.id">
        <!-- Editing an existing destination replaces its own card in place,
             1:1 with the original's `if (addingType === dest.id) return
             <DestinationForm .../>`. -->
        <form v-if="addingType === d.id" class="p-4 rounded-xl space-y-3 border border-brand-200 dark:border-brand-800 bg-white dark:bg-gray-800" @submit.prevent="save">
          <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
          <Input v-model="form.name" label="Name" />
          <div class="grid grid-cols-2 gap-2">
            <Input :model-value="form.type" type="select" :options="['syslog', 'webhook', 's3', 'nfs', 'sftp'].map((t) => ({ value: t, label: t.toUpperCase() }))" label="Type" @update:model-value="form.type = $event as string" />
            <Input :model-value="form.format" type="select" :options="[{ value: 'json', label: 'JSON' }, { value: 'cef', label: 'CEF (SIEM)' }]" label="Format" @update:model-value="form.format = $event as string" />
          </div>

          <template v-if="form.type === 'syslog'">
            <div class="grid grid-cols-3 gap-2">
              <Input v-model="form.host" label="Host" class="col-span-2" />
              <Input v-model="form.port" label="Port" placeholder="514" />
            </div>
            <Input v-model="form.facility" label="Facility (0-23)" placeholder="16" />
          </template>
          <template v-else-if="form.type === 'webhook'">
            <Input v-model="form.url" label="URL" />
            <Input v-model="form.authHeaderValue" type="password" label="Authorization header value (optional)" />
          </template>
          <template v-else-if="form.type === 's3'">
            <Input v-model="form.bucket" label="Bucket" />
            <div class="grid grid-cols-2 gap-2">
              <Input v-model="form.region" label="Region" placeholder="us-east-1" />
              <Input v-model="form.prefix" label="Key prefix (optional)" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <Input v-model="form.accessKeyId" label="Access key ID" />
              <Input v-model="form.secretAccessKey" type="password" label="Secret access key" placeholder="Leave blank to keep current" />
            </div>
            <Input v-model="form.endpointUrl" label="Custom endpoint URL (MinIO/R2/B2, optional)" />
          </template>
          <template v-else-if="form.type === 'nfs'">
            <Input v-model="form.path" label="Local/mounted directory path" placeholder="/mnt/log-exports" />
          </template>
          <template v-else-if="form.type === 'sftp'">
            <div class="grid grid-cols-3 gap-2">
              <Input v-model="form.sftpHost" label="Host" class="col-span-2" />
              <Input v-model="form.sftpPort" label="Port" placeholder="22" />
            </div>
            <Input v-model="form.username" label="Username" />
            <Input v-model="form.password" type="password" label="Password (or leave blank if using a private key)" />
            <Input v-model="form.privateKey" type="textarea" label="Private key (optional, PEM)" />
            <Input v-model="form.privateKeyPassphrase" type="password" label="Private key passphrase (optional)" />
            <Input v-model="form.remotePath" label="Remote directory path" placeholder="/" />
          </template>

          <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 pt-1"><input type="checkbox" v-model="form.enabled" /> Enabled</label>

          <div class="flex items-center gap-2 pt-2">
            <Button type="submit" :loading="isSaving" :disabled="!form.name">Save changes</Button>
            <Button variant="ghost" type="button" @click="closeEditor">Cancel</Button>
          </div>
        </form>

        <div v-else class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-1.5">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2.5 min-w-0">
              <component :is="TYPE_META[d.type]?.icon ?? ICONS.Database" :size="16" weight="Linear" class="shrink-0 text-gray-400" />
              <div class="min-w-0">
                <p class="text-sm font-medium truncate text-gray-900 dark:text-white">{{ d.name }}</p>
                <p class="text-[11px] text-gray-400">{{ TYPE_META[d.type]?.label ?? d.type }} — {{ d.lastExportedAt ? `last export ${new Date(d.lastExportedAt).toLocaleString()}` : "never exported" }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase" style="background-color: #9ca3af20; color: #9ca3af">{{ d.format }}</span>
              <span v-if="d.lastExportError" class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background-color: #ef444420; color: #ef4444">Error</span>
              <span v-else class="text-[10px] font-semibold px-2 py-0.5 rounded-full" :style="{ backgroundColor: d.enabled ? '#22C55E20' : '#9CA3AF20', color: d.enabled ? '#22C55E' : '#9CA3AF' }">{{ d.enabled ? "Enabled" : "Disabled" }}</span>
              <button type="button" class="text-gray-400 hover:text-brand-600" title="Test" @click="test(d)"><component :is="ICONS.TestTube" :size="15" weight="Linear" /></button>
              <button type="button" class="text-gray-400 hover:text-brand-600" title="Edit" @click="openEdit(d)"><component :is="ICONS.Pen" :size="15" weight="Linear" /></button>
              <button type="button" class="text-gray-400 hover:text-red-500" title="Delete" @click="remove(d)"><component :is="ICONS.TrashBinTrash" :size="15" weight="Linear" /></button>
            </div>
          </div>
          <p v-if="d.lastExportError" class="text-[11px] text-red-500">{{ d.lastExportError }}</p>
        </div>
      </template>
    </div>

    <!-- New-destination form renders below the list, 1:1 with the
         original's `addingType === 'new'` branch. -->
    <form v-if="addingType === 'new'" class="p-4 rounded-xl space-y-3 border border-brand-200 dark:border-brand-800 bg-white dark:bg-gray-800" @submit.prevent="save">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>
      <Input v-model="form.name" label="Name" />
      <div class="grid grid-cols-2 gap-2">
        <Input :model-value="form.type" type="select" :options="['syslog', 'webhook', 's3', 'nfs', 'sftp'].map((t) => ({ value: t, label: t.toUpperCase() }))" label="Type" @update:model-value="form.type = $event as string" />
        <Input :model-value="form.format" type="select" :options="[{ value: 'json', label: 'JSON' }, { value: 'cef', label: 'CEF (SIEM)' }]" label="Format" @update:model-value="form.format = $event as string" />
      </div>

      <template v-if="form.type === 'syslog'">
        <div class="grid grid-cols-3 gap-2">
          <Input v-model="form.host" label="Host" class="col-span-2" />
          <Input v-model="form.port" label="Port" placeholder="514" />
        </div>
        <Input v-model="form.facility" label="Facility (0-23)" placeholder="16" />
      </template>
      <template v-else-if="form.type === 'webhook'">
        <Input v-model="form.url" label="URL" />
        <Input v-model="form.authHeaderValue" type="password" label="Authorization header value (optional)" />
      </template>
      <template v-else-if="form.type === 's3'">
        <Input v-model="form.bucket" label="Bucket" />
        <div class="grid grid-cols-2 gap-2">
          <Input v-model="form.region" label="Region" placeholder="us-east-1" />
          <Input v-model="form.prefix" label="Key prefix (optional)" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Input v-model="form.accessKeyId" label="Access key ID" />
          <Input v-model="form.secretAccessKey" type="password" label="Secret access key" placeholder="Leave blank to keep current" />
        </div>
        <Input v-model="form.endpointUrl" label="Custom endpoint URL (MinIO/R2/B2, optional)" />
      </template>
      <template v-else-if="form.type === 'nfs'">
        <Input v-model="form.path" label="Local/mounted directory path" placeholder="/mnt/log-exports" />
      </template>
      <template v-else-if="form.type === 'sftp'">
        <div class="grid grid-cols-3 gap-2">
          <Input v-model="form.sftpHost" label="Host" class="col-span-2" />
          <Input v-model="form.sftpPort" label="Port" placeholder="22" />
        </div>
        <Input v-model="form.username" label="Username" />
        <Input v-model="form.password" type="password" label="Password (or leave blank if using a private key)" />
        <Input v-model="form.privateKey" type="textarea" label="Private key (optional, PEM)" />
        <Input v-model="form.privateKeyPassphrase" type="password" label="Private key passphrase (optional)" />
        <Input v-model="form.remotePath" label="Remote directory path" placeholder="/" />
      </template>

      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 pt-1"><input type="checkbox" v-model="form.enabled" /> Enabled</label>

      <div class="flex items-center gap-2 pt-2">
        <Button type="submit" :loading="isSaving" :disabled="!form.name">Create destination</Button>
        <Button variant="ghost" type="button" @click="closeEditor">Cancel</Button>
      </div>
    </form>

    <div v-if="addingType === null" class="flex justify-start">
      <Button @click="openNew">
        <component :is="ICONS.AddCircle" :size="15" weight="Linear" /> New Destination
      </Button>
    </div>
  </div>
</template>
