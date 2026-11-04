import db from '../lib/db.js';

function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function readProjectCredentials(hostId, projectId) {
  const row = db.prepare('SELECT revision, entries_json FROM project_credentials WHERE host_id = ? AND project_id = ?').get(hostId, projectId);
  return { hostId, revision: row?.revision || 0, entries: row ? JSON.parse(row.entries_json) : [] };
}

export function saveProjectCredentials(hostId, projectId, revision, entries) {
  if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(entries) || entries.length > 50) {
    throw invalid('账号密码格式无效，最多保存 50 组');
  }
  const normalized = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).some((key) => !['service', 'username', 'password'].includes(key)) ||
        typeof entry.service !== 'string' || entry.service.length > 128 ||
        typeof entry.username !== 'string' || entry.username.length > 512 ||
        typeof entry.password !== 'string' || entry.password.length > 8192 ||
        (!entry.username && !entry.password)) throw invalid('每组需填写账号或密码，且不能超过字段长度限制');
    return { service: entry.service.trim(), username: entry.username, password: entry.password };
  });
  return db.transaction(() => {
    const current = readProjectCredentials(hostId, projectId);
    if (current.revision !== revision) throw invalid('账号密码已被其他页面修改，请重新打开后编辑', 409);
    const next = revision + 1;
    db.prepare(`INSERT INTO project_credentials(host_id, project_id, revision, entries_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(host_id, project_id) DO UPDATE SET revision = excluded.revision, entries_json = excluded.entries_json`)
      .run(hostId, projectId, next, JSON.stringify(normalized));
    return { ok: true, revision: next };
  })();
}
