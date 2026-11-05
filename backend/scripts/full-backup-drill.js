// 仅用于独立测试项目；绝不允许指定真实应用名称。
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile, stat, readlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { scanProjects, invalidateScanCache } from '../src/services/scanner.js';
import { setProjectPreference } from '../src/lib/db.js';
import {
  saveBackupSettings,
  prepareMaintenance,
  executeMaintenance,
  refreshTasks,
} from '../src/services/container-maintenance.js';
import { recoveryKey } from '../src/services/maintenance-store.js';
import { getDockerForHost } from '../src/services/docker-hosts.js';
import { extractFullBackup } from './full-backup-extract.js';

const root = '/tmp/composeops-maintenance-validation';
if (process.env.ALLOW_FULL_BACKUP_FIXTURE_DRILL !== '1')
  throw new Error('仅在专用验证容器中启用 ALLOW_FULL_BACKUP_FIXTURE_DRILL=1');
async function command(bin, args, cwd = root) {
  const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const s of [child.stdout, child.stderr])
    s.on('data', (c) => {
      output += c;
    });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error('验证命令失败：' + output.slice(-2000));
  return output;
}
await mkdir(root + '/backups', { recursive: true });
invalidateScanCache();
const project = (await scanProjects()).find(
  (p) => p.projectName === 'composeops-full-backup-fixture' && p.workingDir === root + '/fixture',
);
assert.ok(project, '只允许已创建的固定隔离测试项目');
setProjectPreference(project.id, { managed: true, mountEnabled: true });
invalidateScanCache();
await saveBackupSettings(root + '/backups');
const target = project.containers.find((c) => c.service === 'web') || project.containers[0];
const plan = await prepareMaintenance({
  action: process.env.DRILL_ACTION === 'update' ? 'update' : 'backup',
  containerIds: [target.id],
  backupPath: root + '/backups',
});
console.log(
  '预检结果',
  JSON.stringify({
    members: plan.members,
    sources: plan.sources,
    blockers: plan.blockers,
    bytes: plan.estimatedBytes,
  }),
);
assert.deepEqual(plan.blockers, []);
assert.equal(plan.members.length, 2);
const job = await executeMaintenance({ token: plan.token, confirmed: true, keySaved: true });
let state;
for (let i = 0; i < 900; i++) {
  state = await refreshTasks();
  const task = state.tasks.find((t) => t.id === job.id);
  if (i % 10 === 0) console.log('备份阶段', task.status, task.stage);
  if (task.status !== 'running') {
    assert.equal(task.status, 'success', task.stage);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const backup = state.backups.find((b) => b.id === job.id);
assert.ok(backup?.complete);
const keyFile = root + '/data/drill-recovery.key';
await writeFile(keyFile, recoveryKey(), { mode: 0o600 });
const restored = root + '/data/restored-' + job.id;
await extractFullBackup(backup.path, keyFile, restored);
const manifest = JSON.parse(await readFile(restored + '/manifest.json', 'utf8'));
const sourceMapping = new Map();
for (const artifact of manifest.artifacts.filter((a) =>
  ['bind', 'project', 'configuration', 'volume'].includes(a.kind),
)) {
  const destination = path.join(restored, 'data-' + artifact.file.replace('.tar.enc', ''));
  await mkdir(destination);
  await command('tar', [
    '--acls',
    '--xattrs',
    '--numeric-owner',
    '-xpf',
    restored + '/' + artifact.file.slice(0, -4),
    '-C',
    destination,
  ]);
  sourceMapping.set(artifact.source, path.join(destination, artifact.archiveRoot));
}
for (const artifact of manifest.artifacts.filter((a) => ['image', 'writable-layer'].includes(a.kind))) {
  const stream = await getDockerForHost('local').loadImage(
    createReadStream(path.join(restored, artifact.file.slice(0, -4))),
  );
  for await (const _ of stream) {
    /* consume Docker progress without exposing config */
  }
}
const services = {};
for (const c of manifest.containers) {
  const service = c.Config.Labels['com.docker.compose.service'];
  const snapshot = manifest.artifacts.find((a) => a.kind === 'writable-layer' && a.containerId === c.Id);
  services[service] = {
    image: snapshot.imageId,
    restart: 'no',
    environment: c.Config.Env,
    volumes: c.Mounts.filter((m) => m.Type !== 'bind' || m.Source !== '/var/run/docker.sock').map((m) => ({
      type: 'bind',
      source:
        sourceMapping.get(m.Type === 'volume' ? m.Name : m.Source) ||
        [...sourceMapping]
          .find(([source]) => m.Source.startsWith(source + '/'))
          ?.map((v, i, a) => (i === 1 ? path.join(v, path.relative(a[0], m.Source)) : v))?.[1],
      target: m.Destination,
      read_only: m.RW === false,
    })),
  };
  for (const m of services[service].volumes) assert.ok(m.source, '每个挂载必须有独立恢复路径');
}
// 固定隔离项目名，端口不暴露到宿主机。
const compose = restored + '/compose.restore.json';
await writeFile(compose, JSON.stringify({ name: 'composeops-full-backup-restored', services }, null, 2));
await command('docker', ['compose', '-f', compose, 'config', '--quiet']);
await command('docker', ['compose', '-f', compose, 'up', '-d']);
assert.match(
  await command('docker', ['compose', '-f', compose, 'exec', '-T', 'web', 'cat', '/writable-proof']),
  /writable-layer-proof/,
);
assert.match(
  await command('docker', ['compose', '-f', compose, 'exec', '-T', 'web', 'cat', '/uploads/proof.txt']),
  /bind-proof/,
);
assert.match(
  await command('docker', ['compose', '-f', compose, 'exec', '-T', 'web', 'cat', '/config.json']),
  /"fixture":true/,
);
const projectCopy = sourceMapping.get(root + '/fixture');
assert.ok(projectCopy);
const originalMetadata = await stat(projectCopy + '/uploads/proof.txt');
assert.equal(originalMetadata.mode & 0o777, 0o640);
assert.equal(originalMetadata.uid, 1000);
assert.equal((await stat(projectCopy + '/uploads/hard-link')).ino, originalMetadata.ino);
assert.equal(await readlink(projectCopy + '/uploads/symbolic-link'), 'proof.txt');
assert.match(
  await command('getfattr', ['--only-values', '-n', 'user.composeops', projectCopy + '/uploads/proof.txt']),
  /metadata-proof/,
);
assert.match(
  await command('docker', ['compose', '-f', compose, 'exec', '-T', 'web', 'cat', '/state/proof.txt']),
  /named-volume-proof/,
);
assert.match(
  await command('docker', ['compose', '-f', compose, 'exec', '-T', 'web', 'cat', '/anonymous/proof.txt']),
  /anonymous-volume-proof/,
);
assert.match(
  await command('docker', [
    'compose',
    '-f',
    compose,
    'exec',
    '-T',
    'redis',
    'redis-cli',
    'GET',
    'backup-proof',
  ]),
  /database-proof/,
);
console.log(
  '隔离恢复验证通过',
  JSON.stringify({
    backupId: backup.id,
    containers: manifest.containers.length,
    artifacts: manifest.artifacts.length,
    bind: true,
    namedVolume: true,
    anonymousVolume: true,
    writableLayer: true,
    redisData: true,
    singleFile: true,
    permissions: true,
    owner: true,
    hardlink: true,
    symlink: true,
    xattrs: true,
  }),
);
await command('docker', ['compose', '-f', compose, 'down']);
await command('docker', ['compose', '-f', root + '/fixture/docker-compose.yml', 'down']);
