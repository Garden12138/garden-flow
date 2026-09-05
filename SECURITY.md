# Security Policy

## Supported version

安全修复面向默认分支上的最新代码。发布包使用者应升级到仓库提供的最新受支持版本。

## 私下报告

请使用 GitHub 仓库的 **Security → Report a vulnerability** 私下提交报告：

https://github.com/Garden12138/garden-flow/security/advisories/new

请包含受影响版本、复现步骤、影响范围、最小证明和建议缓解方式。不要附带真实 API Key、Cookie、Token、个人内容或未脱敏数据库；需要样本时使用最小合成数据。

维护者会尽量在 7 天内确认报告，并在完成影响评估后同步修复进度。修复发布前请不要公开披露可利用细节。

## 安全范围

特别关注：

- workspace 路径逃逸或任意文件读写；
- Electron preload、IPC 或资源协议越权；
- Native Messaging Host 鉴权与 origin 绕过；
- 扩展采集 Cookie、凭据或非用户授权正文；
- 诊断记录泄露密钥、网页正文或个人路径；
- AI 工具确认绕过、命令注入或发布越权；
- 供应商配置被发送到非选定 Endpoint。

普通缺陷、功能建议和非敏感崩溃请使用 Issue 模板。
