# GardenFlow 平台发布插件

本扩展辅助小红书、国内抖音和国际版 TikTok Studio 发布，与商品／页面采集插件分开。请从当前 GardenFlow 桌面导出新版插件并在 Chrome 扩展页重新加载，保持桌面连接；扩展 ID 保持不变。

## TikTok 商品视频

在商品视频工作台创建独立 TikTok 版本，保存语言、文案和发布设置，并导出最新竖屏 MP4。登录 [TikTok Studio 视频上传页](https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=video)，只保留一个上传标签页，然后在 TikTok 稿件中检查并绑定发布浏览器。

“上传并填入编辑页”只上传和填稿；“确认发布到 TikTok”才点击 Post。插件核对头像菜单 Profile 对应的账号、当前任务的视频文件与预览标识、文案、可见范围、评论、复用、Remix、商业披露、AI 标记和年龄限制。未识别控件、验证码、账号变化和用户已有的其他草稿会停止；不会替用户丢弃草稿或接受条款。

如果空白上传入口同时提示“上次编辑的视频未保存，是否继续”，插件会按已有草稿停止。请人工核对并处理这个提示，再重新检查状态；插件不会点击 Continue 或 Discard。选择文件之前也会再次核对账号和草稿，避免页面在准备过程中变化。

确认提交后若显示“提交结果待核实”，重试同一任务不会再次点击 Post。请先在 Posts 核对，回到原账号的空白视频上传页，再在桌面记录已发布或核实未发布。已核实发布的任务支持从唯一 Studio Posts 页面读取作品回执，严格核对当前账号、原文案、可见范围和唯一作品，并保持已保存的作品链接；读取不会上传、点击 Post 或改变任务核实结果。未知提交不能仅凭同文案作品自动判定成功。真实私密发布已通过，新读取和审核分支范围详见[阶段 5 验收记录](../Docs/TIKTOK_STAGE5_ACCEPTANCE.md)。

权限仅包含三个已支持平台的准确域名及既有 nativeMessaging、storage、tabs、scripting、debugger、alarms，无全站或 Cookie 读取权限。TikTok 能力为 `tiktok.publish.v1`；采集请求不路由到发布插件。

## 开发验证

Node.js 22、pnpm 10.28.2，保留锁文件。

```sh
pnpm --dir PublishPlugin check
```

构建目录 `PublishPlugin/dist/`，自动回归不向真实平台发帖。TikTok 真实 DOM 夹具位于 `tests/fixtures/tiktok/`，相应 DOM 执行测试位于 `desktop/tests/tiktokPublisherDom.test.ts`，由根目录 `pnpm test` 运行。
