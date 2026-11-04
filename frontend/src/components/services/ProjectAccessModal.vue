<template>
  <component :is="activeTab === 'env' ? ProjectEnvModal : ProjectCredentialsModal" ref="panel" :project="project"
             :title="`${project.projectName} · 环境与密钥`"
             size-class="flex max-h-[86vh] max-w-[calc(100vw-1.5rem)] flex-col sm:max-w-3xl"
             @close="emit('close')" @refresh="emit('refresh')" @apply="emit('apply', $event)">
    <template #navigation>
      <div class="access-navigation" role="group" aria-label="环境与密钥页签">
        <button :class="{ active: activeTab === 'env' }" :aria-pressed="activeTab === 'env'" :disabled="switching || !project.editable"
                :title="project.editable ? '编辑项目环境变量文件' : '请先启用项目的 Compose 目录能力'" @click="switchTab('env')"><SlidersHorizontal class="h-4 w-4" />环境变量</button>
        <button :class="{ active: activeTab === 'credentials' }" :aria-pressed="activeTab === 'credentials'" :disabled="switching" @click="switchTab('credentials')"><KeyRound class="h-4 w-4" />账号密码</button>
      </div>
    </template>
  </component>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue';
import { KeyRound, SlidersHorizontal } from 'lucide-vue-next';
import ProjectEnvModal from './ProjectEnvModal.vue';
import ProjectCredentialsModal from './ProjectCredentialsModal.vue';

const props = defineProps({ project: { type: Object, required: true }, initialTab: { type: String, default: 'env' } });
const emit = defineEmits(['close', 'refresh', 'apply']);
const activeTab = ref(props.initialTab === 'env' && props.project.editable ? 'env' : 'credentials');
const panel = ref(null);
const switching = ref(false);
let disposed = false;
async function switchTab(tab) {
  if (switching.value || activeTab.value === tab || (tab === 'env' && !props.project.editable)) return;
  switching.value = true;
  try {
    if (await panel.value?.requestLeave() && !disposed) activeTab.value = tab;
  } finally { if (!disposed) switching.value = false; }
}
function hostChanged() { if (activeTab.value === 'env') emit('close'); }
window.addEventListener('composeops:host-changed', hostChanged);
onBeforeUnmount(() => { disposed = true; window.removeEventListener('composeops:host-changed', hostChanged); });
</script>

<style scoped>
.access-navigation { display: flex; flex-shrink: 0; gap: 18px; padding: 0 16px; border-bottom: 1px solid rgba(var(--ui-line-rgb), .23); }
.access-navigation > button { display: inline-flex; align-items: center; gap: 7px; padding: 13px 2px 11px; border-bottom: 2px solid transparent; color: var(--text-faint); font-size: 12px; }
.access-navigation > button.active { border-color: var(--color-accent); color: var(--ui-link); font-weight: 500; }
.access-navigation > button:hover:not(:disabled) { color: var(--ui-link); }
.access-navigation > button:disabled { opacity: .45; cursor: not-allowed; }
.access-navigation > button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; border-radius: 4px; }
</style>
