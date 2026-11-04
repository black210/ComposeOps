<template>
  <div class="page-shell" :aria-busy="busy || loading">
    <header class="page-header">
      <div>
        <h1 class="page-title">运维</h1>
        <p class="page-subtitle">容器更新、完整备份与远端同步</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="!plan && tab === 'containers'"
          class="btn-secondary"
          :disabled="busy || loading"
          @click="checkUpdates"
        >
          检查镜像更新</button
        ><button class="btn-secondary" :disabled="loading || busy" @click="load()">
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />刷新
        </button>
      </div>
    </header>
    <p v-if="error" class="alert-error break-words" role="alert">{{ error }}</p>
    <p v-if="notice" class="text-sm text-accent" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="loading" class="sr-only" role="status">正在加载运维信息</p>

    <template v-if="plan">
      <div class="flex items-center justify-between gap-3">
        <h2 class="section-title">{{ plan.action === 'update' ? '更新前完整备份确认' : '完整备份确认' }}</h2>
        <button class="btn-ghost" :disabled="busy" @click="plan = null">返回列表</button>
      </div>
      <section class="section-panel space-y-4">
        <div>
          <h3 class="section-title">备份保存路径</h3>
          <label class="mt-3 block text-sm"
            >当前节点的宿主机目录<input
              v-model="backupPath"
              class="input mt-2 w-full"
              aria-label="本次备份保存路径"
              @input="invalidatePlan"
          /></label>
          <p class="mt-2 break-all text-xs text-muted">本次清单使用：{{ plan.backupPath }}</p>
          <button
            class="btn-secondary mt-3"
            :disabled="busy"
            @click="
              prepare(
                plan.action,
                plan.selected.map((c) => c.id)
              )
            "
          >
            重新预检路径及范围
          </button>
        </div>
        <label class="flex items-center gap-2 text-sm"
          ><input v-model="makeDefault" type="checkbox" />同时设为默认保存路径</label
        >
      </section>
      <section class="section-panel space-y-3">
        <h3 class="section-title">完整范围 · {{ plan.members.length }} 个容器</h3>
        <p class="text-sm break-words">{{ plan.members.map((c) => c.name).join('、') }}</p>
        <p v-if="plan.members.length > plan.selected.length" class="text-sm text-amber-400">
          已自动纳入同应用关联容器，一起协调停写；更新时只重建所选服务。
        </p>
        <ul class="space-y-2 text-sm">
          <li>部署配置、全部 env / secret 引用及构建资料</li>
          <li>宿主机目录和单文件挂载、命名卷及匿名卷</li>
          <li>原始镜像、容器可写层镜像、网络及完整容器重建参数</li>
          <li>属主、权限、ACL、扩展属性、软硬链接与恢复清单</li>
        </ul>
        <details>
          <summary class="text-sm text-accent">查看具体路径和数据卷</summary>
          <ul class="mt-3 space-y-1 text-xs text-muted">
            <li v-for="source in plan.sources" :key="source.kind + source.source" class="break-all">
              {{ source.kind === 'volume' ? 'Docker 卷' : '宿主机路径' }}：{{ source.source }}
            </li>
          </ul>
        </details>
      </section>
      <section class="section-panel space-y-3">
        <h3 class="section-title">停机与空间影响</h3>
        <p class="text-sm">{{ plan.downtime }}</p>
        <p class="text-sm">
          预计原始备份量 {{ bytes(plan.estimatedBytes) }}；可用空间
          {{ bytes(plan.freeBytes) }}。镜像先保存，再进入数据停机归档。
        </p>
        <p class="text-sm">
          所有原运行容器必须干净退出，备份后恢复原启停状态并检查健康。无法覆盖的项会阻止执行。
        </p>
        <p class="text-sm">
          每个文件使用 AES-256-GCM 加密并解密读回校验；文件校验通过后仍需另做实际恢复演练。
        </p>
        <ul class="space-y-2 text-xs text-muted">
          <li v-for="warning in plan.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </section>
      <section v-if="plan.blockers.length" class="alert-error" role="alert">
        <h3>预检未通过，不能开始</h3>
        <ul class="mt-2 list-disc pl-5">
          <li v-for="blocker in plan.blockers" :key="blocker">{{ blocker }}</li>
        </ul>
      </section>
      <section class="section-panel space-y-4">
        <a
          class="btn-secondary inline-flex"
          href="/api/v1/maintenance/recovery-key"
          download="composeops-recovery.key"
          ><Download class="h-4 w-4" />下载恢复密钥</a
        >
        <p class="text-xs text-muted">
          密钥应单独保存到本机或密码管理器，不放进备份目录或同一网盘。丢失密钥无法解密备份。
        </p>
        <label class="flex items-start gap-2 text-sm"
          ><input v-model="keySaved" type="checkbox" class="mt-1" />恢复密钥已单独保存</label
        >
        <label class="flex items-start gap-2 text-sm"
          ><input
            v-model="confirmed"
            type="checkbox"
            class="mt-1"
          />已确认完整范围及停机影响，并确保没有其他程序继续写入</label
        >
        <button class="btn-primary" :disabled="!canExecute" @click="execute">
          <Archive class="h-4 w-4" />{{
            busy ? '提交中…' : plan.action === 'update' ? '完整备份后更新' : '开始完整备份'
          }}
        </button>
      </section>
    </template>

    <template v-else>
      <div class="tabs flex-wrap" role="tablist" aria-label="运维页签">
        <button
          v-for="item in tabs"
          :id="'maintenance-tab-' + item.id"
          :key="item.id"
          role="tab"
          :class="{ active: tab === item.id }"
          :aria-selected="tab === item.id"
          aria-controls="maintenance-panel"
          @click="setTab(item.id)"
          @keydown="tabKeydown"
        >
          {{ item.name }}
        </button>
      </div>
      <div
        id="maintenance-panel"
        role="tabpanel"
        :aria-labelledby="'maintenance-tab-' + tab"
        class="space-y-5"
      >
        <template v-if="tab === 'containers'">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <input
              v-model="query"
              class="input w-full sm:w-72"
              placeholder="搜索容器、应用或镜像"
              aria-label="搜索容器、应用或镜像"
            /><span class="text-xs text-muted">当前节点 · {{ data.containers.length }} 个容器</span>
          </div>
          <div class="section-panel flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-4">
              <label class="flex items-center gap-2 text-sm"
                ><input
                  type="checkbox"
                  :checked="allSelected"
                  :indeterminate.prop="selected.length > 0 && !allSelected"
                  @change="selected = $event.target.checked ? data.containers.map((c) => c.id) : []"
                />选择全部容器</label
              ><span class="text-xs text-muted">已选 {{ selected.length }} 个</span>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                class="btn-secondary"
                :disabled="busy || !selected.length"
                @click="prepare('backup', selected)"
              >
                备份所选</button
              ><button
                class="btn-primary"
                :disabled="busy || !selected.length"
                @click="prepare('update', selected)"
              >
                更新所选
              </button>
            </div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th><span class="sr-only">选择</span></th>
                  <th>容器 / 当前镜像</th>
                  <th>所属应用</th>
                  <th>状态</th>
                  <th>镜像更新</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="container in filtered" :key="container.id">
                  <td>
                    <input
                      v-model="selected"
                      type="checkbox"
                      :value="container.id"
                      :aria-label="'选择 ' + container.name"
                    />
                  </td>
                  <td>
                    <p class="font-medium text-surface-100 break-words">{{ container.name }}</p>
                    <p class="text-xs text-muted break-all">{{ container.image }}</p>
                  </td>
                  <td>{{ container.projectName || (container.helper ? '辅助容器' : '独立容器') }}</td>
                  <td>{{ stateLabel(container.state) }}</td>
                  <td>
                    <span
                      class="text-xs"
                      :class="updates[container.id]?.hasUpdate ? 'text-amber-400' : 'text-muted'"
                      >{{ updateLabel(updates[container.id]) }}</span
                    >
                  </td>
                  <td>
                    <div class="flex gap-3">
                      <button
                        class="text-sm text-accent"
                        :disabled="busy"
                        @click="prepare('update', [container.id])"
                      >
                        更新</button
                      ><button
                        class="text-sm text-accent"
                        :disabled="busy"
                        @click="prepare('backup', [container.id])"
                      >
                        备份
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!filtered.length && !loading" class="p-6 text-center text-sm text-muted">没有匹配容器</p>
          </div>
          <p class="text-xs text-muted">
            完整备份自动覆盖同 Compose
            应用。面板自身、临时辅助容器或无法完整保存的数据会在预检中明确阻止；独立容器需先有 Compose
            定义才能更新。
          </p>
        </template>

        <template v-if="tab === 'backups'">
          <section class="section-panel space-y-3">
            <h2 class="section-title">默认备份保存路径</h2>
            <label class="block text-sm"
              >当前节点的宿主机目录<input
                v-model="backupPath"
                class="input mt-2 w-full"
                aria-label="默认备份保存路径"
                placeholder="/vol1/1000/backups/composeops"
            /></label>
            <p class="text-xs text-muted">
              目录必须已存在且可写。只保存后续备份，不会移动旧备份；不能与备份源重叠。
            </p>
            <button class="btn-secondary" :disabled="busy || !backupPath" @click="savePath">
              检查并保存
            </button>
          </section>
          <section v-for="backup in data.backups" :key="backup.id" class="section-panel space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="section-title">{{ backup.names.join('、') }}</h3>
                <p class="text-xs text-muted mt-1">
                  {{ time(backup.createdAt) }} · {{ bytes(backup.bytes) }}
                </p>
              </div>
              <span class="status-badge text-accent">完整备份 · 文件校验通过</span>
            </div>
            <p class="break-all text-xs text-muted">{{ backup.path }}</p>
            <p class="text-xs text-muted">
              覆盖配置、挂载、全部卷、镜像、可写层及恢复清单；尚未验证实际恢复。
            </p>
            <button
              class="btn-secondary"
              :disabled="busy || !targets.some((t) => t.tested)"
              @click="openSync(backup)"
            >
              同步此备份
            </button>
          </section>
          <p v-if="!data.backups.length && !loading" class="text-sm text-muted">
            暂无已完成且校验通过的完整备份。未完成的备份只在任务记录中显示。
          </p>
        </template>

        <template v-if="tab === 'sync'">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="section-title">同步目标</h2>
              <p class="mt-1 text-xs text-muted">完整备份产物单向推送；应用恢复运行后上传</p>
            </div>
            <button class="btn-primary" :disabled="busy" @click="editTarget()">
              <Plus class="h-4 w-4" />添加目标
            </button>
          </div>
          <section v-for="target in targets" :key="target.id" class="section-panel space-y-3">
            <div class="flex flex-wrap justify-between gap-3">
              <div>
                <h3 class="section-title">
                  {{ target.name }}
                  <span class="text-xs text-muted">{{
                    target.type === '115' ? '115 官方直连' : 'WebDAV'
                  }}</span>
                </h3>
                <p class="mt-1 text-xs text-muted break-all">{{ target.remotePath }}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button class="btn-secondary" :disabled="busy" @click="editTarget(target)">编辑</button
                ><button
                  class="btn-secondary"
                  :disabled="busy || !target.authorized"
                  @click="testTarget(target)"
                >
                  测试连接</button
                ><button
                  v-if="target.type === '115'"
                  class="btn-secondary"
                  :disabled="busy"
                  @click="authorize(target)"
                >
                  {{ target.authorized ? '重新授权' : '扫码授权 115' }}
                </button>
              </div>
            </div>
            <p class="text-xs" :class="target.tested ? 'text-accent' : 'text-amber-400'">
              {{
                target.tested
                  ? '上传及远端校验已通过'
                  : target.authorized
                    ? '已配置认证，待测试上传权限'
                    : '尚未授权或配置密码'
              }}
            </p>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <label class="flex gap-2 items-center text-sm"
                ><input
                  type="checkbox"
                  :checked="target.auto"
                  :disabled="busy || !target.tested"
                  @change="automatic(target, $event.target.checked)"
                />备份成功后自动同步</label
              ><button
                class="btn-primary"
                :disabled="busy || !target.tested || !data.backups.length"
                @click="openSync(null, target)"
              >
                立即同步
              </button>
            </div>
          </section>
          <p v-if="!targets.length" class="text-sm text-muted">尚未配置同步目标。</p>
          <p class="text-xs text-muted">
            保留本地副本。按节点和备份批次保存，失败可独立重试；只有全部文件通过远端校验才显示同步成功。测试连接会写入独立测试文件。
          </p>
        </template>

        <template v-if="tab === 'tasks'">
          <p class="text-xs text-muted">原“运维任务”已合并。统一查看更新、完整备份、同步及失败记录。</p>
          <section v-for="task in data.tasks" :key="task.id" class="section-panel space-y-2">
            <div class="flex flex-wrap justify-between gap-2">
              <h3 class="section-title">{{ actionLabel(task.action) }} · {{ task.names.join('、') }}</h3>
              <span
                class="status-badge"
                :class="
                  task.status === 'success'
                    ? 'text-accent'
                    : ['failed', 'interrupted'].includes(task.status)
                      ? 'text-rose-400'
                      : 'text-amber-400'
                "
                >{{ taskLabel(task.status) }}</span
              >
            </div>
            <p class="text-sm break-words">{{ task.stage }}</p>
            <p class="text-xs text-muted">{{ time(task.createdAt) }}</p>
            <p v-if="task.backupPath" class="break-all text-xs text-muted">{{ task.backupPath }}</p>
            <button
              v-if="['failed', 'interrupted'].includes(task.status) && task.originallyRunning?.length"
              class="btn-secondary"
              :disabled="busy"
              @click="recoverTarget = task"
            >
              恢复原运行容器</button
            ><button
              v-if="
                task.action === 'sync' &&
                task.status === 'failed' &&
                targets.some((t) => t.id === task.targetId)
              "
              class="btn-secondary"
              :disabled="busy"
              @click="
                openSync(
                  null,
                  targets.find((t) => t.id === task.targetId)
                )
              "
            >
              重新选择备份并重试
            </button>
          </section>
          <p v-if="!data.tasks.length && !loading" class="text-sm text-muted">暂无任务记录。</p>
          <details class="section-panel" @toggle="legacyOpen = $event.target.open">
            <summary class="text-sm text-accent">原定时运维计划、Agent 后台任务与巡检</summary>
            <p class="mt-3 text-xs text-muted">原定时“数据卷备份”只备份命名卷，不属于本页的完整备份。</p>
            <OperationsCenterView v-if="legacyOpen" embedded />
          </details>
        </template>
      </div>
    </template>

    <BaseModal :show="!!draft" title="同步目标配置" size-class="sm:max-w-2xl" @close="draft = null">
      <form v-if="draft" class="p-4 space-y-4" @submit.prevent="saveTarget">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-sm"
            >目标名称<input v-model="draft.name" class="input mt-2 w-full" required /></label
          ><label class="text-sm"
            >目标类型<select v-model="draft.type" class="input mt-2 w-full">
              <option value="115">115 网盘（官方直连）</option>
              <option value="webdav">WebDAV</option>
            </select></label
          >
        </div>
        <template v-if="draft.type === '115'"
          ><label class="block text-sm"
            >115 开放平台 Client ID<input
              v-model="draft.clientId"
              class="input mt-2 w-full"
              inputmode="numeric"
              required
          /></label>
          <p class="text-xs text-muted">
            使用你在 115 开放平台申请的应用，保存后在面板中扫码授权，不需要输入 115 密码。
          </p></template
        >
        <template v-else
          ><label class="block text-sm"
            >WebDAV 服务地址<input
              v-model="draft.url"
              type="url"
              class="input mt-2 w-full"
              placeholder="https://dav.example.com/dav"
              required
          /></label>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="text-sm"
              >用户名<input
                v-model="draft.user"
                class="input mt-2 w-full"
                autocomplete="off"
                required /></label
            ><label class="text-sm"
              >密码 / 应用专用密码<input
                v-model="draft.password"
                type="password"
                class="input mt-2 w-full"
                autocomplete="new-password"
                :placeholder="draft.authorized ? '留空保留已保存密码' : ''"
            /></label></div
        ></template>
        <label class="block text-sm"
          >远端保存目录<input
            v-model="draft.remotePath"
            class="input mt-2 w-full"
            placeholder="/ComposeOps"
            required
        /></label>
        <p class="text-xs text-muted">保存修改后需重新测试连接。自动同步开关在测试成功后开启。</p>
        <div class="flex justify-end gap-2">
          <button class="btn-ghost" type="button" @click="draft = null">取消</button
          ><button class="btn-primary" type="submit" :disabled="busy">保存目标</button>
        </div>
      </form>
    </BaseModal>
    <BaseModal :show="!!authSession" title="115 官方扫码授权" @close="stopAuth">
      <div v-if="authSession" class="p-5 space-y-4 text-center">
        <img :src="authSession.qrImage" alt="115 授权二维码" class="mx-auto h-60 w-60 max-w-full" />
        <p class="text-sm" role="status" aria-live="polite">{{ authMessage }}</p>
        <p class="text-xs text-muted">使用 115 App 扫码并确认授权，二维码约三分钟有效。</p>
        <button class="btn-secondary" @click="stopAuth">关闭</button>
      </div>
    </BaseModal>
    <BaseModal :show="!!syncChoice" title="确认同步范围" @close="syncChoice = null">
      <div v-if="syncChoice" class="p-4 space-y-4">
        <label class="block text-sm"
          >同步目标<select v-model="syncChoice.targetId" class="input mt-2 w-full">
            <option v-for="target in targets.filter((t) => t.tested)" :key="target.id" :value="target.id">
              {{ target.name }}
            </option>
          </select></label
        >
        <p class="text-sm">
          推送
          {{ syncChoice.backupIds.length }}
          份完整备份到所选目标，包含加密配置、镜像、数据和恢复清单。本地副本保留。
        </p>
        <p class="text-xs text-muted break-all">
          {{ targets.find((t) => t.id === syncChoice.targetId)?.remotePath }}
        </p>
        <button class="btn-primary" :disabled="busy" @click="syncNow">确认并开始同步</button>
      </div>
    </BaseModal>
    <ConfirmDialog
      :show="!!recoverTarget"
      title="恢复备份前运行状态"
      message="只启动该次备份日志中原来运行、但尚未恢复的容器，不恢复或覆盖任何备份数据。请先确认没有其他人正在操作这些容器。"
      :busy="busy"
      confirm-text="恢复原运行容器"
      @cancel="recoverTarget = null"
      @confirm="recover"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Archive, Download, Plus, RefreshCw } from 'lucide-vue-next';
