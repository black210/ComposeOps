import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyCredentialValue } from '../src/lib/credential-clipboard.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.execCommand;
  document.body.innerHTML = '';
});

describe('凭据复制', () => {
  it('HTTPS 优先使用 Clipboard API，准确保留空格换行', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await copyCredentialValue(' secret\nvalue ');
    expect(writeText).toHaveBeenCalledWith(' secret\nvalue ');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('HTTP 回退复制，恢复焦点和选区并销毁临时明文节点', async () => {
    vi.stubGlobal('navigator', {});
    const input = document.createElement('input');
    input.value = 'admin';
    document.body.append(input);
    input.focus();
    input.setSelectionRange(1, 3);
    document.execCommand = vi.fn(() => {
      expect(document.activeElement.value).toBe(' password with spaces ');
      return true;
    });
    await copyCredentialValue(' password with spaces ');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  });

  it('Clipboard API 拒绝后仍可回退复制，失败时也清理明文', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    document.execCommand = vi.fn().mockReturnValue(false);
    await expect(copyCredentialValue('do-not-retain')).rejects.toThrow('clipboard_unavailable');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.body.textContent).not.toContain('do-not-retain');
  });
});
