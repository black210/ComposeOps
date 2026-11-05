import tar from 'tar-stream';

const CONFIG_PATH = '/conf/nps.conf';
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_ARCHIVE_BYTES = 128 * 1024;

function portNumber(value) {
  return /^\d{1,5}$/.test(value || '') && Number(value) > 0 && Number(value) <= 65535 ? Number(value) : null;
}

/** 只读取 NPS 的端口键，不返回账号、认证密钥或配置正文。 */
export function parseNpsPorts(content) {
  const values = new Map();
  const keys = new Set(['web_port', 'web_open_ssl', 'bridge_port', 'bridge_type', 'http_proxy_port', 'https_proxy_port']);
  let globalSection = true;
  for (const line of String(content).split(/\r?\n/)) {
    const text = line.trim();
    if (/^\[.*\]$/.test(text)) { globalSection = text.toLowerCase() === '[common]'; continue; }
    if (!globalSection || !text || /^[#;]/.test(text)) continue;
    const match = /^([a-z_]+)\s*=\s*([^#;]*)/i.exec(text);
    if (match && keys.has(match[1].toLowerCase())) values.set(match[1].toLowerCase(), match[2].trim());
  }
  const result = new Map();
  const add = (key, type, purpose, label, scheme) => {
    const port = portNumber(values.get(key));
    if (port) result.set(`${port}/${type}`, { port, type, source: 'config-file', purpose, label, ...(scheme ? { scheme } : {}) });
  };
  const bridgeType = String(values.get('bridge_type') || '').toLowerCase();
  if (['tcp', 'tls', 'kcp', 'udp'].includes(bridgeType)) add('bridge_port', ['kcp', 'udp'].includes(bridgeType) ? 'udp' : 'tcp', 'bridge', '客户端连接');
  add('http_proxy_port', 'tcp', 'proxy', 'HTTP 代理');
  add('https_proxy_port', 'tcp', 'proxy', 'HTTPS 代理');
  // 管理入口最后写入，复用同一端口时保留可点击的 Web 语义。
  add('web_port', 'tcp', 'web', '管理', values.get('web_open_ssl')?.toLowerCase() === 'true' ? 'https' : 'http');
  return [...result.values()];
}

/** 仅识别 NPS 镜像的固定挂载配置；不遍历宿主文件、不创建辅助容器。 */
export async function readNpsPorts(container, details, timeoutMs = 1500) {
  const image = String(details.Config?.Image || '').split('@')[0].split('/').at(-1).split(':')[0];
  if (details.HostConfig?.NetworkMode !== 'host' || image !== 'nps' ||
      !details.Mounts?.some(mount => ['/conf', CONFIG_PATH].includes(mount.Destination))) return [];

  return new Promise(resolve => {
    let archive, extract, timer, settled = false;
    const finish = ports => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      archive?.destroy(); extract?.destroy(); resolve(ports);
    };
    timer = setTimeout(() => finish([]), timeoutMs);
    // Promise.resolve 同时处理 Docker API 同步失败；超时后才返回的流也必须销毁。
    Promise.resolve().then(() => container.getArchive({ path: CONFIG_PATH })).then(stream => {
      if (settled) { stream.destroy(); return; }
      archive = stream;
      extract = tar.extract();
      let bytes = 0, config = null, entries = 0;
      archive.on('error', () => finish([]));
      extract.on('error', () => finish([]));
      archive.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_ARCHIVE_BYTES) finish([]); });
      extract.on('entry', (header, entry, next) => {
        if (++entries !== 1 || header.type !== 'file' || header.name !== 'nps.conf' || header.size > MAX_CONFIG_BYTES) { entry.resume(); finish([]); return; }
        const chunks = []; let size = 0;
        entry.on('error', () => finish([]));
        entry.on('data', chunk => { size += chunk.length; if (size > MAX_CONFIG_BYTES) finish([]); else chunks.push(chunk); });
        entry.on('end', () => { config = Buffer.concat(chunks).toString('utf8'); next(); });
      });
      extract.on('finish', () => finish(config === null ? [] : parseNpsPorts(config)));
      archive.pipe(extract);
    }).catch(() => finish([]));
  });
}