import { api } from '../api/client.js';
import BaseModal from '../components/common/BaseModal.vue';
import ConfirmDialog from '../components/common/ConfirmDialog.vue';
import OperationsCenterView from './OperationsCenterView.vue';

const tabs = [
  { id: 'containers', name: '容器运维' },
  { id: 'backups', name: '备份记录' },
  { id: 'sync', name: '同步' },
  { id: 'tasks', name: '任务记录' },
];
const route = useRoute(),
  router = useRouter();
const tab = ref(tabs.some((t) => t.id === route.query.tab) ? route.query.tab : 'containers');
const data = ref({ containers: [], backups: [], tasks: [], hostId: '', settings: {} });
const targets = ref([]),
  selected = ref([]),
  query = ref(''),
  backupPath = ref('');
const updates = ref({});
const plan = ref(null),
  confirmed = ref(false),
  keySaved = ref(false),
  makeDefault = ref(false),
  planStale = ref(false);
const busy = ref(false),
  loading = ref(false),
  error = ref(''),
  notice = ref(''),
  draft = ref(null),
  syncChoice = ref(null),
  recoverTarget = ref(null),
  legacyOpen = ref(false);
const authSession = ref(null),
  authMessage = ref('等待扫码');
let pollTimer,
  authTimer,
  epoch = 0,
  disposed = false;
