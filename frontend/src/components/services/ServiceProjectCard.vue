<template>
  <article :id="`project-${project.id}`" class="card svc-card" :class="{ 'svc-card--expanded': expanded, 'svc-card--attention': attention, 'ring-1 ring-accent': focused }">
    <header class="svc-card__header">
      <div class="svc-card__selection">
        <input type="checkbox" class="accent-accent" :checked="selected" :disabled="!project.managed || busy" :aria-label="`选择 ${project.projectName}`" @click.stop @change="$emit('toggle-select')" />
        <button class="icon-btn" :title="project.favorite ? '取消收藏' : '收藏项目'" :aria-label="project.favorite ? '取消收藏' : '收藏项目'" @click="toggleFavorite(project)">
          <Star class="w-4 h-4" :class="project.favorite ? 'fill-amber-400 text-amber-400' : ''" />
        </button>
      </div>
      <button class="service-project-card__toggle svc-card__toggle" :aria-expanded="expanded" :aria-label="`${expanded ? '收起' : '展开'} ${project.projectName}`" @click="$emit('toggle-expand')">
        <span class="svc-card__identity">
          <span class="svc-card__title-line">
            <span class="svc-card__name">{{ project.projectName }}</span>
            <span class="svc-card__managed" :class="{ 'svc-card__managed--inactive': !project.managed }">{{ project.managed ? '已纳管' : '未纳管' }}</span>
            <span v-if="imageState === 'updated'" class="svc-card__update">镜像待应用</span>
            <span v-else-if="imageState === 'failed'" class="svc-card__update">镜像检查失败</span>
          </span>
          <span class="svc-card__meta">
            <Folder class="h-3 w-3 shrink-0" />
            <span class="svc-card__path" :title="project.workingDir">{{ project.workingDir || '未提供工作目录' }}</span>
            <span v-if="project.owner && project.owner !== 'Uncategorized'" class="svc-card__owner">{{ project.owner }}</span>
          </span>
        </span>
        <span class="svc-card__summary">
          <StatusBadge :status="project.status" />
          <span class="svc-card__runtime"><span>{{ project.containers.length }} 个容器</span><span v-if="statusHint">{{ statusHint }}</span></span>
        </span>
        <ChevronDown class="svc-card__chevron h-4 w-4 shrink-0" :class="{ 'rotate-180': expanded }" />
      </button>
      <div class="svc-card__utilities">
        <button v-if="updateInfo?.hasUpdate" class="icon-btn text-amber-400" title="检测到镜像可更新，点击升级" aria-label="升级项目" @click.stop="$emit('upgrade')"><Sparkles class="h-4 w-4" /></button>
        <button class="icon-btn" title="账号密码" aria-label="管理账号密码" @click="$emit('credentials')"><KeyRound class="h-4 w-4" /></button>
        <button class="icon-btn" title="编辑备注" aria-label="编辑备注" @click="editNote(project)"><Pencil class="h-4 w-4" /></button>
      </div>
    </header>
    <div v-if="webuiLinks.length" class="svc-card__access"><WebUiLauncher :links="webuiLinks" /></div>

    <div v-if="expanded" class="svc-card__details">
      <div class="svc-card__toolbar">
        <div class="svc-card__lifecycle" aria-label="项目启停">
          <button class="btn-primary" :disabled="!project.managed || locked" :title="project.editable ? '通过 Docker Compose 启动' : '启动项目中已有的容器'" @click="trigger('up')"><Play class="h-3.5 w-3.5" :class="{ 'animate-spin': !actionContainerId && actionRunning === 'up' }" />启动</button>
          <button class="btn-secondary" :disabled="!project.managed || locked" title="重启现有容器，沿用当前镜像；应用新镜像请到运维页更新" @click="trigger('restart')"><RotateCw class="h-3.5 w-3.5" :class="{ 'animate-spin': !actionContainerId && actionRunning === 'restart' }" />重启</button>
          <button class="btn-secondary svc-card__stop" :disabled="!project.managed || locked" @click="trigger('stop')"><Square class="h-3.5 w-3.5" :class="{ 'animate-spin': !actionContainerId && actionRunning === 'stop' }" />停止</button>
          <button class="btn-secondary" :disabled="!project.editable || locked" title="完整备份后拉取镜像并重建当前 Compose 应用，应用最新配置" @click="$emit('rebuild')"><RefreshCw class="h-3.5 w-3.5" />重建</button>
        </div>
        <div class="svc-card__tools">
          <button class="btn-ghost" :disabled="!project.managed || locked" @click="trigger('ps')"><ListTree class="h-3.5 w-3.5" />状态</button>
          <button class="btn-ghost" :disabled="!project.editable || locked" title="需在项目纳管中勾选 Compose" @click="trigger('pull')"><Download class="h-3.5 w-3.5" :class="{ 'animate-spin': actionRunning === 'pull' }" />拉取</button>
          <button v-if="updateInfo?.hasUpdate" class="btn-ghost" :disabled="!project.editable || locked" title="平滑升级到最新镜像" @click="$emit('upgrade')"><Sparkles class="h-3.5 w-3.5" />平滑升级</button>
          <router-link class="btn-ghost" :class="{ 'pointer-events-none opacity-40': !project.editable }" :to="`/compose?projectId=${project.id}`"><FileCode2 class="h-3.5 w-3.5" />配置</router-link>
          <button class="btn-ghost" :disabled="busy" title="维护环境变量和账号密码" @click="$emit('env')"><KeyRound class="h-3.5 w-3.5" />环境与密钥</button>
          <button class="btn-ghost" :disabled="!project.managed || busy" @click="$emit('activity')"><History class="h-3.5 w-3.5" />活动</button>
          <button v-if="dbContainers.length" class="btn-ghost" :disabled="!project.managed || busy" title="导出数据库备份并下载" @click="$emit('db-dump')"><Database class="h-3.5 w-3.5" />备份数据库</button>
        </div>
        <span v-if="project.managed" class="svc-card__mode">{{ project.editable ? 'Compose 模式' : '现有容器模式' }}</span>
      </div>

      <div v-if="dependencyText || envPreview.length || project.note" class="svc-card__context">
        <p v-if="dependencyText" class="flex flex-wrap items-center gap-2"><GitBranch class="h-3.5 w-3.5" /><span>{{ dependencyText }}</span></p>
        <div v-if="envPreview.length">
          <button class="svc-card__env-toggle" @click="showEnvPreview = !showEnvPreview"><KeyRound class="h-3.5 w-3.5" />环境变量预览<ChevronDown class="h-3 w-3" :class="{ 'rotate-180': showEnvPreview }" /></button>
          <div v-if="showEnvPreview" class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            <span v-for="entry in envPreview" :key="entry.key" class="truncate font-mono text-[11px]"><span class="text-surface-500">{{ entry.key }}</span><span class="text-surface-400">={{ entry.masked }}</span></span>
          </div>
        </div>
        <p v-if="project.note" class="svc-card__note">{{ project.note }}</p>
      </div>

      <div v-if="!project.managed" class="alert-warning flex flex-col sm:flex-row sm:items-center gap-2">
        <span class="flex-1">项目尚未纳管，所有控制与容器入口均已禁用。</span>
        <router-link class="btn-ghost shrink-0" :to="`/settings?tab=mounts&projectId=${project.id}`"><FolderCog class="h-4 w-4" />项目纳管</router-link>
      </div>
      <div v-else-if="!project.editable" class="alert-warning flex flex-col sm:flex-row sm:items-center gap-2">
        <span v-if="project.mountState === 'remote_api_only'" class="flex-1">当前节点只有 Docker API、没有 SSH，无法编辑远端 Compose 文件。容器启停、日志和终端仍可用。</span>
        <template v-else>
          <span class="flex-1">当前可控制已有容器；请勾选 Compose 目录并应用挂载，解锁拉取、创建缺失服务和配置编辑。</span>
          <router-link class="btn-ghost shrink-0" :to="`/settings?tab=mounts&projectId=${project.id}`"><FolderCog class="h-4 w-4" />选择 Compose 目录</router-link>
        </template>
      </div>

      <div class="svc-card__containers">
        <div class="svc-card__container-heading"><span>应用容器</span><span>{{ project.containers.length.toString().padStart(2, '0') }}</span></div>
        <div v-for="container in project.containers" :key="container.id" class="svc-container">
          <span class="svc-container__state" :class="container.state === 'running' ? 'svc-container__state--running' : 'svc-container__state--stopped'"><Box class="h-4 w-4" /></span>
          <div class="svc-container__main">
            <div class="svc-container__title"><span class="svc-container__name">{{ container.name }}</span><span class="svc-container__state-label" :class="container.state === 'running' ? 'text-emerald-300' : 'text-rose-400'">{{ ({ running: '运行中', exited: '已停止', stopped: '已停止', paused: '已暂停', restarting: '重启中', created: '未启动', dead: '异常' })[container.state] || container.state }}</span><span v-if="container.health" class="svc-container__health" :class="healthClass(container.health)">{{ container.health }}</span></div>
            <div class="svc-container__image" :title="`实际运行镜像：${container.image}`"><span>运行镜像 · </span>{{ container.image }}</div>
            <ContainerPorts :container="container" :links="webuiLinks.filter((link) => link.containerId === container.id)" />
          </div>
          <div class="svc-container__metrics">
            <span v-if="metrics[container.id]?.cpu != null" class="svc-container__metric" :class="{ 'text-rose-400': metrics[container.id].cpu >= 85 }"><span>CPU</span><strong>{{ numberValue(metrics[container.id].cpu).toFixed(1) }}<small>%</small></strong></span>
            <span v-if="metrics[container.id]?.mem != null" class="svc-container__metric" :class="{ 'text-rose-400': metrics[container.id].mem >= 90 }"><span>内存</span><strong>{{ numberValue(metrics[container.id].memUsageMB).toFixed(0) }}<small>MB</small></strong></span>
            <span v-if="container.stoppedAt || container.startedAt" class="svc-container__uptime">{{ containerStateHint(container) }}</span>
          </div>
          <SparklineChart v-if="metrics[container.id]?.history?.length >= 2" :cpu="metrics[container.id].history.map((point) => point.cpuPercent)" :mem="metrics[container.id].history.map((point) => point.memPercent)" class="svc-container__sparkline" />
          <div class="svc-container__actions">
            <div class="svc-container__lifecycle" :aria-label="`${container.name} 启停`">
              <button v-if="!['running', 'restarting'].includes(container.state)" class="btn-ghost" :disabled="!project.managed || locked" :aria-label="`${container.state === 'paused' ? '恢复' : '启动'} ${container.name}`" @click="triggerContainer(container, 'up')"><LoaderCircle v-if="actionContainerId === container.id && actionRunning === 'up'" class="h-3.5 w-3.5 animate-spin" /><Play v-else class="h-3.5 w-3.5" />{{ container.state === 'paused' ? '恢复' : '启动' }}</button>
              <button v-if="['running', 'paused', 'restarting'].includes(container.state)" class="btn-ghost svc-container__stop" :disabled="!project.managed || locked" :aria-label="`停止 ${container.name}`" @click="triggerContainer(container, 'stop')"><LoaderCircle v-if="actionContainerId === container.id && actionRunning === 'stop'" class="h-3.5 w-3.5 animate-spin" /><Square v-else class="h-3.5 w-3.5" />停止</button>
              <button class="btn-ghost" :disabled="!project.managed || locked" :aria-label="`重启 ${container.name}`" title="重启现有容器，不会拉取或切换镜像" @click="triggerContainer(container, 'restart')"><RotateCw class="h-3.5 w-3.5" :class="{ 'animate-spin': actionContainerId === container.id && actionRunning === 'restart' }" />重启</button>
            </div>
            <router-link class="icon-btn" :class="{ 'pointer-events-none opacity-40': !project.managed }" title="实时日志" aria-label="实时日志" :to="{ path: '/logs', query: { projectId: project.id, containerId: container.id, from: 'services' } }"><ScrollText class="h-4 w-4" /></router-link>
            <router-link v-if="dbContainers.length" class="icon-btn" :class="{ 'pointer-events-none opacity-40': !project.managed }" title="聚合日志（所有容器）" aria-label="聚合日志" :to="{ path: '/logs', query: { projectId: project.id, from: 'services' } }"><Layers class="h-4 w-4" /></router-link>
            <router-link class="icon-btn" :class="{ 'pointer-events-none opacity-40': !project.managed }" title="容器终端" aria-label="容器终端" :to="`/shell?projectId=${project.id}&containerId=${container.id}`"><TerminalSquare class="h-4 w-4" /></router-link>
            <router-link class="icon-btn" :class="{ 'pointer-events-none opacity-40': !project.managed }" title="AI 诊断" aria-label="AI 诊断" :to="`/agent?projectId=${project.id}&containerId=${container.id}&diagnose=1`"><Bot class="h-4 w-4" /></router-link>
          </div>
        </div>
      </div>
    </div>
  </article>
  <ConfirmDialog :show="stopConfirm" title="停止项目容器" :message="`确认停止 ${project.projectName} 中现有的容器?不会删除容器和网络。`" tone="warning" confirm-text="停止容器" @confirm="confirmStop" @cancel="stopConfirm = false" />
  <ConfirmDialog :show="!!stopContainer" title="停止单个容器" :message="`确认停止 ${stopContainer?.name || ''}？同组其他容器将继续运行。`" tone="warning" confirm-text="停止容器" @confirm="confirmContainerStop" @cancel="stopContainer = null" />
