chrome.runtime.sendMessage({ type: 'publisher.status' }).then((result) => {
  const element = document.getElementById('status');
  if (!element) return;
  if (!result?.nativeConnected) {
    element.textContent = '未连接桌面端，请打开 GardenFlow。';
  } else if (result.publishTabCount !== 1) {
    element.textContent = `已连接；当前检测到 ${result.publishTabCount || 0} 个发布页。`;
  } else {
    element.textContent = result.pageState === 'ready'
      ? `${String(result.detail || '发布页空白且可用')}，可以等待发布任务。`
      : String(result.detail || `页面状态：${result.pageState || '未知'}`);
  }
}).catch(() => {
  const element = document.getElementById('status');
  if (element) element.textContent = '状态读取失败，请重新加载插件。';
});