const filtered = computed(() =>
  data.value.containers.filter((c) =>
    (c.name + ' ' + c.image + ' ' + c.projectName).toLowerCase().includes(query.value.toLowerCase())
  )
);
const allSelected = computed(
  () => !!data.value.containers.length && selected.value.length === data.value.containers.length
);
const canExecute = computed(
  () =>
    !!plan.value &&
    !busy.value &&
    !planStale.value &&
    !plan.value.blockers.length &&
    plan.value.coverageVerified &&
    confirmed.value &&
    keySaved.value
);
async function load(quiet = false) {
  if (loading.value || disposed) return;
  loading.value = true;
  const current = epoch;
  try {
    const [overview, result] = await Promise.all([api.getMaintenance(), api.getSyncTargets()]);
    if (current !== epoch || disposed) return;
    data.value = overview;
    targets.value = result.targets;
    if (!backupPath.value) backupPath.value = overview.settings.backupPath || '';
    if (!quiet) error.value = '';
  } catch (e) {
    if (current === epoch && !disposed) error.value = e.message;
  } finally {
    if (current === epoch) loading.value = false;
  }
}
async function perform(fn) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  const current = epoch;
  try {
    await fn(() => current === epoch && !disposed);
  } catch (e) {
    if (current === epoch && !disposed) error.value = e.message;
  } finally {
    if (current === epoch) busy.value = false;
  }
}
function setTab(value) {
  tab.value = value;
  router.replace({ query: { ...route.query, tab: value } });
}
function tabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const i = tabs.findIndex((t) => t.id === tab.value),
    next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
  setTab(tabs[next].id);
  document.getElementById('maintenance-tab-' + tabs[next].id)?.focus();
}
function invalidatePlan() {
  planStale.value = true;
  confirmed.value = false;
}
function prepare(action, ids) {
  return perform(async (valid) => {
    const result = await api.prepareMaintenance({
      action,
      containerIds: [...ids],
      backupPath: backupPath.value,
    });
    if (!valid()) return;
    plan.value = result;
    planStale.value = false;
    confirmed.value = false;
    makeDefault.value = false;
  });
}
function execute() {
  if (!canExecute.value) return;
  return perform(async (valid) => {
    await api.executeMaintenance({
      token: plan.value.token,
      confirmed: true,
      keySaved: keySaved.value,
      makeDefault: makeDefault.value,
    });
    if (!valid()) return;
    plan.value = null;
    selected.value = [];
    notice.value = '任务已提交，完整备份执行器会独立运行。';
    setTab('tasks');
    await load(true);
  });
}
function savePath() {
  return perform(async (valid) => {
    await api.saveMaintenanceSettings(backupPath.value);
    if (valid()) {
      notice.value = '备份路径已检查并保存。';
      await load(true);
    }
  });
}
function checkUpdates() {
  return perform(async (valid) => {
    const result = await api.checkAllUpdates();
    if (!valid()) return;
    const checked = {};
    for (const c of data.value.containers) {
      const project = result.projects.find((p) => p.projectId === c.projectId);
      checked[c.id] = project?.images.find((i) => i.service === c.service) || {
        status: project?.error ? 'failed' : 'unsupported',
      };
    }
    updates.value = checked;
    notice.value = '镜像检查完成；只检查，不执行拉取或重建。';
  });
}
function updateLabel(item) {
  if (!item) return '待检查';
  if (item.hasUpdate) return '有镜像更新';
  return (
    {
      current: '已是最新',
      up_to_date: '已是最新',
      pinned: '固定镜像',
      local_build: '本地构建',
      local_only: '仅本地镜像',
      failed: '检查失败',
      unknown: '无法比较',
      unsupported: '需 Compose 定义',
      needs_policy: '需明确镜像策略',
      unresolved: '未解析',
    }[item.status] || '无法比较'
  );
}
function editTarget(target = null) {
  draft.value = target
    ? { ...target, password: '' }
    : { type: '115', name: '', remotePath: '/ComposeOps', clientId: '', url: '', user: '', password: '' };
}
function saveTarget() {
  return perform(async (valid) => {
    const d = draft.value,
      payload = {
        type: d.type,
        name: d.name,
        remotePath: d.remotePath,
        url: d.url || '',
        user: d.user || '',
        password: d.password || '',
        clientId: d.clientId || '',
        auto: false,
      };
    if (d.id) payload.id = d.id;
    await api.saveSyncTarget(payload);
    if (valid()) {
      draft.value = null;
      notice.value = '目标已保存，请授权并测试连接。';
      await load(true);
    }
  });
}
function testTarget(target) {
  return perform(async (valid) => {
    await api.startBackupSync({ targetId: target.id, test: true, confirmed: true });
    if (valid()) {
      notice.value = '已开始测试上传和校验，可在任务记录查看结果。';
      await load(true);
    }
  });
}
function automatic(target, auto) {
  return perform(async (valid) => {
    const result = await api.setSyncAutomatic(target.id, auto);
    if (valid()) targets.value = result.targets;
  });
}
function openSync(backup = null, target = null) {
  const available = targets.value.filter((t) => t.tested);
  if (!available.length) return;
  syncChoice.value = {
    targetId: target?.id || available[0].id,
    backupIds: backup ? [backup.id] : data.value.backups.map((b) => b.id),
  };
}
function syncNow() {
  return perform(async (valid) => {
    await api.startBackupSync({ ...syncChoice.value, confirmed: true });
    if (valid()) {
      syncChoice.value = null;
      setTab('tasks');
      await load(true);
    }
  });
}
function stopAuth() {
  clearTimeout(authTimer);
  authSession.value = null;
}
function authorize(target) {
  return perform(async (valid) => {
    const session = await api.authorize115(target.id);
    if (!valid()) return;
    authSession.value = session;
    authMessage.value = '等待扫码';
    authTimer = setTimeout(pollAuth, 2500);
  });
}
async function pollAuth() {
  const session = authSession.value,
    current = epoch;
  if (!session || disposed) return;
  try {
    const result = await api.pollAuthorize115(session.id);
    if (disposed || current !== epoch || authSession.value?.id !== session.id) return;
    if (result.status === 'authorized') {
      stopAuth();
      notice.value = '115 授权成功，请测试连接。';
      await load(true);
      return;
    }
    if (result.status === 'expired') {
      authMessage.value = '二维码已失效，请关闭后重新授权';
      return;
    }
    authMessage.value = result.status === 'scanned' ? '已扫码，等待 115 App 确认' : '等待扫码';
    authTimer = setTimeout(pollAuth, 2500);
  } catch (e) {
    if (current === epoch && !disposed) authMessage.value = '授权状态读取失败，请关闭后重试：' + e.message;
  }
}
function recover() {
  return perform(async (valid) => {
    await api.recoverMaintenanceTask(recoverTarget.value.id);
    if (valid()) {
      recoverTarget.value = null;
      await load(true);
    }
  });
}
function hostChanged() {
  epoch++;
  loading.value = false;
  busy.value = false;
  data.value = { containers: [], tasks: [], backups: [], settings: {} };
  selected.value = [];
  updates.value = {};
  backupPath.value = '';
  plan.value = null;
  draft.value = null;
  syncChoice.value = null;
  stopAuth();
  void load();
}
function bytes(n) {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + units[i];
}
function time(value) {
  return value ? new Date(value).toLocaleString() : '—';
}
function stateLabel(state) {
  return (
    { running: '运行中', exited: '已停止', paused: '已暂停', restarting: '重启中', created: '未启动' }[
      state
    ] || state
  );
}
function taskLabel(state) {
  return { running: '执行中', success: '已完成', failed: '失败', interrupted: '中断待核对' }[state] || state;
}
function actionLabel(action) {
  return (
    { backup: '完整备份', update: '备份并更新', sync: '远端同步', recovery: '恢复原运行状态' }[action] ||
    action
  );
}
onMounted(() => {
  void load();
  window.addEventListener('composeops:host-changed', hostChanged);
  pollTimer = setInterval(() => {
    void load(true);
  }, 5000);
});
onBeforeUnmount(() => {
  disposed = true;
  epoch++;
  clearInterval(pollTimer);
  clearTimeout(authTimer);
  window.removeEventListener('composeops:host-changed', hostChanged);
});
</script>