</template>

<script setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { Bot, Box, ChevronDown, Database, Download, FileCode2, Folder, FolderCog, GitBranch, History, KeyRound, Layers, ListTree, LoaderCircle, Pencil, Play, RefreshCw, RotateCw, ScrollText, Sparkles, Square, Star, TerminalSquare } from 'lucide-vue-next';
import StatusBadge from '../common/StatusBadge.vue';
import WebUiLauncher from './WebUiLauncher.vue';
import ContainerPorts from './ContainerPorts.vue';
import SparklineChart from '../common/SparklineChart.vue';
import { api, streamProjectStats } from '../../api/client.js';
import ConfirmDialog from '../common/ConfirmDialog.vue';

const props = defineProps({
  project: { type: Object, required: true },
  expanded: Boolean,
  selected: Boolean,
  focused: Boolean,
  busy: Boolean,
  actionRunning: { type: String, default: '' },
  actionContainerId: { type: String, default: '' },
  lastResults: { type: Array, default: () => [] },
});
const emit = defineEmits(['toggle-expand', 'toggle-select', 'action', 'container-action', 'rebuild', 'activity', 'env', 'credentials', 'db-dump', 'upgrade', 'refresh']);
const stopConfirm = ref(false);
const stopContainer = ref(null);

const metrics = ref({});
const updateInfo = ref(null);
const webuiLinks = ref([]);
const dependencyMap = ref(new Map());
const envPreview = ref([]);
const showEnvPreview = ref(false);
let statsAbort = null;
let statsTimer = null;

