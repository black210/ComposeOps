import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-scanner-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
const { getActivityDocker, setActiveHost, upsertHost } = await import('../src/services/docker-hosts.js');
const { scanProjects, invalidateScanCache } = await import('../src/services/scanner.js');
const { setProjectPreference } = await import('../src/lib/db.js');
const { prepareProjectAction } = await import('../src/services/project-action-runner.js');
const local = getActivityDocker();
const remoteHost = upsertHost({ name: '扫描测试', type: 'tcp', host: '127.0.0.1', port: 1 });
const row = name => ({ Id: name, Names: [`/${name}`], State: 'running', Labels: {
  'com.docker.compose.project': name,
  'com.docker.compose.project.working_dir': tempDir,
  'com.docker.compose.project.config_files': path.join(tempDir, 'compose.yaml'),
} });
fs.writeFileSync(path.join(tempDir, 'compose.yaml'), 'services: {}');
test.beforeEach(() => { setActiveHost('local'); invalidateScanCache(); });
test.afterEach(() => { setActiveHost('local'); invalidateScanCache(); });
test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('主机网络仅提取 EXPOSE 端口，不向项目列表透出 inspect 环境变量', async t => {
  const host = row('host-app');
  host.HostConfig = { NetworkMode: 'host' };
  t.mock.method(local, 'listContainers', async () => [host]);
  t.mock.method(local, 'getContainer', () => ({ inspect: async () => ({ Config: { ExposedPorts: { '8023/tcp': {}, '123/udp': {}, 'invalid': {} }, Env: ['PASSWORD=do-not-return'] } }) }));
  const [project] = await scanProjects();
  assert.deepEqual(project.containers[0].hostPorts, [{ port: 8023, type: 'tcp' }, { port: 123, type: 'udp' }]);
  assert.equal(JSON.stringify(project).includes('do-not-return'), false);
  assert.deepEqual(project.containers[0].ports, []);
});

test('主机网络无 EXPOSE 时返回明确的 Web 配置端口，不暴露其他环境信息', async t => {
  const host = row('optimizer');
  host.HostConfig = { NetworkMode: 'host' };
  const bridge = row('bridge');
  bridge.HostConfig = { NetworkMode: 'bridge' };
  t.mock.method(local, 'listContainers', async () => [host, bridge]);
  const inspect = t.mock.method(local, 'getContainer', id => {
    if (id === 'bridge') return { inspect: async () => ({ State: { Status: 'running' } }) };
    return { inspect: async () => ({ Config: { Env: ['WEB_PORT=18846', 'AUTH_TOKEN=do-not-return', 'PROXY_PORT=19800'] } }) };
  });
  const projects = await scanProjects();
  assert.deepEqual(projects.find(p => p.projectName === 'optimizer').containers[0].hostPorts,
    [{ port: 18846, type: 'tcp', source: 'environment', scheme: 'http' }]);
  assert.equal(inspect.mock.callCount(), 2);
  assert.equal(JSON.stringify(projects).includes('do-not-return'), false);
  assert.equal(JSON.stringify(projects).includes('19800'), false);
});

test('切换节点不复用旧扫描,旧请求保留原节点访问类型且不覆盖当前缓存', async t => {
  let finishLocal;
  t.mock.method(local, 'listContainers', () => new Promise(resolve => { finishLocal = resolve; }));
  const oldRequest = scanProjects();
  setActiveHost(remoteHost.id);
  const remote = getActivityDocker();
  let remoteCalls = 0;
  t.mock.method(remote, 'listContainers', async () => { remoteCalls++; return [row('remote')]; });
  const newRequest = scanProjects();
  finishLocal([row('local')]);
  const [oldResult, newResult] = await Promise.all([oldRequest, newRequest]);
  assert.equal(newResult[0].projectName, 'remote');
  assert.equal(newResult[0].mountState, 'remote_api_only');
  assert.equal(oldResult[0].mountState, 'ready');
  assert.equal((await scanProjects())[0].projectName, 'remote');
  assert.equal(remoteCalls, 1);
});

test('失效前的扫描不能复活缓存或清除新的在途请求', async t => {
  const finishes = [];
  t.mock.method(local, 'listContainers', () => new Promise(resolve => finishes.push(resolve)));
  const stale = scanProjects();
  invalidateScanCache();
  const fresh = scanProjects();
  finishes[0]([row('stale')]);
  await stale;
  const shared = scanProjects();
  finishes[1]([row('fresh')]);
  assert.equal((await fresh)[0].projectName, 'fresh');
  assert.equal((await shared)[0].projectName, 'fresh');
  assert.equal(finishes.length, 2);
  assert.equal((await scanProjects())[0].projectName, 'fresh');
});

test('缓存与并发调用返回独立快照,调用方修改容器不污染后续读取', async t => {
  t.mock.method(local, 'listContainers', async () => [row('test')]);
  const [first, second] = await Promise.all([scanProjects(), scanProjects()]);
  first[0].containers[0].name = 'changed';
  assert.equal(second[0].containers[0].name, 'test');
  const cached = await scanProjects();
  assert.equal(cached[0].containers[0].name, 'test');
});

