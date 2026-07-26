<script setup lang="ts">
// Create/edit a Log Export Destination. Port of LogExportDestinationPayload (main.py:2277-2287).
import { Alert, Button, Input, Modal } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useLogExportDestinationsStore, type LogExportDestination } from "../../stores/logExportDestinations";

const props = defineProps<{ open: boolean; destination: LogExportDestination | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useLogExportDestinationsStore();

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

const form = reactive<Form>(blankForm());
const isSaving = ref(false);
const saveError = ref<string | null>(null);

watch(() => props.open, (open) => {
  if (!open) return;
  const d = props.destination;
  const cfg = d?.config ?? {};
  Object.assign(form, blankForm(), {
    name: d?.name ?? "", type: d?.type ?? "webhook", enabled: d?.enabled ?? true, format: d?.format ?? "json",
    host: cfg.host ?? "", port: cfg.port ? String(cfg.port) : "514", facility: cfg.facility !== undefined ? String(cfg.facility) : "16",
    url: cfg.url ?? "", authHeaderValue: cfg.authHeaderValue ?? "",
    bucket: cfg.bucket ?? "", region: cfg.region ?? "", accessKeyId: cfg.accessKeyId ?? "", secretAccessKey: "", endpointUrl: cfg.endpointUrl ?? "", prefix: cfg.prefix ?? "",
    path: cfg.path ?? "",
    sftpHost: d?.type === "sftp" ? cfg.host ?? "" : "", sftpPort: d?.type === "sftp" ? String(cfg.port ?? "22") : "22",
    username: cfg.username ?? "", password: "", remotePath: cfg.remotePath ?? "/", privateKey: "", privateKeyPassphrase: "",
  });
  saveError.value = null;
});

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
    if (props.destination) await store.updateDestination(props.destination.id, payload);
    else await store.createDestination(payload);
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save destination.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Modal :open="open" :title="destination ? `Edit “${destination.name}”` : 'New log export destination'" size="lg" @close="emit('close')">
    <div class="space-y-3">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>

      <Input v-model="form.name" label="Name" />
      <div class="grid grid-cols-2 gap-2">
        <Input
          :model-value="form.type" type="select"
          :options="['syslog', 'webhook', 's3', 'nfs', 'sftp'].map((t) => ({ value: t, label: t.toUpperCase() }))"
          label="Type" @update:model-value="form.type = $event as string"
        />
        <Input
          :model-value="form.format" type="select"
          :options="[{ value: 'json', label: 'JSON' }, { value: 'cef', label: 'CEF (SIEM)' }]"
          label="Format" @update:model-value="form.format = $event as string"
        />
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

      <label class="flex items-center gap-2 text-sm text-gray-700 pt-1"><input type="checkbox" v-model="form.enabled" /> Enabled</label>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" :disabled="!form.name" @click="save">{{ destination ? "Save changes" : "Create destination" }}</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>