watch(() => props.expanded, (expanded) => {
  if (!expanded) { closeStats(); return; }
  openStats();
});
watch(() => props.project.id, () => { closeStats(); checkUpdates(); loadDependencies(); loadEnvPreview(); if (props.expanded) openStats(); });
onMounted(() => { checkUpdates(); loadDependencies(); loadEnvPreview(); if (props.expanded) openStats(); });
let activatedBefore = false;
onActivated(() => {
  if (!activatedBefore) { activatedBefore = true; return; }
  if (props.expanded) openStats();
});
onDeactivated(() => { closeStats(); });
onBeforeUnmount(() => { webuiRequest++; closeStats(); });

async function checkUpdates() {
  updateInfo.value = null;
  if (!props.project.managed) return;
  try {
    updateInfo.value = await api.getProjectUpdates(props.project.id);
  } catch {
    updateInfo.value = null; // 检测失败静默,不打断列表
  }
}

let webuiRequest = 0;
async function loadWebUi() {
  const requestId = ++webuiRequest;
  webuiLinks.value = [];
  if (!props.project.managed) return;
  try {
    const data = await api.getProjectWebUi(props.project.id);
    if (requestId !== webuiRequest) return;
    webuiLinks.value = (data?.links || []).flatMap((entry) => entry.ports.map((port) => ({ port: port.port, url: port.url, containerId: entry.containerId, containerName: entry.containerName, serviceName: entry.serviceName, source: entry.source })));
  } catch {
    if (requestId === webuiRequest) webuiLinks.value = []; // 检测失败静默
  }
}
watch(() => JSON.stringify([props.project.id, props.project.managed, props.project.containers.map(({ id, state, ports, hostPorts }) => ({ id, state, ports, hostPorts }))]), loadWebUi, { immediate: true });