test('所有项目自动可用，旧白名单不影响能力，备注收藏立即生效且不等待扫描缓存', async t => {
  const list = t.mock.method(local, 'listContainers', async () => [row('preferences')]);
  const [project] = await scanProjects();
  assert.equal(project.managed, true);
  assert.equal(project.editable, true);
  setProjectPreference(project.id, { managed: false, mountEnabled: false, note: '新备注', favorite: true });
  let current = (await scanProjects())[0];
  assert.equal(current.managed, true);
  assert.equal(current.editable, true);
  assert.equal(current.note, '新备注');
  setProjectPreference(project.id, { managed: false });
  current = (await scanProjects())[0];
  assert.equal(current.managed, true);
  assert.equal(current.mountEnabled, true);
  assert.equal(current.editable, true);
  assert.equal(current.favorite, true);
  assert.equal(current.note, '新备注');
  assert.equal(list.mock.callCount(), 1);
});

test('项目操作完成后立即读取真实容器状态', async t => {
  let state = 'exited';
  t.mock.method(local, 'listContainers', async () => [{ ...row('action'), State: state }]);
  t.mock.method(local, 'getContainer', () => ({
    inspect: async () => ({ Config: { Labels: row('action').Labels }, State: { Status: state } }),
    start: async () => { state = 'running'; },
  }));
  const [project] = await scanProjects();
  assert.equal(project.status, 'stopped');
  const prepared = await prepareProjectAction(project, 'up', 'action');
  assert.equal(await prepared.run(), 0);
  assert.equal((await scanProjects())[0].status, 'running');
});


test('重启后使用真实 StartedAt，创建时间、旧列表镜像和健康状态不覆盖 inspect', async t => {
  const created = Math.floor((Date.now() - 6 * 86400000) / 1000);
  const started = new Date(Date.now() - 1000).toISOString();
  const finished = new Date(Date.now() - 2000).toISOString();
  t.mock.method(local, 'listContainers', async () => [{ ...row('astrbot'), Created: created, Image: 'old:list', Status: 'Up (unhealthy)' }]);
  t.mock.method(local, 'getContainer', () => ({ inspect: async () => ({ State: { Status: 'running', StartedAt: started, FinishedAt: finished, Health: { Status: 'healthy' } }, Image: 'sha256:actual', Config: { Image: 'astrbot:v4.29.3@sha256:original', Env: ['TOKEN=inspect-secret-sentinel'] } }) }));
  const [project] = await scanProjects();
  const container = project.containers[0];
  assert.equal(container.startedAt, Date.parse(started));
  assert.equal(container.stoppedAt, Date.parse(finished));
  assert.equal(container.created, created);
  assert.equal(container.image, 'astrbot:v4.29.3@sha256:original');
  assert.equal(container.imageId, 'sha256:actual');
  assert.equal(container.health, 'healthy');
  assert.equal(JSON.stringify(project).includes('inspect-secret-sentinel'), false);
});

test('停止使用真实 FinishedAt；未启动的零值、非法时间和 inspect 失败均不猜测时间', async t => {
  const finished = '2026-11-05T02:12:37.725628767Z';
  t.mock.method(local, 'listContainers', async () => ['stopped', 'created', 'invalid', 'missing'].map(name => ({ ...row(name), State: 'exited', Created: 1, Status: 'Exited (2 days)' })));
  t.mock.method(local, 'getContainer', name => ({ inspect: async () => {
    if (name === 'missing') throw Object.assign(new Error('gone'), { statusCode: 404 });
    return { State: { Status: name === 'created' ? 'created' : 'exited', StartedAt: name === 'invalid' ? 'bad-date' : '0001-01-01T00:00:00Z', FinishedAt: name === 'stopped' ? finished : '0001-01-01T00:00:00Z' } };
  } }));
  const projects = await scanProjects();
  for (const project of projects) {
    assert.equal(project.containers[0].startedAt, null);
    assert.equal(project.containers[0].stoppedAt, project.projectName === 'stopped' ? Date.parse(finished) : null);
  }
});

test('运行状态 inspect 最多并发 6 个，每个容器只读取一次且复用扫描缓存', async t => {
  const names = Array.from({ length: 15 }, (_, i) => 'bounded-' + i);
  let active = 0, max = 0, reads = 0;
  t.mock.method(local, 'listContainers', async () => names.map(row));
  t.mock.method(local, 'getContainer', () => ({ inspect: async () => {
    active++; reads++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return { State: { Status: 'running', StartedAt: '2026-11-05T02:12:37Z' } };
  } }));
  assert.equal((await scanProjects()).length, 15);
  await scanProjects();
  assert.equal(reads, 15);
  assert.equal(max, 6);
});


test('后来发现的项目直接可用；过宽目录和跨目录配置不自动开放文件能力', async t => {
  const broad = row('broad'); broad.Labels['com.docker.compose.project.working_dir'] = '/';
  const outside = row('outside'); outside.Labels['com.docker.compose.project.config_files'] = '/etc/compose.yaml';
  t.mock.method(local, 'listContainers', async () => [row('newly-discovered'), broad, outside]);
  const projects = await scanProjects();
  assert.ok(projects.every(project => project.managed));
  assert.equal(projects.find(project => project.projectName === 'newly-discovered').editable, true);
  for (const name of ['broad', 'outside']) {
    const project = projects.find(project => project.projectName === name);
    assert.equal(project.mountEnabled, false);
    assert.equal(project.composeMode, 'containers');
  }
});
