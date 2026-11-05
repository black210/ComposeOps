import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ServiceProjectCard from '../src/components/services/ServiceProjectCard.vue';

vi.mock('../src/api/client.js', () => ({
  api: { getProjectUpdates: vi.fn().mockResolvedValue({}), getProjectWebUi: vi.fn().mockResolvedValue({ links: [] }), getProjectEnv: vi.fn().mockResolvedValue({}), getComposeFile: vi.fn().mockResolvedValue({ content: 'services: {}' }) },
  streamProjectStats: vi.fn().mockResolvedValue(),
}));
let wrapper;
afterEach(() => wrapper?.unmount());
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
    expect(wrapper.text()).toContain('启动整组');
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
  it('未纳管或执行中禁用单容器按钮，状态变化后切换为停止', async () => {
    render({ busy: true });
    expect(wrapper.get('[aria-label="启动 tao-sync"]').element.disabled).toBe(true);
    await wrapper.setProps({ busy: false, project: { ...project, managed: false } });
    expect(wrapper.get('[aria-label="启动 tao-sync"]').element.disabled).toBe(true);
    await wrapper.setProps({ project: { ...project, containers: [{ ...target, state: 'running' }, other] } });
    await flushPromises();
    expect(wrapper.find('[aria-label="启动 tao-sync"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="停止 tao-sync"]').element.disabled).toBe(false);
  });
});
