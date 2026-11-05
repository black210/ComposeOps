import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-execution-'));
process.env.DB_PATH = path.join(dir, 'test.db');
const { maintenanceExecutionMode } = await import('../src/services/container-maintenance.js');
const prepared = action => ({ action, config: { backupPath: '/backups/apps' }, publicPlan: { blockers: [], coverageVerified: true } });
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test('默认路径的更新自动备份，不要求停机或密钥已下载声明', () => {
  assert.equal(maintenanceExecutionMode(prepared('update'), {}, '/backups/apps'), 'automatic-default');
});
test('更新不能绕过完整性预检、缺失默认路径或执行前改变的路径', () => {
  for (const defaultPath of ['', '/backups/changed']) assert.throws(() => maintenanceExecutionMode(prepared('update'), { confirmed: true, keySaved: true }, defaultPath), /默认/);
  for (const plan of [{ blockers: ['数据未覆盖'], coverageVerified: true }, { blockers: [], coverageVerified: false }]) {
    assert.throws(() => maintenanceExecutionMode({ ...prepared('update'), publicPlan: plan }, {}, '/backups/apps'), /预检未通过/);
  }
});
test('手动备份保留范围与密钥确认，不继承自动更新权限', () => {
  for (const input of [{}, { confirmed: true }, { keySaved: true }]) assert.throws(() => maintenanceExecutionMode(prepared('backup'), input, '/backups/apps'), /尚未确认/);
  assert.equal(maintenanceExecutionMode(prepared('backup'), { confirmed: true, keySaved: true }, ''), 'manual');
});
