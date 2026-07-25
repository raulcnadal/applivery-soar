<script setup lang="ts">
// Firewall Rule Set builder — rules editor + starter templates. Saving
// auto-generates and uploads the Apply/Restore PowerShell to Applivery and
// provisions the two Action Library entries (server-side, main.py:5259-5314).
import { Alert, Button, Drawer, Input } from "@applivery/bluesky-vue";
import { reactive, ref, watch } from "vue";
import { useFirewallRuleSetsStore, type FirewallRule, type FirewallRuleSet } from "../../stores/firewallRuleSets";

const props = defineProps<{ open: boolean; ruleSet: FirewallRuleSet | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useFirewallRuleSetsStore();

function newRule(): FirewallRule {
  return { id: crypto.randomUUID(), name: "New rule", direction: "inbound", action: "block", protocol: "Any", localPorts: "Any", remoteAddresses: "Any", profile: "Any", enabled: true };
}

const form = reactive<{
  name: string; description: string; ensureFirewallEnabled: boolean;
  defaultInboundAction: string; defaultOutboundAction: string; rules: FirewallRule[];
}>({ name: "", description: "", ensureFirewallEnabled: true, defaultInboundAction: "notConfigured", defaultOutboundAction: "notConfigured", rules: [] });

const isSaving = ref(false);
const saveError = ref<string | null>(null);

watch(() => props.open, async (open) => {
  if (!open) return;
  if (store.templates.length === 0) await store.fetchTemplates();
  const r = props.ruleSet;
  Object.assign(form, {
    name: r?.name ?? "", description: r?.description ?? "", ensureFirewallEnabled: r?.ensureFirewallEnabled ?? true,
    defaultInboundAction: r?.defaultInboundAction ?? "notConfigured", defaultOutboundAction: r?.defaultOutboundAction ?? "notConfigured",
    rules: JSON.parse(JSON.stringify(r?.rules ?? [])),
  });
  saveError.value = null;
});

function applyTemplate(key: string) {
  const t = store.templates.find((tpl) => tpl.key === key);
  if (!t) return;
  Object.assign(form, {
    name: t.name, description: t.description, ensureFirewallEnabled: t.ensureFirewallEnabled,
    defaultInboundAction: t.defaultInboundAction, defaultOutboundAction: t.defaultOutboundAction,
    rules: JSON.parse(JSON.stringify(t.rules)).map((r: FirewallRule) => ({ ...r, id: crypto.randomUUID() })),
  });
}

function addRule() {
  form.rules.push(newRule());
}
function removeRule(idx: number) {
  form.rules.splice(idx, 1);
}

async function save() {
  isSaving.value = true;
  saveError.value = null;
  try {
    if (props.ruleSet) await store.updateRuleSet(props.ruleSet.id, form);
    else await store.createRuleSet(form);
    emit("saved");
    emit("close");
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || "Failed to save — could not provision the Apply/Restore scripts on Applivery.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Drawer :open="open" :title="ruleSet ? `Edit “${ruleSet.name}”` : 'New Firewall Rule Set'" width="w-[760px]" @close="emit('close')">
    <div class="space-y-6">
      <Alert v-if="saveError" type="danger">{{ saveError }}</Alert>

      <div v-if="!ruleSet && store.templates.length" class="space-y-2">
        <p class="text-xs font-semibold text-gray-700">Start from a template (optional)</p>
        <div class="flex flex-wrap gap-2">
          <Button v-for="t in store.templates" :key="t.key" size="sm" variant="ghost" @click="applyTemplate(t.key)">{{ t.name }}</Button>
        </div>
      </div>

      <div class="space-y-3">
        <Input v-model="form.name" label="Name" />
        <Input v-model="form.description" label="Description" />
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" v-model="form.ensureFirewallEnabled" /> No EDR present — ensure Windows Firewall itself is enabled when applying
        </label>
        <div class="grid grid-cols-2 gap-3">
          <Input
            :model-value="form.defaultInboundAction"
            type="select"
            :options="[{ value: 'notConfigured', label: 'Leave default inbound as-is' }, { value: 'block', label: 'Default inbound: Block' }, { value: 'allow', label: 'Default inbound: Allow' }]"
            label="Default inbound posture"
            @update:model-value="form.defaultInboundAction = $event as string"
          />
          <Input
            :model-value="form.defaultOutboundAction"
            type="select"
            :options="[{ value: 'notConfigured', label: 'Leave default outbound as-is' }, { value: 'block', label: 'Default outbound: Block' }, { value: 'allow', label: 'Default outbound: Allow' }]"
            label="Default outbound posture"
            @update:model-value="form.defaultOutboundAction = $event as string"
          />
        </div>
        <p class="text-xs text-gray-500">Changing the profile's default action (not a rule) is what makes a genuine "block everything except these exceptions" posture possible — Windows Firewall always lets an explicit Block rule beat an explicit Allow rule regardless of order.</p>
      </div>

      <section>
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm font-semibold text-gray-900">Rules</p>
          <Button size="sm" variant="secondary" @click="addRule">Add rule</Button>
        </div>
        <div class="space-y-2">
          <div v-for="(rule, idx) in form.rules" :key="rule.id || idx" class="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
            <div class="flex items-center gap-2">
              <Input v-model="rule.name" placeholder="Rule name" class="flex-1" />
              <Button size="sm" variant="ghost" @click="removeRule(idx)">✕</Button>
            </div>
            <div class="grid grid-cols-4 gap-2">
              <Input
                :model-value="rule.direction"
                type="select"
                :options="[{ value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }]"
                label="Direction"
                @update:model-value="rule.direction = $event as string"
              />
              <Input
                :model-value="rule.action"
                type="select"
                :options="[{ value: 'block', label: 'Block' }, { value: 'allow', label: 'Allow' }]"
                label="Action"
                @update:model-value="rule.action = $event as string"
              />
              <Input
                :model-value="rule.protocol"
                type="select"
                :options="['Any', 'TCP', 'UDP'].map((p) => ({ value: p, label: p }))"
                label="Protocol"
                @update:model-value="rule.protocol = $event as string"
              />
              <Input v-model="rule.localPorts" label="Local ports" placeholder="Any / 445 / 5985-5986" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <Input v-model="rule.remoteAddresses" label="Remote addresses" placeholder="Any / CIDR / comma-separated" />
              <Input
                :model-value="rule.profile"
                type="select"
                :options="['Any', 'Domain', 'Private', 'Public'].map((p) => ({ value: p, label: p }))"
                label="Profile"
                @update:model-value="rule.profile = $event as string"
              />
            </div>
            <label class="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" v-model="rule.enabled" /> Enabled
            </label>
          </div>
          <p v-if="form.rules.length === 0" class="text-xs text-gray-400">No rules yet — add at least one, or rely purely on the default posture change above.</p>
        </div>
      </section>

      <div class="flex items-center gap-2 pt-2">
        <Button :loading="isSaving" @click="save">{{ ruleSet ? "Save changes" : "Create rule set" }}</Button>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Drawer>
</template>
