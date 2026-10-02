chrome.runtime.sendMessage({ type: 'publisher.status' }).then((result) => {
  const element = document.getElementById('status');
  if (!element) return;
  if (!result?.nativeConnected) {
    element.textContent = '小红书：未连接桌面端，请打开 GardenFlow。';
  } else if (result.publishTabCount !== 1) {
    element.textContent = `小红书：检测到 ${result.publishTabCount || 0} 个发布页。`;
  } else {
    element.textContent = result.pageState === 'ready'
      ? `小红书：${String(result.detail || '发布页空白且可用')}，可以等待发布任务。`
      : `小红书：${String(result.detail || `页面状态：${result.pageState || '未知'}`)}`;
  }
}).catch(() => {
  const element = document.getElementById('status');
  if (element) element.textContent = '状态读取失败，请重新加载插件。';
});

chrome.runtime.sendMessage({ type: 'publisher.status', platform: 'douyin' }).then((result) => {
  const element = document.getElementById('douyin-status');
  if (!element) return;
  element.textContent = result?.nativeConnected
    ? `抖音：${String(result.detail || result.pageState || '页面状态未知')}${result.accountLabel ? `；账号 ${result.accountLabel}` : ''}${result.coverReadback ? `；封面画面回读：竖 ${result.coverReadback.portrait ? '可用' : '不可用'}，横 ${result.coverReadback.landscape ? '可用' : '不可用'}` : ''}`
    : '抖音：未连接桌面端';
  if (result?.nativeConnected && result.draftReadback) {
    const draft = result.draftReadback;
    const match = (value) => value == null ? '尚未绑定' : value ? '一致' : '不一致';
    element.textContent += `；原任务核对：视频${draft.hasMedia ? '已识别' : '无法识别'}，媒体${match(draft.mediaMatches)}，标题${match(draft.titleMatches)}，文案${match(draft.descriptionMatches)}`;
    element.textContent += `；编辑页复核：封面${match(draft.coverMatches)}${draft.coverEditing ? '（仍在编辑）' : ''}，视频${draft.uploadBusy ? '处理中' : '未显示处理中'}，发布按钮 ${draft.publishButtonCount ?? 0} 个${draft.publishButtonEnabled ? '可用' : '不可用'}，校验问题 ${draft.validationErrorCount ?? 0} 项`;
    for (const [orientation, fields] of Object.entries(draft.coverChanges || {})) {
      element.textContent += `；${orientation === 'portrait' ? '竖' : '横'}封面变化字段：${fields.join('、')}`;
    }
  }
  if (result?.nativeConnected && result.coverReadbackDiagnostic) {
    const diagnostic = result.coverReadbackDiagnostic;
    element.textContent += `；封面校验诊断：${diagnostic.orientation === 'portrait' ? '竖' : '横'} ${diagnostic.actualWidth || '?'}×${diagnostic.actualHeight || '?'}，平均误差 ${diagnostic.meanAbsoluteError == null ? '不可读' : diagnostic.meanAbsoluteError.toFixed(2)}，大误差比例 ${diagnostic.largeDeltaFraction == null ? '不可读' : `${(diagnostic.largeDeltaFraction * 100).toFixed(2)}%`}`;
    if (diagnostic.roundedMeanAbsoluteError != null) element.textContent += `，居中取整后 ${diagnostic.roundedMeanAbsoluteError.toFixed(2)} / ${(diagnostic.roundedLargeDeltaFraction * 100).toFixed(2)}%`;
  }
}).catch(() => {
  const element = document.getElementById('douyin-status');
  if (element) element.textContent = '抖音：状态读取失败';
});
