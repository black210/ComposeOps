import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
const temp = await mkdtemp(path.join(os.tmpdir(), 'maintenance-scope-'));
process.env.DB_PATH = path.join(temp, 'test.db');
process.env.MAINTENANCE_DATA_DIR = path.join(temp, 'maintenance');
const { inventoryForBackup, saveSyncTarget, publicTargets } = await import(
  '../src/services/container-maintenance.js'
);
const container = (id, app, mounts = []) => ({
  Id: id,
  Name: '/' + id,
  Image: 'sha256:img',
  State: { Running: true },
  Config: {
    Labels: app
      ? { 'com.docker.compose.project': app, 'com.docker.compose.project.working_dir': '/apps/' + app }
      : {},
  },
  HostConfig: {},
  Mounts: mounts,
});
const opts = {
  backupPath: '/backups/apps',
  projects: [{ projectName: 'app', workingDir: '/apps/app', managed: true, mountEnabled: true }],
};
test('单个选择自动覆盖同项目容器、bind、命名及匿名卷', () => {
  const all = [
    container('web', 'app', [{ Type: 'bind', Source: '/apps/app/data', RW: true }]),
    container('db', 'app', [{ Type: 'volume', Name: 'random-anonymous-volume', RW: true }]),
  ];
  const result = inventoryForBackup(all, ['web'], opts);
  assert.equal(result.members.length, 2);
  assert.equal(result.blockers.length, 0);
  assert.ok(result.declared.some((s) => s.kind === 'volume' && s.source === 'random-anonymous-volume'));
  assert.equal(result.sources.filter((s) => s.kind !== 'volume').length, 1);
});
test('共享写入、未纳管、面板自身和临时辅助容器不能伪装成完整', () => {
  const a = container('web', 'app', [{ Type: 'bind', Source: '/shared', RW: true }]),
    b = container('outside', null, [{ Type: 'bind', Source: '/shared/sub', RW: true }]);
  assert.match(inventoryForBackup([a, b], ['web'], opts).blockers.join(), /应用外容器/);
  assert.match(inventoryForBackup([a], ['web'], { ...opts, projects: [] }).blockers.join(), /未纳管/);
  assert.match(inventoryForBackup([a], ['web'], { ...opts, selfId: 'web' }).blockers.join(), /面板自身/);
  a.Config.Labels['composeops.helper'] = 'workspace';
  assert.match(inventoryForBackup([a], ['web'], opts).blockers.join(), /辅助容器/);
});
test('认证信息不会出现在目标列表，配置修改必须重新测试', () => {
  const target = saveSyncTarget({
    type: 'webdav',
    name: 'test',
    url: 'https://dav.example.com/dav',
    user: 'test',
    password: 'sensitive',
    remotePath: '/backup',
  });
  assert.equal(target.authorized, true);
  assert.equal(target.tested, false);
  assert.equal(JSON.stringify(publicTargets()).includes('sensitive'), false);
  assert.throws(
    () =>
      saveSyncTarget({
        type: 'webdav',
        name: 'bad',
        url: 'https://user:password@example.com/dav',
        remotePath: '/x',
      }),
    /地址无效/,
  );
});
test('新增运维与恢复密钥接口继承全局鉴权', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp({ logger: false });
  try {
    for (const url of [
      '/api/v1/maintenance/',
      '/api/v1/maintenance/targets',
      '/api/v1/maintenance/recovery-key',
    ])
      assert.equal((await app.inject(url)).statusCode, 401);
  } finally {
    await app.close();
  }
});
test.after(async () => {
  const { default: db } = await import('../src/lib/db.js');
  db.close();
  await rm(temp, { recursive: true, force: true });
});