async function loadEnvPreview() {
  envPreview.value = [];
  if (!props.project.editable) return;
  try {
    const data = await api.getProjectEnv(props.project.id, true);
    const entries = data?.entries || data?.env || [];
    if (!Array.isArray(entries)) return;
    envPreview.value = entries.slice(0, 24).map((entry) => {
      const key = String(entry.key || '').split('=')[0];
      const value = String(entry.value ?? entry[key] ?? '');
      const isSecret = /(SECRET|TOKEN|PASSWORD|PASSWD|\bPASS\b|(?:API|PRIVATE|ACCESS|SECRET|AUTH|SIGNING)[_-]?KEY)/i.test(key);
      return { key, masked: isSecret ? '••••••' : (value.length > 28 ? value.slice(0, 28) + '…' : value) };
    });
  } catch { envPreview.value = []; }
}
async function loadDependencies() {
  dependencyMap.value = new Map();
  if (!props.project.editable) return;
  try {
    const file = await api.getComposeFile(props.project.id, 0, true);
    const doc = (await import('yaml')).parse(file.content || '');
    if (doc?.services && typeof doc.services === 'object') {
      const map = new Map();
      for (const [name, service] of Object.entries(doc.services)) {
        const raw = service?.depends_on;
        if (!raw) continue;
        const deps = Array.isArray(raw) ? raw : typeof raw === 'object' ? Object.keys(raw) : String(raw).split(',');
        map.set(name, deps);
      }
      dependencyMap.value = map;
    }
  } catch {
    dependencyMap.value = new Map(); // 静默失败
  }
}

