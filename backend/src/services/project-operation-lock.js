import { AsyncLocalStorage } from 'node:async_hooks';

const locks = new Map();
const lockContext = new AsyncLocalStorage();
const guards = new Set();
export function registerProjectOperationGuard(guard) { guards.add(guard); return () => guards.delete(guard); }
export function assertProjectOperationAllowed(projectId) { for(const guard of guards)guard(projectId); }
export function isProjectOperationLocked(projectId) { return locks.has(projectId); }

/** 同一项目的 Compose/配置操作串行化,避免并发写文件与重启互相覆盖。 */
export async function withProjectOperationLock(projectId, task) {
  if (!projectId) return task();
  assertProjectOperationAllowed(projectId);
  const held = lockContext.getStore();
  if (held?.has(projectId)) return task();
  const previous = locks.get(projectId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  locks.set(projectId, current);
  await previous;
  try {
    assertProjectOperationAllowed(projectId);
    return await lockContext.run(new Set([...(held || []), projectId]), task);
  } finally {
    release();
    if (locks.get(projectId) === current) locks.delete(projectId);
  }
}

export function activeProjectLocks() {
  return locks.size;
}
