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
      <div class="credential-toolbar">
        <div class="credential-view-switch" role="group" aria-label="账号密码显示方式">
          <button :class="{ active: view === 'pairs' }" :aria-pressed="view === 'pairs'" :disabled="saving" @click="setView('pairs')"><List class="h-3.5 w-3.5" />键值对</button>
          <button :class="{ active: view === 'form' }" :aria-pressed="view === 'form'" :disabled="saving" @click="setView('form')"><PanelsTopLeft class="h-3.5 w-3.5" />表单</button>
        </div>
        <span class="credential-count">{{ entries.length }} 组账号 · 点击右侧图标复制</span>
      </div>
      <div class="credential-editor" :class="`credential-editor--${view}`">
        <div v-if="view === 'pairs' && entries.length" class="credential-columns" aria-hidden="true"><span>应用 / 服务</span><span>账号</span><span>密码 / 密钥</span><span></span></div>
        <div v-for="(entry, index) in entries" :key="entry.uid" class="credential-entry">
          <span class="credential-entry__label">第 {{ index + 1 }} 组</span>
          <div v-for="field in fields" :key="field.key" class="credential-field">
            <label :for="`${serviceListId}-${entry.uid}-${field.key}`" class="credential-field__label">{{ field.label }}</label>
            <div class="credential-field__control">
              <input :id="`${serviceListId}-${entry.uid}-${field.key}`" v-model="entry[field.key]" class="input credential-field__input"
                     :aria-label="`第 ${index + 1} 组${field.shortLabel}`" :list="field.key === 'service' ? serviceListId : undefined"
                     :type="field.key === 'password' && !entry.revealed ? 'password' : 'text'" :autocomplete="field.key === 'password' ? 'new-password' : 'off'"
                     spellcheck="false" :maxlength="field.maxLength" :placeholder="field.placeholder" :disabled="saving" />
              <button v-if="field.key === 'password'" class="icon-btn credential-field__button" :aria-label="`${entry.revealed ? '隐藏' : '显示'}第 ${index + 1} 组密码`"
                      :title="entry.revealed ? '隐藏密码' : '显示密码'" :aria-pressed="entry.revealed" @click="entry.revealed = !entry.revealed">
                <EyeOff v-if="entry.revealed" class="h-3.5 w-3.5" /><Eye v-else class="h-3.5 w-3.5" />
              </button>
              <button class="icon-btn credential-field__button" :class="{ 'credential-field__button--copied': copied === `${entry.uid}:${field.key}` }"
                      :aria-label="`复制第 ${index + 1} 组${field.shortLabel}`" :title="copied === `${entry.uid}:${field.key}` ? '已复制' : `复制${field.shortLabel}`"
                      :disabled="!entry[field.key]" @click="copyValue(entry, field)">
                <Check v-if="copied === `${entry.uid}:${field.key}`" class="h-3.5 w-3.5" /><Copy v-else class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <button class="icon-btn credential-entry__remove" :aria-label="`删除第 ${index + 1} 组`" title="删除这组账号" :disabled="saving" @click="entries.splice(index, 1)"><Trash2 class="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <span class="sr-only" role="status" aria-live="polite">{{ copyStatus }}</span>
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
import { Check, Copy, Eye, EyeOff, List, PanelsTopLeft, Plus, Save, Trash2 } from 'lucide-vue-next';
import BaseModal from '../common/BaseModal.vue';
import ConfirmDialog from '../common/ConfirmDialog.vue';
import { api } from '../../api/client.js';
import { useToastStore } from '../../stores/toast.js';
import { copyCredentialValue } from '../../lib/credential-clipboard.js';

const props = defineProps({ project: { type: Object, required: true }, title: { type: String, default: '' },
  sizeClass: { type: String, default: 'max-w-[calc(100vw-1.5rem)] sm:max-w-2xl max-h-[88vh] flex flex-col' } });
