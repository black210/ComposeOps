import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-controls-'));
process.env.DB_PATH = path.join(dir, 'test.db');
const { buildApp } = await import('../src/app.js');
const { getActivityDocker } = await import('../src/services/docker-hosts.js');
const { setPassword } = await import('../src/lib/auth.js');
const { setProjectPreference } = await import('../src/lib/db.js');
const { composeArgs, composeProjectArgs } = await import('../src/services/compose-runner.js');
const { prepareProjectAction } = await import('../src/services/project-action-runner.js');
const { registerProjectOperationGuard } = await import('../src/services/project-operation-lock.js');
const { runContainerAction } = await import('../src/services/project-control.js');
const { scanProjects, invalidateScanCache } = await import('../src/services/scanner.js');
const docker = getActivityDocker();
const labels = { 'com.docker.compose.project': 'file_transfer', 'com.docker.compose.project.working_dir': '/apps/fileTransfer' };
const project = { id: 'project', managed: true, editable: true, mountEnabled: true, projectName: 'file_transfer', workingDir: '/apps/fileTransfer', composeFiles: ['/apps/fileTransfer/compose.yaml'], containers: [{ id: 'target', name: 'target', state: 'exited' }, { id: 'other', name: 'other', state: 'running' }] };

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test('Compose 名称始终使用容器标签，不按混合大小写目录推断', () => {
  assert.deepEqual(composeProjectArgs(project), ['--project-name', 'file_transfer', '-f', '/apps/fileTransfer/compose.yaml']);
  for (const action of ['up', 'restart', 'stop', 'pull', 'ps']) {
    assert.deepEqual(composeArgs(project, action).slice(0, 3), ['compose', '--project-name', 'file_transfer']);
  }
});

test('受保护 API 精确控制单个容器，等待执行结果并刷新真实状态', async t => {
  const states = { target: 'exited', other: 'running' };
  const calls = [];
  t.mock.method(docker, 'listContainers', async () => Object.entries(states).map(([id, state]) => ({ Id: id, Names: ['/' + id], State: state, Labels: labels })));
  t.mock.method(docker, 'getContainer', id => ({
    inspect: async () => ({ Config: { Labels: labels, StopTimeout: 120 }, State: { Status: states[id], ExitCode: 0 } }),
    start: async () => { await new Promise(resolve => setTimeout(resolve, 10)); calls.push(['up', id]); states[id] = 'running'; },
    stop: async options => { calls.push(['stop', id, options]); states[id] = 'exited'; },
    restart: async options => { calls.push(['restart', id, options]); states[id] = 'running'; },
  }));
  invalidateScanCache();
  const [found] = await scanProjects();
  setProjectPreference(found.id, { managed: true, mountEnabled: false });
  const app = await buildApp({ logger: false });
  setPassword('isolated-controls-test-password');
  try {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { password: 'isolated-controls-test-password' } });
    const headers = { cookie: String(login.headers['set-cookie']).split(';')[0], origin: 'http://localhost', host: 'localhost' };
    const url = `/api/v1/projects/${found.id}/actions`;
    assert.equal((await app.inject({ method: 'POST', url, payload: { action: 'up', containerId: 'target' } })).statusCode, 401);
    for (const action of ['up', 'restart', 'stop']) {
      const result = await app.inject({ method: 'POST', url, headers, payload: { action, containerId: 'target' } });
      assert.equal(result.statusCode, 200);
      const frames = result.body.trim().split('\n\n').map(part => JSON.parse(part.slice(6)));
      assert.equal(frames.at(-1).type, 'exit');
      assert.equal(frames.at(-1).data.code, 0);
      assert.match(result.body, /仅操作容器 target/);
      assert.match(result.body, /实际状态/);
      assert.equal((await scanProjects())[0].containers.find(c => c.id === 'target').state, action === 'stop' ? 'exited' : 'running');
    }
    assert.deepEqual(calls, [['up', 'target'], ['restart', 'target', { t: 120 }], ['stop', 'target', { t: 120 }]]);
    assert.equal(states.other, 'running');
    const invalid = await app.inject({ method: 'POST', url, headers, payload: { action: 'up', containerId: 'foreign' } });
    assert.equal(invalid.statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { action: 'pull', containerId: 'target' } })).statusCode, 403);
    setProjectPreference(found.id, { managed: false });
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { action: 'up', containerId: 'target' } })).statusCode, 403);
  } finally { await app.close(); invalidateScanCache(); }
});

test('单容器控制不能绕过项目备份锁或容器归属检查', async t => {
  let started = false;
  t.mock.method(docker, 'getContainer', () => ({ inspect: async () => ({ Config: { Labels: { ...labels, 'com.docker.compose.project': 'foreign' } }, State: { Status: 'exited' } }), start: async () => { started = true; } }));
  const prepared = await prepareProjectAction(project, 'up', 'target');
  const remove = registerProjectOperationGuard(() => { throw new Error('完整备份执行中'); });
  try { await assert.rejects(prepared.run(), /完整备份执行中/); } finally { remove(); }
  const output = [];
  assert.equal(await prepared.run((_, value) => output.push(value)), 1);
  assert.equal(started, false);
  assert.match(output.join(''), /归属已改变/);
  await assert.rejects(prepareProjectAction(project, 'up', 'foreign'), /不属于/);
  await assert.rejects(prepareProjectAction(project, 'pull', 'target'), /单容器仅支持/);
});

test('Docker 接受启动但进程立即退出时明确失败，不显示成功', async () => {
  const output = [];
  const fake = { getContainer: () => ({ inspect: async () => ({ Config: { Labels: labels }, State: { Status: 'exited', ExitCode: 2 } }), start: async () => {} }) };
  assert.equal(await runContainerAction({ ...project, containers: [project.containers[0]] }, 'up', (_, value) => output.push(value), fake), 1);
  assert.match(output.join(''), /退出码 2/);
  assert.match(output.join(''), /状态未达到预期/);
});

test('暂停容器恢复运行后才执行优雅停止', async () => {
  let state = 'paused';
  const calls = [];
  const fake = { getContainer: () => ({ inspect: async () => ({ Config: { Labels: labels }, State: { Status: state } }), unpause: async () => { calls.push('unpause'); state = 'running'; }, stop: async () => { calls.push('stop'); state = 'exited'; } }) };
  assert.equal(await runContainerAction({ ...project, containers: [project.containers[0]] }, 'stop', () => {}, fake), 0);
  assert.deepEqual(calls, ['unpause', 'stop']);
});
