import { findProject } from '../services/scanner.js';
import { getActiveHostId } from '../services/docker-hosts.js';
import { scanProjectWebPorts, buildWebUiLinks } from '../services/project-ports.js';
import { readWebUiSettings, saveWebUiSettings, applyWebUiSettings } from '../services/project-webui-settings.js';
import { addOperation } from '../lib/db.js';

export function registerProjectWebUiRoutes(fastify, { resolveProject = findProject, activeHostId = getActiveHostId } = {}) {
  async function scope(request, reply) {
    reply.header('Cache-Control', 'no-store');
    const hostId = activeHostId();
    const project = await resolveProject(request.params.id);
    if (hostId !== activeHostId() || (request.method === 'PUT' && request.body?.hostId !== hostId)) {
      reply.code(409).send({ message: 'Docker 节点已切换，请重新打开访问入口设置' }); return null;
    }
    if (!project) { reply.code(404).send({ message: '项目不存在或当前不可见' }); return null; }
    return { project, hostId };
  }
  fastify.get('/:id/webui', async (request, reply) => {
    const context = await scope(request, reply); if (!context) return;
    const { project, hostId } = context;
    const settings = readWebUiSettings(hostId, project.id);
    return { projectId: project.id, projectName: project.projectName,
      links: applyWebUiSettings(buildWebUiLinks(request.headers.host, scanProjectWebPorts(project)), settings.entries) };
  });
  fastify.get('/:id/webui-settings', async (request, reply) => {
    const context = await scope(request, reply); if (!context) return;
    const { project, hostId } = context;
    // 停止的容器也可维护已知入口，服务名作为稳定标识，重建后继续生效。
    const targets = scanProjectWebPorts({ ...project, containers: project.containers.map(container => ({ ...container, state: 'running' })) });
    return { ...readWebUiSettings(hostId, project.id), targets: buildWebUiLinks(request.headers.host, targets) };
  });
  fastify.put('/:id/webui-settings', { bodyLimit: 128 * 1024 }, async (request, reply) => {
    const context = await scope(request, reply); if (!context) return;
    try {
      const services = new Set(context.project.containers.map(container => container.service || container.name));
      if (Array.isArray(request.body?.entries) && request.body.entries.some(entry => entry?.path && !services.has(entry?.service) && !readWebUiSettings(context.hostId, context.project.id).entries.some(saved => saved.service === entry.service && saved.port === entry.port && saved.path === entry.path))) {
        return reply.code(400).send({ message: '配置中包含不属于当前项目的应用，请重新读取' });
      }
      const result = saveWebUiSettings(context.hostId, context.project.id, request.body?.revision, request.body?.entries);
      addOperation({ projectId: context.project.id, projectName: context.project.projectName, action: 'webui.save', status: 'success', detail: '保存应用访问入口' });
      return result;
    } catch (error) {
      if (!error.statusCode) throw error;
      return reply.code(error.statusCode).send({ message: error.message });
    }
  });
}
