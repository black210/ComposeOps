import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
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
    ].map((k) => [k, vi.fn()])
  )
);
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('../src/api/client.js', () => ({ api: client }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => router }));
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
