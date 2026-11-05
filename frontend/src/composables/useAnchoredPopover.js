import { ref, watch } from 'vue';

/** Teleported popovers use viewport coordinates, outside the header's filter context. */
export function useAnchoredPopover(open, trigger, width = 288) {
  const style = ref({});
  function position() {
    const rect = trigger.value?.getBoundingClientRect();
    if (!rect) return;
    const actualWidth = Math.min(width, window.innerWidth - 24);
    const top = rect.bottom + 8;
    style.value = {
      width: `${actualWidth}px`,
      left: `${Math.max(12, Math.min(rect.right - actualWidth, window.innerWidth - actualWidth - 12))}px`,
      top: `${top}px`,
      maxHeight: `${Math.max(0, window.innerHeight - top - 12)}px`,
    };
  }
  watch(open, (visible, _previous, cleanup) => {
    if (!visible) return;
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    cleanup(() => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    });
  });
  return style;
}
