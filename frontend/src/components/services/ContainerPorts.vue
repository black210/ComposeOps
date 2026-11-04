<template>
  <div class="mt-1 flex flex-wrap gap-1.5 text-[11px]" :aria-label="`${container.name} 端口`">
    <template v-if="ports.length">
      <component :is="port.url ? 'a' : 'span'" v-for="port in ports" :key="port.key"
                 class="count-badge font-mono" :class="{ 'text-accent hover:underline': port.url }"
                 :href="port.url || undefined" :target="port.url ? '_blank' : undefined" :rel="port.url ? 'noopener noreferrer' : undefined"
                 :title="port.host ? '镜像声明的主机网络端口，实际监听以应用配置为准' : port.url ? `打开 ${port.url}` : '宿主端口 → 容器端口'">
        <template v-if="port.host">{{ port.public }}/{{ port.type }} · 主机网络（声明）</template>
        <template v-else>{{ port.public }} → {{ port.private }}/{{ port.type }}</template>
      </component>
    </template>
    <span v-else class="text-surface-500">{{ container.networkMode === 'host' ? '主机网络 · 无端口映射' : '未发布宿主端口' }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ container: { type: Object, required: true }, links: { type: Array, default: () => [] } });
const ports = computed(() => {
  const result = new Map();
  const host = props.container.networkMode === 'host';
  const source = host ? (props.container.hostPorts || []).map(({ port, type }) => ({ private: port, public: port, type })) : props.container.ports || [];
  for (const port of source) {
    if (!Number(port.public)) continue;
    const type = port.type || 'tcp';
    const key = `${port.public}:${port.private}/${type}`;
    const link = type === 'tcp' ? props.links.find((link) => link.port === Number(port.public)) : null;
    result.set(key, { ...port, type, key, host, url: link?.url });
  }
  return [...result.values()];
});
</script>
