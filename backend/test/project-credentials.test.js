import './helpers/isolated-db.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import db from '../src/lib/db.js';
import { registerProjectCredentialRoutes } from '../src/routes/project-credentials.js';
import { readProjectCredentials, saveProjectCredentials } from '../src/services/project-credentials.js';
import { buildApp } from '../src/app.js';

const entries = [{ service: 'web', username: 'admin', password: ' test-password-with-spaces ' }, { service: 'sync', username: '', password: 'sample-token' }];

test('credentials: isolated by project and Docker host, preserve exact values and reject stale writes', () => {
  assert.deepEqual(readProjectCredentials('local', 'p1').entries, []);
  assert.deepEqual(saveProjectCredentials('local', 'p1', 0, entries), { ok: true, revision: 1 });
  assert.deepEqual(readProjectCredentials('local', 'p1').entries, entries);
  assert.deepEqual(readProjectCredentials('remote', 'p1').entries, []);
  assert.deepEqual(readProjectCredentials('local', 'p2').entries, []);
  assert.throws(() => saveProjectCredentials('local', 'p1', 0, []), { statusCode: 409 });
  assert.deepEqual(readProjectCredentials('local', 'p1').entries, entries);
  saveProjectCredentials('local', 'p1', 1, []);
  assert.deepEqual(readProjectCredentials('local', 'p1').entries, []);
  assert.equal(readProjectCredentials('local', 'p1').revision, 2);
});

test('credentials: reject malformed and oversized entries without writing', () => {
  for (const value of [null, {}, Array(51).fill(entries[0]), [{ service: '', username: '', password: '' }],
    [{ ...entries[0], password: 123 }], [{ ...entries[0], password: 'a'.repeat(8193) }], [{ ...entries[0], unexpected: true }]]) {
    assert.throws(() => saveProjectCredentials('local', 'invalid', 0, value), { statusCode: 400 });
  }
  assert.equal(readProjectCredentials('local', 'invalid').revision, 0);
});

test('credentials routes: no cache, exact scope, safe audit and explicit node-switch rejection', async t => {
  const app = Fastify();
  let host = 'local';
  registerProjectCredentialRoutes(app, { activeHostId: () => host,
    resolveProject: async id => id === 'route-project' ? { id, projectName: '测试项目' } : null });
  t.after(() => app.close());
  const path = '/route-project/credentials';
  const missing = await app.inject('/missing/credentials');
  assert.equal(missing.statusCode, 404);
  const initial = await app.inject(path);
  assert.equal(initial.headers['cache-control'], 'no-store');
  const response = await app.inject({ method: 'PUT', url: path, payload: { hostId: 'local', revision: 0, entries } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes(entries[0].password), false);
  const saved = await app.inject(path);
  assert.deepEqual(saved.json().entries, entries);
  const audit = db.prepare("SELECT detail FROM operation_history WHERE action = 'credentials.save'").all();
  assert.equal(audit.length, 1);
  assert.equal(JSON.stringify(audit).includes('admin'), false);
  assert.equal(JSON.stringify(audit).includes('sample-token'), false);
  const stale = await app.inject({ method: 'PUT', url: path, payload: { hostId: 'local', revision: 0, entries: [] } });
  assert.equal(stale.statusCode, 409);
  host = 'remote';
  const switched = await app.inject({ method: 'PUT', url: path, payload: { hostId: 'local', revision: 1, entries: [] } });
  assert.equal(switched.statusCode, 409);
  assert.deepEqual((await app.inject(path)).json().entries, []);
});

test('credentials routes: reject host changes while resolving a project', async t => {
  const app = Fastify();
  let host = 'local';
  registerProjectCredentialRoutes(app, { activeHostId: () => host, resolveProject: async id => { host = 'remote'; return { id }; } });
  t.after(() => app.close());
  assert.equal((await app.inject('/p/credentials')).statusCode, 409);
});

test('credentials routes: global authentication and Origin checks protect GET and PUT', async t => {
  const app = await buildApp({ logger: false });
  t.after(() => app.close());
  for (const method of ['GET', 'PUT']) {
    assert.equal((await app.inject({ method, url: '/api/v1/projects/p/credentials' })).statusCode, 401);
  }
  const headers = { origin: 'http://localhost:3001', host: 'localhost:3001' };
  const setup = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', headers, payload: { password: 'credentials-route-test-password' } });
  assert.equal(setup.statusCode, 200);
  const cookie = String(setup.headers['set-cookie']).split(';', 1)[0];
  const badOrigin = await app.inject({ method: 'PUT', url: '/api/v1/projects/p/credentials', headers: { ...headers, cookie, origin: 'https://untrusted.invalid' }, payload: {} });
  assert.equal(badOrigin.statusCode, 403);
});
