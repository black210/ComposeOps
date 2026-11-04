<template>
  <div v-if="links.length" class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2" aria-label="各应用访问入口">
    <div v-for="group in groups" :key="group.id" class="flex min-w-0 flex-wrap items-center gap-1.5">
      <span class="max-w-48 truncate font-mono text-xs text-surface-400" :title="group.name">{{ group.name }}</span>
      <a v-for="link in group.links" :key="link.port" :href="link.url" target="_blank" rel="noopener noreferrer"
         class="webui-badge" :title="`打开 ${group.name} (${link.url})`">
        <Globe class="h-3.5 w-3.5" />{{ link.port }}
      </a>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Globe } from 'lucide-vue-next';
const props = defineProps({ links: { type: Array, default: () => [] } });
const groups = computed(() => {
  const result = new Map();
  for (const link of props.links) {
    const id = link.containerId || link.containerName;
    if (!result.has(id)) result.set(id, { id, name: link.serviceName || link.containerName, links: [] });
    const group = result.get(id);
    if (!group.links.some((item) => item.port === link.port)) group.links.push(link);
  }
  return [...result.values()];
});
</script>
