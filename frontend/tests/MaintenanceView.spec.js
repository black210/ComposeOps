import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
const client = vi.hoisted(() =>
  Object.fromEntries(
    [
      'getMaintenance',
      'getSyncTargets',
      'prepareMaintenance',
      'executeMaintenance',
      'saveMaintenanceSettings',
      'saveSyncTarget',
      'setSyncAutomatic',
      'startBackupSync',
      'authorize115',
      'pollAuthorize115',
      'recoverMaintenanceTask',
      'getProjectUpdates',
      'saveImageCheckSettings',
      'testImageCheckProxy',
    ].map((k) => [k, vi.fn()])
  )
);
const router = vi.hoisted(() => ({ replace: vi.fn() }));
const route = vi.hoisted(() => ({ current: null }));
vi.mock('../src/api/client.js', () => ({ api: client }));
vi.mock('vue-router', () => ({ useRoute: () => route.current, useRouter: () => router }));
import MaintenanceView from '../src/views/MaintenanceView.vue';
let wrapper;
const id = 'a'.repeat(64);
const overview = () => ({
  hostId: 'local',
  settings: { backupPath: '/backups/apps' },
  containers: [{ id, name: 'app-web', image: 'example:1', projectName: 'app', state: 'running' }],
  tasks: [],
  backups: [],
});
const backupPlan = () => ({
  token: 'token',
  hostId: 'local',
  backupPath: '/backups/apps',
  action: 'backup',
  selected: [{ id, name: 'app-web' }],
  members: [
    { id, name: 'app-web' },
    { id: 'db', name: 'app-db' },
  ],
  sources: [{ kind: 'bind', source: '/apps/data' }],
  warnings: [],
  blockers: [],
  coverageVerified: true,
  estimatedBytes: 100,
  freeBytes: 1000,
  downtime: '停机归档',
});
beforeEach(() => {
  Object.values(client).forEach((fn) => fn.mockReset());
  router.replace.mockReset();
  route.current = reactive({ query: {} });
  client.getMaintenance.mockResolvedValue(overview());
  client.getSyncTargets.mockResolvedValue({ targets: [] });
  client.prepareMaintenance.mockResolvedValue(backupPlan());
  client.executeMaintenance.mockResolvedValue({ id: 'job' });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});
