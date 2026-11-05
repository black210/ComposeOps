import { getActivityDocker } from './docker-hosts.js';

export const CONTAINER_ACTIONS = new Set(['up', 'restart', 'stop', 'ps']);

const ACTION_LABELS = {
  up: '启动',
  restart: '重启',
  stop: '停止',
  ps: '查看',
};

export function supportsContainerAction(action) {
  return CONTAINER_ACTIONS.has(action);
}

/**
 * 受限控制：只操作 Docker 已上报且属于当前纳管项目的现有容器。
 * 不创建、删除容器，也不修改网络、卷或 Compose 配置。
 */
export async function runContainerAction(project, action, onOutput = () => {}, dockerClient = getActivityDocker()) {
  if (!supportsContainerAction(action)) {
    throw Object.assign(new Error('该操作需要挂载 Compose 项目目录'), { statusCode: 409 });
  }

  let failed = 0;
  await Promise.all(project.containers.map(async (item) => {
    const container = dockerClient.getContainer(item.id);
    try {
      const inspection = await container.inspect();
      const labels = inspection.Config?.Labels || {};
      if ((project.projectName && labels['com.docker.compose.project'] !== project.projectName)
        || (project.workingDir && labels['com.docker.compose.project.working_dir'] !== project.workingDir)) {
        throw new Error('容器的 Compose 归属已改变，请刷新后重试');
      }
      const currentState = inspection.State?.Status || item.state;
      // 沿用容器配置的优雅停止时限，不覆盖 Compose 的 stop_grace_period。
      const timeout = inspection.Config?.StopTimeout;
      const stopOptions = Number.isInteger(timeout) && timeout >= 0 ? { t: timeout } : {};
      if (action === 'up') {
        if (currentState === 'paused') { await container.unpause(); onOutput('stdout', `${item.name}: 已恢复运行\n`); }
        else if (currentState === 'running') onOutput('stdout', `${item.name}: 当前状态 ${currentState}，无需启动\n`);
        else { await container.start(); onOutput('stdout', `${item.name}: 已启动\n`); }
      } else if (action === 'restart') {
        if (currentState === 'paused') await container.unpause();
        if (['running', 'paused', 'restarting'].includes(currentState)) await container.restart(stopOptions);
        else await container.start();
        onOutput('stdout', `${item.name}: 已重启\n`);
      } else if (action === 'stop') {
        if (currentState === 'paused') await container.unpause();
        if (!['running', 'paused', 'restarting'].includes(currentState)) onOutput('stdout', `${item.name}: 当前状态 ${currentState}，无需停止\n`);
        else { await container.stop(stopOptions); onOutput('stdout', `${item.name}: 已停止\n`); }
      } else {
        const state = inspection.State || {};
        onOutput('stdout', `${item.name}\t${state.Status || item.state}\t${item.image}\n`);
      }
      if (action !== 'ps') {
        const after = (await container.inspect()).State || {};
        const status = after.Status || 'unknown';
        onOutput('stdout', `${item.name}: 实际状态 ${status}${after.ExitCode ? `，退出码 ${after.ExitCode}` : ''}\n`);
        if (action === 'stop' ? !['exited', 'created', 'dead'].includes(status) : status !== 'running') {
          throw new Error(`操作后状态未达到预期（${status}）${after.Error ? `：${after.Error}` : ''}`);
        }
      }
    } catch (error) {
      failed += 1;
      onOutput('stderr', `${item.name}: ${ACTION_LABELS[action]}失败 - ${error.message}\n`);
    }
  }));
  return failed ? 1 : 0;
}