async function openStats() {
  closeStats();
  if (!props.project.managed || !props.project.containers.some((c) => c.state === 'running')) return;
  statsAbort = new AbortController();
  try {
    await streamProjectStats(props.project.id, (frame) => {
      if (frame.type === 'stats') applyStats(frame.data || []);
      else if (frame.type === 'error') { /* 指标流按节点能力静默降级 */ }
    }, statsAbort.signal, 2500);
  } catch {
    // fetch abort 或网络错误:静默降级,不打断卡片交互
  }
}
function applyStats(rows) {
  const next = { ...metrics.value };
  for (const row of rows) {
    const prev = next[row.containerId] || { history: [] };
    const history = [...prev.history, { cpuPercent: numberValue(row.cpuPercent), memPercent: numberValue(row.memPercent) }];
    if (history.length > 26) history.shift();
    next[row.containerId] = { cpu: numberValue(row.cpuPercent), mem: numberValue(row.memPercent), memUsageMB: numberValue(row.memUsageMB), history };
  }
  metrics.value = next;
}
function numberValue(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function closeStats() {
  if (statsAbort) {
    try { statsAbort.abort(); } catch {
      // 流已结束时 abort 可能抛错,清理本地引用仍然必须继续。
    }
    statsAbort = null;
  }
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
  metrics.value = {};
}

const locked = computed(() => props.busy || !!props.actionRunning);
const dbContainers = computed(() => props.project.containers.filter((c) => /(postgres|postgis|mysql|mariadb|redis|valkey|mongo)/i.test(c.image)));
const attention = computed(() => props.project.status !== 'running' || props.project.containers.some((container) => container.health === 'unhealthy'));
const statusHint = computed(() => {
  if (!props.project.containers.length) return '';
  // 最近一次状态变化:优先 'x 分钟前停止',其次启动时间
  const stopped = props.project.containers.filter((c) => c.state !== 'running' && c.stoppedAt);
  if (stopped.length) {
    const latest = stopped.reduce((a, b) => (a.stoppedAt > b.stoppedAt ? a : b));
    return `${timeAgo(latest.stoppedAt)}前停止`;
  }
  const running = props.project.containers.filter((c) => c.state === 'running' && c.startedAt);
  if (running.length) {
    const latest = running.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));
    return `${timeAgo(latest.startedAt)}前启动`;
  }
  return '';
});
const dependencyText = computed(() => {
  const entries = [...dependencyMap.value.entries()]
    .filter(([, deps]) => deps && deps.length)
    .map(([name, deps]) => `${name} → ${deps.join(', ')}`);
  return entries.slice(0, 3).join(' · ');
});
const imageState = computed(() => {
  const matches = props.lastResults.filter((result) => props.project.containers.some((container) => container.image === result.image));
  if (matches.some((result) => result.status === 'updated' && props.project.containers.some((container) => container.image === result.image && container.imageId !== result.after))) return 'updated';
  if (matches.some((result) => result.status === 'failed')) return 'failed';
  return matches.length ? 'current' : '';
});