async function show() {
  wrapper = mount(MaintenanceView, {
    global: {
      stubs: {
        OperationsCenterView: true,
        BaseModal: { props: ['show'], template: '<section v-if="show"><slot /></section>' },
        ConfirmDialog: true,
      },
    },
  });
  await flushPromises();
}
const button = (text) => wrapper.findAll('button').find((b) => b.text() === text);
describe('完整备份界面的真实确认条件', () => {
  it('代理测试不会保存地址，保存后才强制重新检查', async () => {
    client.getMaintenance.mockResolvedValue({
      ...overview(),
      imageCheck: { proxyUrl: '' },
      containers: [
        { ...overview().containers[0], projectId: 'p', service: 'web', updateCheckAvailable: true },
      ],
    });
    client.getProjectUpdates.mockResolvedValue({ images: [{ service: 'web', status: 'current' }] });
    client.testImageCheckProxy.mockResolvedValue({
      ok: true,
      results: [{ name: 'Docker Hub', ok: true, milliseconds: 700 }],
    });
    client.saveImageCheckSettings.mockResolvedValue({
      proxyUrl: 'http://host.docker.internal:7890',
    });
    await show();
    await button('代理设置').trigger('click');
    await wrapper
      .get('input[aria-label="镜像检查代理地址"]')
      .setValue('http://host.docker.internal:7890');
    await button('测试连接').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('授权及镜像清单读取成功');
    expect(client.saveImageCheckSettings).not.toHaveBeenCalled();
    await wrapper
      .findAll('form')
      .find((f) => f.text().includes('HTTP / HTTPS 代理地址'))
      .trigger('submit');
    await flushPromises();
    expect(client.saveImageCheckSettings).toHaveBeenCalledWith({
      proxyUrl: 'http://host.docker.internal:7890',
    });
    expect(client.getProjectUpdates).toHaveBeenLastCalledWith('p', true, expect.any(Object));
    expect(wrapper.text()).toContain('通过代理检查镜像');
  });
  it('自动逐应用检查，快结果先显示，失败给出原因且不锁定备份操作', async () => {
    const containers = ['a', 'b'].map((key) => ({
      id: key.repeat(64),
      name: key + '-web',
      image: key + ':latest',
      projectName: key,
      projectId: key,
      service: 'web',
      state: 'running',
      updateCheckAvailable: true,
    }));
    client.getMaintenance.mockResolvedValue({ ...overview(), containers });
    let finishSlow;
    client.getProjectUpdates.mockImplementation((projectId) =>
      projectId === 'a'
        ? Promise.resolve({
            checkedAt: 123,
            images: [{ service: 'web', status: 'current', hasUpdate: false }],
          })
        : new Promise((resolve, reject) => {
            finishSlow = { resolve, reject };
          })
    );
    await show();
    expect(client.getProjectUpdates).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('已是最新');
    expect(wrapper.text()).toContain('检查中…');
    expect(wrapper.text()).toContain('已完成 1 / 2');
    expect(button('备份').element.disabled).toBe(false);
    finishSlow.reject(new Error('镜像仓库连接超时'));
    await flushPromises();
    expect(wrapper.text()).toContain('检查失败');
    expect(wrapper.text()).toContain('镜像仓库连接超时');
    expect(wrapper.text()).toContain('已检查 2 个应用');
    expect(button('重试')).toBeDefined();
    expect(wrapper.text()).not.toContain('待检查');
  });
  it('隐藏辅助容器，当前筛选全选排除面板自身和辅助容器', async () => {
    client.getMaintenance.mockResolvedValue({
      ...overview(),
      containers: [
        ...overview().containers,
        { id: 'h', name: 'random-helper', image: 'panel', helper: true, state: 'running' },
        { id: 's', name: 'panel', image: 'panel', self: true, state: 'running' },
      ],
    });
    await show();
    expect(wrapper.text()).not.toContain('random-helper');
    await wrapper.get('input[aria-label="搜索容器、应用或镜像"]').setValue('app-web');
    const select = wrapper
      .findAll('label')
      .find((label) => label.text() === '选择当前列表')
      .get('input');
    await select.setValue(true);
    expect(wrapper.text()).toContain('已选 1 个');
    await button('备份所选').trigger('click');
    await flushPromises();
    expect(client.prepareMaintenance).toHaveBeenLastCalledWith(
      expect.objectContaining({ containerIds: [id] })
    );
  });
  it('35 秒超时会中止请求并结束检查，切节点后迟到结果不能覆盖新节点', async () => {
    vi.useFakeTimers();
    try {
      const containers = [
        { ...overview().containers[0], projectId: 'p', service: 'web', updateCheckAvailable: true },
      ];
      client.getMaintenance.mockResolvedValue({ ...overview(), containers });
      let requestSignal, late;
      client.getProjectUpdates.mockImplementationOnce(
        (_id, _force, { signal }) =>
          new Promise((_resolve, reject) => {
            requestSignal = signal;
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('timeout', 'AbortError')),
              { once: true }
            );
          })
      );
      await show();
      await vi.advanceTimersByTimeAsync(35_000);
      await flushPromises();
      expect(requestSignal.aborted).toBe(true);
      expect(wrapper.text()).toContain('检查超过 35 秒');
      client.getProjectUpdates.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            late = resolve;
          })
      );
      await button('重试').trigger('click');
      client.getMaintenance.mockResolvedValue({ ...overview(), containers: [], hostId: 'remote' });
      window.dispatchEvent(new Event('composeops:host-changed'));
      await flushPromises();
      late({ images: [{ service: 'web', status: 'updated', hasUpdate: true }] });
      await flushPromises();
      expect(wrapper.text()).not.toContain('有镜像更新');
      expect(button('停止检查')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
  it('已打开运维页时，旧入口及浏览器导航仍切换目标页签并退出旧确认', async () => {
    await show();
    await button('备份').trigger('click');
    await flushPromises();
    expect(button('开始完整备份')).toBeDefined();
    route.current.query = { tab: 'tasks' };
    await flushPromises();
    expect(button('开始完整备份')).toBeUndefined();
    expect(wrapper.get('#maintenance-tab-tasks').attributes('aria-selected')).toBe('true');
    expect(wrapper.text()).toContain('原定时运维计划');
    route.current.query = {};
    await flushPromises();
    expect(wrapper.get('#maintenance-tab-containers').attributes('aria-selected')).toBe('true');
    expect(client.executeMaintenance).not.toHaveBeenCalled();
  });
  it('完整范围先展示，停机影响与密钥保存必须都确认才能执行', async () => {
    await show();
    await button('备份').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('app-db');
    expect(wrapper.text()).toContain('命名卷及匿名卷');
    expect(button('开始完整备份').element.disabled).toBe(true);
    const checks = wrapper.findAll('input[type="checkbox"]');
    await checks[1].setValue(true);
    await checks[2].setValue(true);
    expect(button('开始完整备份').element.disabled).toBe(false);
    await button('开始完整备份').trigger('click');
    await flushPromises();
    expect(client.executeMaintenance).toHaveBeenCalledWith(
      expect.objectContaining({ confirmed: true, keySaved: true, token: 'token' })
    );
    expect(wrapper.text()).toContain('原“运维任务”已合并');
  });
  it('任何未覆盖项阻止执行，修改保存目录后必须重新预检', async () => {
    const plan = backupPlan();
    plan.blockers = ['挂载不支持完整保存'];
    plan.coverageVerified = false;
    client.prepareMaintenance.mockResolvedValueOnce(plan);
    await show();
    await button('备份').trigger('click');
    await flushPromises();
    const checks = wrapper.findAll('input[type="checkbox"]');
    await checks[1].setValue(true);
    await checks[2].setValue(true);
    expect(button('开始完整备份').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('预检未通过');
    await wrapper.get('input[aria-label="本次备份保存路径"]').setValue('/backups/new');
    expect(button('开始完整备份').element.disabled).toBe(true);
    await button('重新预检路径及范围').trigger('click');
    await flushPromises();
    expect(client.prepareMaintenance).toHaveBeenLastCalledWith(
      expect.objectContaining({ backupPath: '/backups/new' })
    );
    expect(button('开始完整备份').element.disabled).toBe(true);
  });
  it('节点切换清空旧的选择和确认计划', async () => {
    await show();
    await button('备份').trigger('click');
    await flushPromises();
    window.dispatchEvent(new Event('composeops:host-changed'));
    await flushPromises();
    expect(button('开始完整备份')).toBeUndefined();
    expect(client.executeMaintenance).not.toHaveBeenCalled();
  });
  it('115 直接授权入口和自动同步受认证及测试状态约束', async () => {
    client.getSyncTargets.mockResolvedValue({
      targets: [
        {
          id: 't',
          name: '115异地',
          type: '115',
          remotePath: '/backups',
          authorized: false,
          tested: false,
          auto: false,
        },
      ],
    });
    client.authorize115.mockResolvedValue({ id: 'session', qrImage: 'data:image/png;base64,AA==' });
    await show();
    await button('同步').trigger('click');
    await flushPromises();
    expect(button('立即同步').element.disabled).toBe(true);
    await button('扫码授权 115').trigger('click');
    await flushPromises();
    expect(client.authorize115).toHaveBeenCalledWith('t');
    expect(wrapper.find('img[alt="115 授权二维码"]').exists()).toBe(true);
    wrapper.unmount();
    wrapper = null;
  });
});
