/** 支持 NAS 的 HTTP 入口；临时复制节点在 finally 中销毁，不保存凭据。 */
export async function copyCredentialValue(value) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return; } catch { /* 转入 HTTP 兼容路径 */ }
  }
  const previous = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const inputSelection = previous instanceof HTMLInputElement || previous instanceof HTMLTextAreaElement
    ? { start: previous.selectionStart, end: previous.selectionEnd, direction: previous.selectionDirection } : null;
  const temporary = document.createElement('textarea');
  temporary.value = value;
  temporary.readOnly = true;
  temporary.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
  document.body.append(temporary);
  try {
    temporary.focus({ preventScroll: true });
    temporary.select();
    if (!document.execCommand('copy')) throw new Error('clipboard_unavailable');
  } finally {
    temporary.value = '';
    temporary.remove();
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    if (inputSelection?.start != null) previous.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction);
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
}
