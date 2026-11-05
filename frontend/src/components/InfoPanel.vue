<template>
  <div class="info-panel" :class="[type, { dismissible }]">
    <div class="panel-icon">
      <svg v-if="type === 'warning'" class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <svg v-else-if="type === 'info'" class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <svg v-else-if="type === 'success'" class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <svg v-else-if="type === 'error'" class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
    <div class="panel-content">
      <h4 v-if="title" class="panel-title">{{ title }}</h4>
      <p class="panel-message">{{ message }}</p>
      <div v-if="$slots.actions" class="panel-actions">
        <slot name="actions"></slot>
      </div>
    </div>
    <button v-if="dismissible" class="panel-close" @click="$emit('dismiss')" aria-label="关闭">
      <svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>

<script setup>
defineProps({
  type: { type: String, default: 'info', validator: (v) => ['info', 'warning', 'success', 'error'].includes(v) },
  title: { type: String, default: '' },
  message: { type: String, required: true },
  dismissible: { type: Boolean, default: false }
});
defineEmits(['dismiss']);
</script>

<style scoped>
.info-panel {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-radius: 0.75rem;
  border: 1px solid;
  position: relative;
}

.info-panel.info {
  background: rgb(14 165 233 / 0.08);
  border-color: rgb(14 165 233 / 0.2);
  color: var(--cyan-strong);
}

.info-panel.warning {
  background: rgb(251 191 36 / 0.08);
  border-color: rgb(251 191 36 / 0.2);
  color: var(--warn);
}

.info-panel.success {
  background: rgb(34 197 94 / 0.08);
  border-color: rgb(34 197 94 / 0.2);
  color: var(--ok);
}

.info-panel.error {
  background: rgb(239 68 68 / 0.08);
  border-color: rgb(239 68 68 / 0.2);
  color: var(--danger);
}

.info-panel.dismissible {
  padding-right: 3rem;
}

.panel-icon {
  flex-shrink: 0;
  margin-top: 0.125rem;
}

.panel-icon .icon {
  width: 1.5rem;
  height: 1.5rem;
}

.panel-content {
  flex: 1;
  min-width: 0;
}

.panel-title {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0 0 0.375rem 0;
  letter-spacing: -0.01em;
}

.panel-message {
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0;
  opacity: 0.9;
}

.panel-actions {
  margin-top: 0.875rem;
  display: flex;
  gap: 0.625rem;
}

.panel-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  padding: 0.25rem;
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
  color: currentColor;
}

.panel-close:hover {
  opacity: 1;
}

.panel-close .icon {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
