import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { api } from '../src/api/client.js';
import ServiceProjectCard from '../src/components/services/ServiceProjectCard.vue';

vi.mock('../src/api/client.js', () => ({
  api: { saveProjectPreference: vi.fn().mockResolvedValue({}), getProjectUpdates: vi.fn().mockResolvedValue({}), getProjectWebUi: vi.fn().mockResolvedValue({ links: [] }), getProjectEnv: vi.fn().mockResolvedValue({}), getComposeFile: vi.fn().mockResolvedValue({ content: 'services: {}' }) },
  streamProjectStats: vi.fn().mockResolvedValue(),
}));
let wrapper;
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); });
const target = { id: 'target', name: 'tao-sync', state: 'exited', image: 'sync', ports: [] };
const other = { id: 'other', name: 'openlist', state: 'running', image: 'web', ports: [] };
const project = { id: 'p', projectName: 'file_transfer', managed: true, editable: true, containers: [target, other] };
function render(props = {}) {
  wrapper = mount(ServiceProjectCard, { props: { project, expanded: true, ...props }, global: { stubs: { RouterLink: { template: '<a><slot /></a>' }, ConfirmDialog: { props: ['show', 'message'], template: '<div v-if="show" role="dialog"><p>{{ message }}</p><button @click="$emit(\'confirm\')">确认</button><button @click="$emit(\'cancel\')">取消</button></div>' } } } });
  return wrapper;
}
describe('服务页单个容器启停', () => {
  it('整组和单容器操作分开，精确传递目标容器', async () => {
    render();
    await wrapper.get('[aria-label="启动 tao-sync"]').trigger('click');
    expect(wrapper.emitted('container-action')).toEqual([[{ container: target, action: 'up' }]]);
    expect(wrapper.emitted('action')).toBeUndefined();
    await wrapper.get('[aria-label="重启 openlist"]').trigger('click');
    expect(wrapper.emitted('container-action')[1]).toEqual([{ container: other, action: 'restart' }]);
    await wrapper.find('.svc-card__lifecycle button').trigger('click');
    expect(wrapper.emitted('action')).toEqual([['up']]);
    expect(wrapper.get('.svc-card__lifecycle').text()).toBe('启动重启停止重建');
    await wrapper.findAll('.svc-card__lifecycle button')[3].trigger('click');
    expect(wrapper.emitted('rebuild')).toEqual([[]]);
  });
  it('停止需确认，取消不发请求，确认仅包含目标容器', async () => {
    render();
    await wrapper.get('[aria-label="停止 openlist"]').trigger('click');
    expect(wrapper.emitted('container-action')).toBeUndefined();
    expect(wrapper.get('[role="dialog"]').text()).toContain('同组其他容器将继续运行');
    await wrapper.get('[role="dialog"] button:last-child').trigger('click');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    await wrapper.get('[aria-label="停止 openlist"]').trigger('click');
    await wrapper.get('[role="dialog"] button').trigger('click');
    expect(wrapper.emitted('container-action')).toEqual([[{ container: other, action: 'stop' }]]);
  });
  it('仅执行中禁用单容器按钮，旧纳管标志不再影响操作', async () => {
    render({ busy: true });
    expect(wrapper.get('[aria-label="启动 tao-sync"]').element.disabled).toBe(true);
    await wrapper.setProps({ busy: false, project: { ...project, managed: false } });
    expect(wrapper.get('[aria-label="启动 tao-sync"]').element.disabled).toBe(false);
    await wrapper.setProps({ project: { ...project, containers: [{ ...target, state: 'running' }, other] } });
    await flushPromises();
    expect(wrapper.find('[aria-label="启动 tao-sync"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="停止 tao-sync"]').element.disabled).toBe(false);
  });
  it('最近启动时间使用真实启动时间，镜像明确显示为实际运行引用', async () => {
    const current = Date.now();
    render({ project: { ...project, containers: [{ ...other, created: Math.floor((current - 6 * 86400000) / 1000), startedAt: current - 60000, image: 'astrbot:v4.29.3@sha256:original' }] } });
    expect(wrapper.get('.svc-container__uptime').text()).toContain('1 分钟前启动');
    expect(wrapper.get('.svc-card__runtime').text()).toContain('1 分钟前启动');
    expect(wrapper.get('.svc-container__image').text()).toContain('运行镜像 · astrbot:v4.29.3');
    expect(wrapper.get('.svc-card__lifecycle button:nth-child(2)').attributes('title')).toContain('沿用当前镜像');
    await wrapper.setProps({ project: { ...project, containers: [{ ...other, created: 1, startedAt: null }] } });
    expect(wrapper.find('.svc-container__uptime').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('天前启动');
  });
});


describe('项目备注标签', () => {
  it('有备注时替代旧纳管标签，没有备注时不占位', async () => {
    render({ project: { ...project, note: '文件同步与存储' } });
    expect(wrapper.get('.svc-card__remark').text()).toBe('文件同步与存储');
    expect(wrapper.get('.svc-card__remark').attributes('title')).toBe('文件同步与存储');
    expect(wrapper.text()).not.toMatch(/已纳管|未纳管/);
    await wrapper.setProps({ project: { ...project, note: '  ' } });
    expect(wrapper.find('.svc-card__remark').exists()).toBe(false);
  });
  it('保存成功才更新标签，保存失败保留原备注并显示错误', async () => {
    const data = { ...project, note: '原备注' };
    render({ project: data });
    vi.spyOn(window, 'prompt').mockReturnValue('新备注');
    api.saveProjectPreference.mockResolvedValueOnce({});
    await wrapper.get('[aria-label="编辑备注"]').trigger('click'); await flushPromises();
    expect(wrapper.get('.svc-card__remark').text()).toBe('新备注');
    expect(wrapper.emitted('refresh')).toEqual([[true]]);
    api.saveProjectPreference.mockRejectedValueOnce(new Error('保存失败，请重试'));
    await wrapper.get('[aria-label="编辑备注"]').trigger('click'); await flushPromises();
    expect(data.note).toBe('新备注');
    expect(wrapper.get('[role="alert"]').text()).toContain('保存失败');
  });
});
