import { findProject } from '../services/scanner.js';
import { getActiveHostId } from '../services/docker-hosts.js';
import { addOperation } from '../lib/db.js';
import { readProjectCredentials, saveProjectCredentials } from '../services/project-credentials.js';

// 只在专用接口返回凭据，不加入项目列表、设置导出或 Agent 上下文。
export function registerProjectCredentialRoutes(fastify, { resolveProject = findProject, activeHostId = getActiveHostId } = {}) {
  async function scope(request, reply) {
    reply.header('Cache-Control', 'no-store');
    const hostId = activeHostId();
    const project = await resolveProject(request.params.id);
    if (hostId !== activeHostId() || (request.method === 'PUT' && request.body?.hostId !== hostId)) {
      reply.code(409).send({ message: 'Docker 节点已切换，请重新打开密钥窗口' });
      return null;
    }
    if (!project) {
      reply.code(404).send({ message: '项目不存在或当前不可见' });
      return null;
    }
    return { project, hostId };
  }

  fastify.get('/:id/credentials', async (request, reply) => {
    const context = await scope(request, reply);
    if (!context) return;
    return readProjectCredentials(context.hostId, context.project.id);
  });
  fastify.put('/:id/credentials', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const context = await scope(request, reply);
    if (!context) return;
    try {
      const result = saveProjectCredentials(context.hostId, context.project.id, request.body?.revision, request.body?.entries);
      addOperation({ projectId: context.project.id, projectName: context.project.projectName,
        action: 'credentials.save', status: 'success', detail: `保存 ${request.body.entries.length} 组账号密码` });
      return result;
    } catch (error) {
      if (!error.statusCode) throw error;
      return reply.code(error.statusCode).send({ message: error.message });
    }
  });
}
