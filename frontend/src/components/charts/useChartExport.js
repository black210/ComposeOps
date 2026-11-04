/**
 * useChartExport.js —— 图表数据导出(CSV / PNG)。
 * 从 InteractiveChart.vue 的 exportToCSV / exportToPNG 拆分。
 */
import { ref } from 'vue';

export function useChartExport() {
  const showExportMenu = ref(false);

  function toggleExportMenu() {
    showExportMenu.value = !showExportMenu.value;
  }

  function exportToCSV({ compareMode, visibleDatasets, visiblePoints }) {
    showExportMenu.value = false;
    let csvContent = '';

    if (compareMode && visibleDatasets.length > 0) {
      // Multi-metric CSV
      const headers = ['时间', ...visibleDatasets.map((ds) => `${ds.label} (${ds.unit})`)];
      csvContent = headers.join(',') + '\n';

      const maxLength = Math.max(...visibleDatasets.map((ds) => ds.visibleData.length));
      for (let i = 0; i < maxLength; i++) {
        const row = [];
        const timestamp = visibleDatasets[0]?.visibleData[i]?.timestamp;
        row.push(timestamp ? new Date(timestamp).toLocaleString('zh-CN') : '');

        visibleDatasets.forEach((ds) => {
          const point = ds.visibleData[i];
          row.push(point ? numberValue(point.value).toFixed(2) : '');
        });

        csvContent += row.join(',') + '\n';
      }
    } else {
      // Single-metric CSV
      csvContent = '时间,值\n';
      visiblePoints.forEach((point) => {
        const time = new Date(point.timestamp).toLocaleString('zh-CN');
        csvContent += `${time},${numberValue(point.value).toFixed(2)}\n`;
      });
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `chart-data-${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportToPNG({ canvasWrapper, width, height }) {
    showExportMenu.value = false;

    const svgElement = canvasWrapper.value?.querySelector('svg');
    if (!svgElement) return;

    // 导出的独立 SVG 不会继承页面样式，先冻结主题色、网格线与文字样式。
    const clone = svgElement.cloneNode(true);
    const originals = [svgElement, ...svgElement.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    originals.forEach((element, index) => {
      const style = getComputedStyle(element);
      for (const property of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stop-color', 'stop-opacity', 'opacity', 'font-family', 'font-size', 'font-weight']) {
        copies[index].style.setProperty(property, style.getPropertyValue(property));
      }
    });
    const background = getComputedStyle(document.documentElement).getPropertyValue('--panel-deep').trim() || '#ffffff';
    const svgData = new XMLSerializer().serializeToString(clone);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    canvas.width = width * 2;
    canvas.height = height * 2;

    img.onload = () => {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `chart-${Date.now()}.png`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
      URL.revokeObjectURL(svgUrl);
    };

    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    img.onerror = () => URL.revokeObjectURL(svgUrl);
    img.src = svgUrl;
  }

  return { showExportMenu, toggleExportMenu, exportToCSV, exportToPNG };
}

function numberValue(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