const emit = defineEmits(['close']);
const toast = useToastStore();
const entries = ref([]);
const view = ref('pairs');
const copied = ref('');
const copyStatus = ref('');
let copyTimer;
const fields = [
  { key: 'service', label: '应用 / 服务', shortLabel: '应用', maxLength: 128, placeholder: '应用名称（可选）' },
  { key: 'username', label: '账号', shortLabel: '账号', maxLength: 512, placeholder: '账号' },
  { key: 'password', label: '密码 / 密钥', shortLabel: '密码', maxLength: 8192, placeholder: '密码或密钥' },
];
function setView(value) {
  view.value = value;
  entries.value.forEach(entry => { entry.revealed = false; });
}
async function copyValue(entry, field) {
  try {
    await copyCredentialValue(entry[field.key]);
    if (disposed) return;
    copied.value = `${entry.uid}:${field.key}`;
    copyStatus.value = `${field.shortLabel}已复制`;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied.value = ''; copyStatus.value = ''; }, 1800);
  } catch {
    if (!disposed) toast.error('复制失败，请选中内容手动复制');
  }
}
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
  if (switchBlocked.value) return Promise.resolve(false);
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
const switchBlocked = computed(() => loading.value || saving.value || discard.value);
defineExpose({ requestLeave, switchBlocked });
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
  clearTimeout(copyTimer);
  cancelDiscard();
  entries.value = [];
  baseline.value = '[]';
  window.removeEventListener('composeops:host-changed', hostChanged);
});
load();
</script>

<style scoped>
.credential-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.credential-view-switch { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid rgba(var(--ui-line-rgb), .23); border-radius: 7px; background: rgba(var(--ui-line-rgb), .045); }
.credential-view-switch > button { display: flex; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 4px; color: var(--text-faint); font-size: 11px; }
.credential-view-switch > button.active { color: var(--ui-link); background: rgb(var(--ui-panel-rgb)); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.credential-view-switch > button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.credential-count { color: var(--text-faint); font-size: 10px; }
.credential-editor--pairs { border: 1px solid rgba(var(--ui-line-rgb), .23); border-radius: 8px; }
.credential-editor--pairs:empty { display: none; }
.credential-columns, .credential-editor--pairs .credential-entry { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1fr) minmax(0, 1.4fr) 28px; align-items: center; gap: 10px; padding: 9px 10px; }
.credential-columns { background: rgba(var(--ui-line-rgb), .045); color: var(--text-faint); font-size: 10px; border-radius: 8px 8px 0 0; }
.credential-editor--pairs .credential-entry { border-top: 1px solid rgba(var(--ui-line-rgb), .19); }
.credential-editor--pairs .credential-entry:hover { background: rgba(var(--ui-line-rgb), .025); }
.credential-editor--pairs .credential-field__label, .credential-editor--pairs .credential-entry__label { display: none; }
.credential-field { min-width: 0; }
.credential-field__control { display: flex; min-width: 0; align-items: center; gap: 0; border: 1px solid rgba(var(--ui-line-rgb), .26); border-radius: 5px; background: rgb(var(--ui-panel-rgb)); }
.credential-field__control:focus-within { border-color: var(--color-accent); box-shadow: 0 0 0 2px rgba(37,99,235,.08); }
.credential-field__input.input { flex: 1; width: 100%; min-width: 0; min-height: 32px; padding: 5px 7px; border: 0; border-radius: 5px; outline: none; background: transparent; color: var(--text-bright); font-family: var(--font-mono); font-size: 11px; box-shadow: none; }
.credential-field__button.icon-btn { flex-shrink: 0; width: 26px; height: 28px; margin-right: 2px; border-radius: 4px; color: var(--text-faint); }
.credential-field__button:hover { color: var(--ui-link); }
.credential-field__button--copied.icon-btn { color: var(--color-emerald-300); }
.credential-entry__remove.icon-btn { width: 28px; height: 28px; color: var(--text-faint); }
.credential-entry__remove:hover { color: var(--color-rose-400); }
.credential-field__button:focus-visible, .credential-entry__remove:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }
.credential-editor--form { display: grid; gap: 12px; }
.credential-editor--form .credential-entry { position: relative; display: grid; gap: 12px; padding: 13px; border: 1px solid rgba(var(--ui-line-rgb), .23); border-radius: 8px; }
.credential-entry__label { color: var(--text-faint); font-size: 11px; line-height: 24px; }
.credential-field__label { display: block; margin-bottom: 5px; color: var(--text-soft); font-size: 11px; }
.credential-editor--form .credential-entry__remove { position: absolute; top: 10px; right: 10px; }
@media (max-width: 639px) {
  .credential-columns { display: none; }
  .credential-editor--pairs .credential-entry { position: relative; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 12px; }
  .credential-editor--pairs .credential-entry:first-child { border-top: 0; }
  .credential-editor--pairs .credential-field__label, .credential-editor--pairs .credential-entry__label { display: block; }
  .credential-editor--pairs .credential-entry__remove { position: absolute; top: 10px; right: 10px; }
  .credential-field__button.icon-btn { width: 32px; height: 32px; }
  .credential-field__input.input { min-height: 36px; font-size: 12px; }
}
</style>
