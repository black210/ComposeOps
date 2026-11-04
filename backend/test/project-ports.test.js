import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPorts, scanProjectWebPorts, buildWebUiLinks } from '../src/services/project-ports.js';

test('each app retains typical and custom ports with IPv4/IPv6 deduplicated', () => {
  const entries = scanProjectWebPorts({ containers: [
    { id: 'a', name: 'frontend-1', service: 'frontend', state: 'running', ports: [{ public: 8080, private: 80 }, { public: 18081, private: 8081 }, { public: 8080, private: 80 }] },
    { id: 'b', name: 'sync-1', service: 'sync', state: 'running', ports: [{ public: 5244, private: 5244 }] },
  ] });
  assert.deepEqual(entries.map(entry => [entry.containerId, entry.serviceName, entry.ports]), [['a', 'frontend', [8080, 18081]], ['b', 'sync', [5244]]]);
});

test('remapped database ports and UDP do not become HTTP links; web mapping may use a data-like host port', () => {
  const { candidates } = classifyPorts({ ports: [{ public: 15432, private: 5432 }, { public: 9000, private: 9000, type: 'udp' }, { public: 3306, private: 80 }] });
  assert.deepEqual(candidates, [3306]);
});

test('HTTPS uses container target 443 and IPv6 addresses stay bracketed', () => {
  const entries = scanProjectWebPorts({ containers: [{ id: 'a', name: 'app', state: 'running', ports: [{ public: 18443, private: 443 }] }] });
  assert.equal(buildWebUiLinks('[::1]:3001', entries)[0].ports[0].url, 'https://[::1]:18443');
  assert.equal(buildWebUiLinks('nas.example:28765', entries)[0].ports[0].url, 'https://nas.example:18443');
});

test('stopped and unmapped services never get invented links', () => {
  assert.deepEqual(scanProjectWebPorts({ containers: [
    { id: 'stopped', state: 'exited', ports: [{ public: 8080, private: 80 }] },
    { id: 'host', state: 'running', networkMode: 'host', ports: [] },
  ] }), []);
});