function trigger(action) {
  if (!props.project.managed || locked.value) return;
  if (action === 'stop') { stopConfirm.value = true; return; }
  emit('action', action);
}
function confirmStop() { stopConfirm.value = false; if (!locked.value) emit('action', 'stop'); }
function triggerContainer(container, action) {
  if (!props.project.managed || locked.value) return;
  if (action === 'stop') { stopContainer.value = container; return; }
  emit('container-action', { container, action });
}
function confirmContainerStop() {
  const container = stopContainer.value;
  stopContainer.value = null;
  if (container && props.project.managed && !locked.value) emit('container-action', { container, action: 'stop' });
}
async function toggleFavorite(project) { project.favorite = !project.favorite; await api.saveProjectPreference(project.id, { favorite: project.favorite }); emit('refresh'); }
async function editNote(project) {
  const note = window.prompt('项目备注（最多 500 字）', project.note || '');
  if (note === null) return;
  project.note = note.slice(0, 500); await api.saveProjectPreference(project.id, { note: project.note });
}
function healthClass(health) { return health === 'unhealthy' ? 'text-rose-400' : health === 'healthy' ? 'text-emerald-400' : 'text-amber-400'; }
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - Number(ts));
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `${days} 天`;
}
function containerStateHint(container) {
  if (container.state !== 'running' && container.stoppedAt) return `${timeAgo(container.stoppedAt)}前停止`;
  if (container.state === 'running' && container.startedAt) return `${timeAgo(container.startedAt)}前启动`;
  return '';
}
</script>

<style scoped src="./service-project-card.css"></style>
