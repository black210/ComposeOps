import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import ProjectAccessModal from '../src/components/services/ProjectAccessModal.vue';

const { api } = vi.hoisted(() => ({ api: {
  getProjectEnv: vi.fn(), getProjectEnvFiles: vi.fn(), getProjectEnvBackups: vi.fn(), saveProjectEnv: vi.fn(),
  getProjectCredentials: vi.fn(), saveProjectCredentials: vi.fn(),
} }));
vi.mock('../src/api/client.js', () => ({ api }));
const project = { id: 'combined', projectName: '示例项目', editable: true, containers: [{ name: 'web' }] };
let wrapper;
const button = text => wrapper.findAll('button').filter(item => item.text() === text).at(-1);
const tab = text => wrapper.get('[aria-label="环境与密钥页签"]').findAll('button').find(item => item.text() === text);
beforeEach(() => {
  vi.clearAllMocks();
  api.getProjectEnv.mockResolvedValue({ raw: 'TZ=Asia/Shanghai\n', file: '.env', entries: [{ key: 'TZ', value: 'Asia/Shanghai' }] });
  api.getProjectEnvFiles.mockResolvedValue({ files: [{ name: '.env', exists: true }] });
  api.getProjectEnvBackups.mockResolvedValue({ backups: [] });
  api.getProjectCredentials.mockResolvedValue({ hostId: 'local', revision: 1, entries: [{ service: 'web', username: 'admin', password: 'sample-only' }] });
  api.saveProjectEnv.mockResolvedValue({ ok: true });
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; });
async function start(props = {}) {
  wrapper = mount(ProjectAccessModal, { props: { project, ...props }, global: { plugins: [createPinia()], stubs: { teleport: true } } });
  await flushPromises();
}

describe('环境与密钥统一入口', () => {
  it('指定账号密码入口时直接显示对应页签，不加载环境变量', async () => {
    await start({ initialTab: 'credentials' });
    expect(tab('账号密码').attributes('aria-pressed')).toBe('true');
    expect(api.getProjectEnv).not.toHaveBeenCalled();
    expect(api.getProjectCredentials).toHaveBeenCalledWith('combined');
  });
  it('在同一窗口切换页签，按需读取各自的数据', async () => {
    await start();
    expect(tab('环境变量').attributes('aria-pressed')).toBe('true');
    expect(api.getProjectCredentials).not.toHaveBeenCalled();
    await tab('账号密码').trigger('click');
    await flushPromises();
    expect(tab('账号密码').attributes('aria-pressed')).toBe('true');
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1);
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('示例项目 · 环境与密钥');
    expect(wrapper.get('[aria-label="第 1 组密码"]').attributes('type')).toBe('password');
    expect(api.getProjectCredentials).toHaveBeenCalledWith('combined');
  });

  it('环境变量存在未保存修改时，取消留在原页签，确认后才切换', async () => {
    await start();
    await wrapper.get('[aria-label="TZ 变量值"]').setValue('UTC');
    await tab('账号密码').trigger('click');
    expect(wrapper.text()).toContain('切换页签会丢失这些内容');
    await button('取消').trigger('click');
    await flushPromises();
    expect(tab('环境变量').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[aria-label="TZ 变量值"]').element.value).toBe('UTC');
    expect(api.getProjectCredentials).not.toHaveBeenCalled();
    await tab('账号密码').trigger('click');
    await button('继续').trigger('click');
    await flushPromises();
    expect(tab('账号密码').attributes('aria-pressed')).toBe('true');
    expect(api.saveProjectEnv).not.toHaveBeenCalled();
  });

  it('账号密码有未保存修改时可取消切换，之后可明确放弃修改', async () => {
    await start({ initialTab: 'credentials' });
    await wrapper.get('[aria-label="第 1 组账号"]').setValue('edited');
    await tab('环境变量').trigger('click');
    expect(wrapper.text()).toContain('放弃未保存的账号密码');
    await button('取消').trigger('click');
    await flushPromises();
    expect(tab('账号密码').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[aria-label="第 1 组账号"]').element.value).toBe('edited');
    await tab('环境变量').trigger('click');
    await button('放弃修改').trigger('click');
    await flushPromises();
    expect(tab('环境变量').attributes('aria-pressed')).toBe('true');
    expect(api.saveProjectCredentials).not.toHaveBeenCalled();
  });

  it('环境变量保存期间禁止切换，保存后转发刷新事件', async () => {
    let complete;
    api.saveProjectEnv.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await start();
    await wrapper.get('[aria-label="TZ 变量值"]').setValue('UTC');
    await button('仅保存文件').trigger('click');
    expect(tab('账号密码').attributes('disabled')).toBeDefined();
    await tab('账号密码').trigger('click');
    await flushPromises();
    expect(tab('环境变量').attributes('aria-pressed')).toBe('true');
    expect(api.getProjectCredentials).not.toHaveBeenCalled();
    complete({ ok: true });
    await flushPromises();
    expect(wrapper.emitted('refresh')).toHaveLength(1);
    expect(api.saveProjectEnv).toHaveBeenCalledWith('combined', expect.objectContaining({ file: '.env', raw: expect.stringContaining('TZ=UTC') }));
  });

  it('无目录权限时仅开放账号密码，切换节点时关闭窗口', async () => {
    await start({ project: { ...project, editable: false } });
    expect(tab('环境变量').attributes('disabled')).toBeDefined();
    expect(tab('账号密码').attributes('aria-pressed')).toBe('true');
    expect(api.getProjectEnv).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent('composeops:host-changed'));
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
