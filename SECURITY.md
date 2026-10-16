# Security policy

## Supported version

当前仅维护最新发布版本。

## Reporting a vulnerability

请不要为尚未修复的安全问题创建公开 Issue。通过 GitHub 仓库的 Security 页面使用 **Report a vulnerability** 私下提交报告；如果仓库尚未启用 Private vulnerability reporting，请通过维护者在 GitHub 个人资料中公开的安全联系方式联系。

报告中请包含：

- 受影响版本和 DSH 版本；
- 复现步骤和最小示例；
- 可能影响；
- 已知缓解方法；
- 必要的日志或截图，并移除凭据和个人数据。

维护者确认问题前，请勿公开利用代码或详细复现过程。

## Security boundary

- 插件在 DSH Host 中注册工具，并在 DSH Renderer 中运行客户端代码。
- `HtmlView` 使用没有同源权限的沙箱 iframe，并通过 CSP 限制网络与导航能力。
- 生成界面可以加载远程图片、打开用户可见的外部链接，以及向当前对话提交交互上下文。
- 本项目不会修改 DSH 核心安装文件。
