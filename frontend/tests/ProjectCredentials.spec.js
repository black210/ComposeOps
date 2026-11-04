import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import ProjectCredentialsModal from '../src/components/services/ProjectCredentialsModal.vue';
import ServiceProjectCard from '../src/components/services/ServiceProjectCard.vue';
import { useToastStore } from '../src/stores/toast.js';

const { api, copyCredentialValue } = vi.hoisted(() => ({ api: { getProjectCredentials: vi.fn(), saveProjectCredentials: vi.fn(), getProjectWebUi: vi.fn(), getProjectUpdates: vi.fn() }, copyCredentialValue: vi.fn() }));
vi.mock('../src/api/client.js', () => ({ api, streamProjectStats: vi.fn() }));
vi.mock('../src/lib/credential-clipboard.js', () => ({ copyCredentialValue }));
const project = { id: 'project-a', projectName: 'file_transfer', status: 'running', managed: true, editable: false,
  containers: [{ id: 'app-a', name: 'openlist', state: 'running', image: 'openlist:latest', ports: [] }] };
let wrapper;
let pinia;
const button = text => wrapper.findAll('button').find(item => item.text() === text);
beforeEach(() => {
  vi.clearAllMocks();
  pinia = createPinia();
  api.getProjectCredentials.mockResolvedValue({ hostId: 'local', revision: 3, entries: [{ service: 'openlist', username: 'admin', password: 'sample-secret' }] });
  api.saveProjectCredentials.mockResolvedValue({ ok: true, revision: 4 });
  api.getProjectWebUi.mockResolvedValue({ links: [] });
  api.getProjectUpdates.mockResolvedValue({});
  copyCredentialValue.mockResolvedValue(undefined);
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; });
async function start(component = ProjectCredentialsModal, props = {}) {
  wrapper = mount(component, { props: { project, ...props }, global: { plugins: [pinia], stubs: { teleport: true, 'router-link': { template: '<a><slot /></a>' } } } });
  await flushPromises();
}

describe('账号密码维护', () => {
  it('钥匙直达账号密码、工具栏进入环境变量，卡片本身不读取凭据', async () => {
    await start(ServiceProjectCard, { expanded: true });
    expect(api.getProjectCredentials).not.toHaveBeenCalled();
    await wrapper.get('[aria-label="管理账号密码"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('credentials')).toHaveLength(1);
    expect(wrapper.emitted('env')).toBeUndefined();
    await wrapper.findAll('button').find(item => item.text() === '环境与密钥').trigger('click');
    expect(wrapper.emitted('env')).toHaveLength(1);
    expect(api.getProjectCredentials).not.toHaveBeenCalled();
  });

  it('默认键值对模式，切换表单保留修改并重新隐藏密码', async () => {
    await start();
    expect(button('键值对').attributes('aria-pressed')).toBe('true');
    await wrapper.get('[aria-label="第 1 组账号"]').setValue('edited-user');
    await wrapper.get('[aria-label="显示第 1 组密码"]').trigger('click');
    await button('表单').trigger('click');
    expect(wrapper.get('[aria-label="第 1 组账号"]').element.value).toBe('edited-user');
    expect(wrapper.get('[aria-label="第 1 组密码"]').attributes('type')).toBe('password');
    await button('键值对').trigger('click');
    expect(wrapper.get('[aria-label="第 1 组账号"]').element.value).toBe('edited-user');
    expect(api.saveProjectCredentials).not.toHaveBeenCalled();
  });

  it('分别复制当前应用、账号和被隐藏的完整密码，反馈不包含秘密', async () => {
    await start();
    await wrapper.get('[aria-label="第 1 组密码"]').setValue(' full-secret-with-spaces ');
    for (const name of ['应用', '账号', '密码']) {
      await wrapper.get(`[aria-label="复制第 1 组${name}"]`).trigger('click');
      await flushPromises();
    }
    expect(copyCredentialValue.mock.calls).toEqual([['openlist'], ['admin'], [' full-secret-with-spaces ']]);
    expect(wrapper.get('[aria-label="第 1 组密码"]').attributes('type')).toBe('password');
    expect(wrapper.text()).toContain('密码已复制');
    expect(wrapper.text()).not.toContain('full-secret-with-spaces');
    expect(wrapper.get('[aria-label="复制第 1 组密码"]').attributes('title')).toBe('已复制');
  });

  it('复制失败提示手动复制，空值禁用复制按钮', async () => {
    copyCredentialValue.mockRejectedValueOnce(new Error('clipboard_unavailable'));
    await start();
    await wrapper.get('[aria-label="复制第 1 组密码"]').trigger('click');
    await flushPromises();
    expect(useToastStore(pinia).items.some(item => item.message.includes('手动复制'))).toBe(true);
    await wrapper.get('[aria-label="第 1 组账号"]').setValue('');
    expect(wrapper.get('[aria-label="复制第 1 组账号"]').attributes('disabled')).toBeDefined();
  });

  it('默认隐藏密码，保存携带节点及版本，且支持多组账号', async () => {
    await start();
    expect(wrapper.get('[aria-label="第 1 组密码"]').attributes('type')).toBe('password');
    await wrapper.get('[aria-label="显示第 1 组密码"]').trigger('click');
    expect(wrapper.get('[aria-label="第 1 组密码"]').attributes('type')).toBe('text');
    await button('新增账号').trigger('click');
    await wrapper.get('[aria-label="第 2 组账号"]').setValue('operator');
    await wrapper.get('[aria-label="第 2 组密码"]').setValue(' second-password ');
    await button('保存').trigger('click');
    await flushPromises();
    expect(api.saveProjectCredentials).toHaveBeenCalledWith('project-a', { hostId: 'local', revision: 3, entries: [
      { service: 'openlist', username: 'admin', password: 'sample-secret' },
      { service: 'openlist', username: 'operator', password: ' second-password ' },
    ] });
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('读取失败时禁止保存，重试成功后才开放编辑', async () => {
    api.getProjectCredentials.mockRejectedValueOnce(new Error('network unavailable'));
    await start();
    expect(wrapper.get('[role="alert"]').text()).toContain('读取失败');
    expect(button('保存').attributes('disabled')).toBeDefined();
    expect(api.saveProjectCredentials).not.toHaveBeenCalled();
    await button('重试').trigger('click');
    await flushPromises();
    expect(wrapper.get('[aria-label="第 1 组账号"]').element.value).toBe('admin');
  });

  it('版本冲突保留输入，删除全部账号后可保存空列表', async () => {
    api.saveProjectCredentials.mockRejectedValueOnce(new Error('账号密码已被其他页面修改'));
    await start();
    await wrapper.get('[aria-label="第 1 组账号"]').setValue('edited');
    await button('保存').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.get('[aria-label="第 1 组账号"]').element.value).toBe('edited');
    expect(useToastStore(pinia).items.some(item => item.message.includes('其他页面修改'))).toBe(true);
    await wrapper.get('[aria-label="删除第 1 组"]').trigger('click');
    await button('保存').trigger('click');
    await flushPromises();
    expect(api.saveProjectCredentials).toHaveBeenLastCalledWith('project-a', { hostId: 'local', revision: 3, entries: [] });
  });

  it('未保存修改关闭前提示，节点切换时关闭凭据窗口', async () => {
    await start();
    await wrapper.get('[aria-label="第 1 组账号"]').setValue('edited');
    await button('取消').trigger('click');
    expect(wrapper.text()).toContain('放弃未保存的账号密码');
    expect(wrapper.emitted('close')).toBeUndefined();
    window.dispatchEvent(new CustomEvent('composeops:host-changed'));
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
