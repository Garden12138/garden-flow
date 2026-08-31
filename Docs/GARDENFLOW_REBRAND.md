# GardenFlow 更名、迁移与回退

## 范围

品牌来源配置为 `branding/identity.json`；`pnpm sync:brand` 同步桌面与扩展，`pnpm check:brand` 检查未批准的旧名称及生成配置漂移。GF 图标源文件为 `desktop/public/branding/gardenflow-mark.svg`，沿用原布局和红白配色。

产品名 GardenFlow，桌面包 `gardenflow-desktop`，扩展包 `gardenflow-browser-extension`，应用 ID `com.gardenflow.app`，协议 `gardenflow-asset://`，Native Host `com.gardenflow.browser_control`。不使用原公司的签名身份、公证信息或更新源；安装包仅供本机无签名测试，不发布。

旧协议、IPC、CLI、技能、环境变量、存储键与上下文标识在品牌配置中明确列出。旧命令先规范化再进行原有权限校验；旧 IPC 和扩展消息复用同一处理器。新代码写入新名称，不改第三方依赖、供应商名称、许可证和来源记录。

## 本机数据迁移

唯一来源是 `~/Library/Application Support/red-convert-desktop/redconvert.db` 和 `~/.redconvert`。同目录中的 `gardenflow.db` 不是来源。目标为 `~/Library/Application Support/GardenFlow/gardenflow.db` 和 `~/.gardenflow`，不与已存在的副本合并。

在仓库根目录使用 Node.js 22、pnpm 10.28.2：

```sh
pnpm migrate:data --dry-run
# 退出桌面应用及所有后台写入进程，检查 dry-run 输出后执行：
pnpm migrate:data --archive-conflicts
```

工具在 macOS 上通过文件占用检查拒绝仍在使用的数据目录。完整原数据和工作空间先备份到 `~/.gardenflow-backups/<时间与随机编号>/`，验证 SHA-256 后才创建迁移暂存副本。已有目标目录及来源目录内的另一个同名数据库单独归档。原数据不会删除。

暂存库包含 SQLite WAL，执行完整性检查、事务迁移及逐行逐列预期结果比对。只迁移结构化模型、路由、模式、上下文标识、应用管理的键与路径；保留记录 ID、正文、用户提示词、凭据、向量字节和历史请求/执行日志。工作空间只有明确的应用配置 JSON 可改变内容，其余文件逐个校验原字节。原 `redclaw` 项目子目录整体改名，空目录也保留。

Electron 在业务模块加载前、`ready` 前设置 `userData` 和 `sessionData`。检测到旧库但未迁移时拒绝创建空库。历史附件通过迁移标记中的精确路径映射读取新目录，映射后仍检查目录边界和符号链接，不回写旧工作空间。

`journal.json` 记录阶段，`verification.json` 记录各表数量、变更字段数量、历史表哈希及逐文件校验。备份含私密配置，应留在本机，不提交仓库。

## 回滚与中断恢复

退出应用后，使用迁移输出的具体日志路径：

```sh
pnpm migrate:data --rollback "$HOME/.gardenflow-backups/<编号>/journal.json"
```

回滚把切换后产生的数据保存在备份目录的 `rolled-back-*` 中，再恢复原有目标副本；不会删除新数据，也不会覆盖不属于本次迁移的数据。旧应用仍可读取未改动的原来源目录。异常中断后先用同一日志回滚，再重新迁移；存在未完成日志时工具拒绝另起一次切换。完成后的重复迁移返回 `already_migrated`，不覆盖后来新增的数据。

## 调度恢复

迁移标记默认设置 `automationHold: true`，不修改原任务启用开关、状态或完成轮次。验收期间不会启动后台服务或维护执行。完成验收、退出应用后执行：

```sh
pnpm migrate:data --resume-automation
```

下次启动恢复原调度开关，以恢复时间为停机截止点。周期任务计算下一次运行时间，错过的一次性任务不自动补跑。不要在尚未确认网关可用时启用依赖该网关的付费任务。

## 模型映射（需在新网关配置）

| 旧模型 ID | 新模型 ID |
| --- | --- |
| `bojin-max` | `gardenflow-max` |
| `bojin-plus` | `gardenflow-plus` |
| `bojin-omni-plus` | `gardenflow-omni-plus` |
| `bojin-imgae-2.0` | `gardenflow-imgae-2.0` |
| `bojin-imgae-3.0` | `gardenflow-imgae-3.0` |
| `bojin-text-embedding` | `gardenflow-text-embedding` |
| `bojin-vl-embedding` | `gardenflow-vl-embedding` |
| `bojin-speech` | `gardenflow-speech` |
| `bojin-asr-plus` | `gardenflow-asr-plus` |
| `bojin-video-1.1-r2v` | `gardenflow-video-1.1-r2v` |
| `bojin-video-H3` | `gardenflow-video-H3` |

保留现有 Endpoint、API Key、百炼和 DeepSeek 等第三方配置。`imgae` 是既有后缀，按约定原样保留。客户端实际发送新 ID；服务端未配置时显示错误，不静默换回旧 ID。未改变实际向量模型、未重建已有索引，后续网关应将新向量别名指向同一个原模型。

## 浏览器扩展

公钥和扩展 ID `dhfphfekcjahljnefpdjoidehnhhoeie` 保持不变。桌面中的「采集插件」会导出扩展并注册新 Native Host，也保留 `com.redbox.browser_control` 兼容入口；两个入口仅接受同一个原扩展来源。

在 Chrome 扩展管理页重新加载原扩展目录，或按应用提示选择导出的目录，不要卸载原扩展，以保留其存储。旧存储键复制到新键，新键已有值时优先保留新值。

实际验收结果与仍待验证的部分见 [验收报告](GARDENFLOW_ACCEPTANCE.md)。
