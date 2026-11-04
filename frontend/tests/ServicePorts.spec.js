import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import WebUiLauncher from '../src/components/services/WebUiLauncher.vue';
import ContainerPorts from '../src/components/services/ContainerPorts.vue';

describe('多应用端口展示', () => {
  it('各应用直接显示全部入口，相同端口不会跨应用合并', () => {
    const wrapper = mount(WebUiLauncher, { props: { links: [
      { containerId: 'a', containerName: 'web', port: 8080, url: 'http://example.test:8080' },
      { containerId: 'a', containerName: 'web', port: 18081, url: 'http://example.test:18081' },
      { containerId: 'b', containerName: 'sync', port: 8080, url: 'http://example.test:8080' },
    ] } });
    expect(wrapper.findAll('a')).toHaveLength(3);
    expect(wrapper.text()).toContain('web');
    expect(wrapper.text()).toContain('sync');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });
  it('映射去重并保留 TCP/UDP 差异，只有 Web TCP 链接可点击', () => {
    const wrapper = mount(ContainerPorts, { props: {
      container: { name: 'openlist', ports: [
        { public: 5244, private: 5244, type: 'tcp', ip: '0.0.0.0' },
        { public: 5244, private: 5244, type: 'tcp', ip: '::' },
        { public: 5244, private: 5244, type: 'udp' },
        { public: 15432, private: 5432, type: 'tcp' },
      ] }, links: [{ port: 5244, url: 'http://example.test:5244' }],
    } });
    expect(wrapper.findAll('.count-badge')).toHaveLength(3);
    expect(wrapper.findAll('a')).toHaveLength(1);
    expect(wrapper.text()).toContain('15432 → 5432/tcp');
    expect(wrapper.text()).toContain('5244 → 5244/udp');
  });
  it('无映射端口明确显示原因，主机网络不猜测端口', () => {
    const wrapper = mount(ContainerPorts, { props: { container: { name: 'sync', networkMode: 'host', ports: [] } } });
    expect(wrapper.text()).toBe('主机网络 · 无端口映射');
    expect(wrapper.findAll('a')).toHaveLength(0);
  });
  it('主机网络展示镜像声明的端口和候选入口，并标明来源', () => {
    const wrapper = mount(ContainerPorts, { props: { container: { name: 'tao-sync', networkMode: 'host', ports: [], hostPorts: [{ port: 8023, type: 'tcp' }] }, links: [{ port: 8023, url: 'http://example.test:8023' }] } });
    expect(wrapper.text()).toContain('8023/tcp');
    expect(wrapper.text()).toContain('主机网络（声明）');
    expect(wrapper.get('a').attributes('href')).toBe('http://example.test:8023');
  });
});
