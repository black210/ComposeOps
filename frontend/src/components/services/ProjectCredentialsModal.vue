<template>
  <BaseModal :show="true" :title="title || `${project.projectName} · 密钥`" :size-class="sizeClass"
             body-class="min-h-0 overflow-auto" :close-disabled="saving" @close="close">
    <slot name="navigation" />
    <div class="p-4 space-y-4">
    <p class="text-xs leading-5 text-surface-400">维护应用登录账号、密码或密钥，可按应用保存多组。这里只记录信息，不会修改应用的实际密码。</p>
    <p class="text-xs leading-5 text-surface-500">保存在面板数据库中；未启用数据库加密时为明文，请妥善保管面板数据和备份。</p>
    <p v-if="loading" role="status" class="py-6 text-center text-surface-400">正在读取账号密码…</p>
    <div v-else-if="loadError" role="alert" class="alert-warning flex items-center gap-2">
      <span class="flex-1">读取失败：{{ loadError }}</span><button class="btn-secondary" @click="load">重试</button>
    </div>
    <template v-else>
      <div v-for="(entry, index) in entries" :key="entry.uid" class="space-y-3 rounded-lg border border-surface-800 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-surface-400">第 {{ index + 1 }} 组</span>
          <button class="icon-btn" :aria-label="`删除第 ${index + 1} 组`" :disabled="saving" @click="entries.splice(index, 1)"><Trash2 class="h-4 w-4" /></button>
        </div>
        <label class="block space-y-1 text-xs text-surface-400"><span class="block">应用 / 服务</span>
          <input v-model="entry.service" class="input w-full" :aria-label="`第 ${index + 1} 组应用`" :list="serviceListId" maxlength="128" placeholder="例如 openlist（可选）" :disabled="saving" />
        </label>
        <label class="block space-y-1 text-xs text-surface-400"><span class="block">账号</span>
          <input v-model="entry.username" class="input w-full font-mono" :aria-label="`第 ${index + 1} 组账号`" autocomplete="off" spellcheck="false" maxlength="512" :disabled="saving" />
        </label>
        <div class="space-y-1 text-xs text-surface-400">
          <label :for="`${serviceListId}-${entry.uid}`">密码 / 密钥</label>
          <div class="flex items-center gap-1">
            <input :id="`${serviceListId}-${entry.uid}`" v-model="entry.password" class="input min-w-0 flex-1 font-mono" :aria-label="`第 ${index + 1} 组密码`" :type="entry.revealed ? 'text' : 'password'" autocomplete="new-password" spellcheck="false" maxlength="8192" :disabled="saving" />
            <button class="icon-btn shrink-0" :aria-label="`${entry.revealed ? '隐藏' : '显示'}第 ${index + 1} 组密码`" :aria-pressed="entry.revealed" @click="entry.revealed = !entry.revealed"><EyeOff v-if="entry.revealed" class="h-4 w-4" /><Eye v-else class="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      <datalist :id="serviceListId"><option v-for="service in services" :key="service" :value="service" /></datalist>
      <p v-if="!entries.length" class="py-5 text-center text-sm text-surface-500">尚未记录账号密码</p>
      <button class="btn-secondary" :disabled="saving || entries.length >= 50" @click="add"><Plus class="h-4 w-4" />新增账号</button>
    </template>
    </div>
    <template #footer>
      <button class="btn-ghost" :disabled="saving" @click="close">取消</button>
      <button class="btn-primary" :disabled="loading || !!loadError || saving || !dirty" @click="save"><Save class="h-4 w-4" />{{ saving ? '正在保存…' : '保存' }}</button>
    </template>
    <ConfirmDialog :show="discard" title="放弃未保存的账号密码" message="离开后，本次未保存的修改将丢失。" confirm-text="放弃修改" tone="warning" @confirm="confirmDiscard" @cancel="cancelDiscard" />
  </BaseModal>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, useId } from 'vue';
import { Eye, EyeOff, Plus, Save, Trash2 } from 'lucide-vue-next';
import BaseModal from '../common/BaseModal.vue';
import ConfirmDialog from '../common/ConfirmDialog.vue';
import { api } from '../../api/client.js';
import { useToastStore } from '../../stores/toast.js';

const props = defineProps({ project: { type: Object, required: true }, title: { type: String, default: '' },
  sizeClass: { type: String, default: 'max-w-[calc(100vw-1.5rem)] sm:max-w-2xl max-h-[88vh] flex flex-col' } });
const emit = defineEmits(['close']);
const toast = useToastStore();
const entries = ref([]);
const loading = ref(true);
const saving = ref(false);
const loadError = ref('');
const discard = ref(false);
const baseline = ref('[]');
const hostId = ref('');
const revision = ref(0);
const serviceListId = `credential-services-${useId()}`;
const services = computed(() => [...new Set(props.project.containers.map((container) => container.service || container.name))]);
const payload = () => entries.value.map(({ service, username, password }) => ({ service, username, password }));
const dirty = computed(() => JSON.stringify(payload()) !== baseline.value);
let uid = 0;
let disposed = false;
let leaveResolve = null;

function add() { entries.value.push({ uid: ++uid, service: services.value.length === 1 ? services.value[0] : '', username: '', password: '', revealed: false }); }
async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await api.getProjectCredentials(props.project.id);
    if (disposed) return;
    hostId.value = data.hostId;
    revision.value = data.revision;
    entries.value = data.entries.map((entry) => ({ ...entry, uid: ++uid, revealed: false }));
    baseline.value = JSON.stringify(payload());
  } catch (error) { if (!disposed) loadError.value = error.message; }
  finally { if (!disposed) loading.value = false; }
}
function close() {
  if (saving.value) return;
  if (dirty.value) discard.value = true;
  else emit('close');
}
function requestLeave() {
  if (loading.value || saving.value || discard.value) return Promise.resolve(false);
  if (!dirty.value) return Promise.resolve(true);
  discard.value = true;
  return new Promise(resolve => { leaveResolve = resolve; });
}
function confirmDiscard() {
  discard.value = false;
  if (leaveResolve) { const resolve = leaveResolve; leaveResolve = null; resolve(true); }
  else emit('close');
}
function cancelDiscard() { discard.value = false; leaveResolve?.(false); leaveResolve = null; }
defineExpose({ requestLeave });
async function save() {
  if (loading.value || saving.value || loadError.value) return;
  if (entries.value.some((entry) => !entry.username && !entry.password)) { toast.error('每组请填写账号或密码'); return; }
  saving.value = true;
  try {
    await api.saveProjectCredentials(props.project.id, { hostId: hostId.value, revision: revision.value, entries: payload() });
    if (disposed) return;
    toast.success('账号密码已保存');
    emit('close');
  } catch (error) { if (!disposed) toast.error(`保存失败：${error.message}`); }
  finally { if (!disposed) saving.value = false; }
}
function hostChanged() { emit('close'); }
window.addEventListener('composeops:host-changed', hostChanged);
onBeforeUnmount(() => {
  disposed = true;
  cancelDiscard();
  entries.value = [];
  baseline.value = '[]';
  window.removeEventListener('composeops:host-changed', hostChanged);
});
load();
</script>
