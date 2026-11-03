const platforms = [
  { id: 'xiaohongshu', element: 'status' },
  { id: 'douyin', element: 'douyin-status' },
  { id: 'tiktok', element: 'tiktok-status' },
];
async function refresh() {
  const refreshButton = document.getElementById('refresh');
  refreshButton.disabled = true;
  await Promise.allSettled(platforms.map(async ({ id, element }) => {
    const target = document.getElementById(element);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'publisher.status', ...(id === 'xiaohongshu' ? {} : { platform: id }) });
      target.dataset.state = result?.nativeConnected ? 'connected' : 'disconnected';
      if (!result?.nativeConnected) target.textContent = '未连接桌面端，请先打开 GardenFlow。';
      else if (id === 'xiaohongshu' && result.publishTabCount !== 1) target.textContent = `检测到 ${result.publishTabCount || 0} 个发布页，请只保留一个目标页面。`;
      else target.textContent = `${result.accountLabel || '账号需在桌面核对'} · ${String(result.detail || result.pageState || '页面状态未知')}`;
      if (id === 'douyin') {
        const diagnostic = document.getElementById('douyin-diagnostics');
        diagnostic.textContent = JSON.stringify({ 页面: result.pageState || '未知', 封面: result.coverReadback || null, 草稿核对: result.draftReadback || null, 封面诊断: result.coverReadbackDiagnostic || null }, null, 2);
      }
    } catch {
      target.dataset.state = 'disconnected'; target.textContent = '状态读取失败，点击刷新重试。';
    }
  }));
  refreshButton.disabled = false;
}
document.getElementById('refresh').addEventListener('click', () => void refresh());
document.getElementById('open-desktop').addEventListener('click', async () => {
  const target = document.getElementById('open-result');
  try { const result = await chrome.runtime.sendMessage({ type: 'desktop:open' }); if (result?.success === false) throw new Error(result.error); target.textContent = '已打开桌面发布任务。'; }
  catch (error) { target.textContent = error instanceof Error ? error.message : String(error); }
});
void refresh();
