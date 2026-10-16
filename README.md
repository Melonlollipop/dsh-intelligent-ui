# dsh-openui

让 DeepSeek Harness 按需把回答渲染成可交互界面的 OpenUI Lang 插件。

模型会在行程、对比、图表、表单、计算器、图片画廊等适合可视化的任务中调用 `render_openui`；普通问答仍然使用普通文本，不会强制把每轮回答都变成卡片。

> English: An on-demand OpenUI Lang renderer for DeepSeek Harness. It turns suitable answers into responsive, interactive UI without modifying DSH core files.

## 功能

- OpenUI Lang 参数生成过程中即可流式渲染。
- 界面直接出现在回答正文区域，不与思维链或工具记录一起折叠。
- OpenUI 调用完成后结束当前轮次，不在卡片后追加重复正文。
- 支持布局、文本、表单、图片、表格、图表、交互式地图、SVG、数学公式、轮播、小游戏和沙箱 HTML。
- 支持复制、打开链接以及带界面上下文继续对话。
- 自动跟随 DSH 的明暗主题与回答列宽。
- 不修改 DSH 安装目录、程序文件或二进制文件。

## 工作方式

插件由两部分组成：

1. Host 端注册 `render_openui` 工具并注入 OpenUI Lang 生成提示词。
2. Client 端读取流式工具参数，通过 OpenUI Renderer 渲染界面，并将结果挂载到当前回答正文中。

OpenUI 只在模型判断交互界面确实有帮助时使用。工具调用记录仍保留在 DSH 的流程区，最终界面显示在正文区。

## 环境要求

- DeepSeek Harness，使用兼容 `0.2.0-rc.2` 客户端插件接口的版本。
- Node.js 24 或更高版本（仅开发和独立构建时需要）。
- 安装后需要完整重启对应的 DSH Profile。

## 从 GitHub 安装

建议安装带版本标签的地址，避免主分支变化影响现有环境。

### DSH 桌面版

1. 启动过一次 DSH 桌面版，确保 `desktop` Profile 已初始化。
2. 在应用菜单中安装/修复 `dsh` 命令，或打开 DSH 提供的终端。
3. 完全退出 DSH 桌面版。
4. 执行：

```powershell
dsh plugin --profile desktop add "github:Melonlollipop/dsh-openui#v0.1.0"
```

5. 重新启动 DSH 桌面版。

### 独立 Web 版

```powershell
npx -y @deepseek-ai/dsh plugin --profile web add "github:Melonlollipop/dsh-openui#v0.1.0"
```

安装后重启 `dsh web`。

### 更新

发布新标签后，使用对应的新标签重新安装。例如：

```powershell
dsh plugin --profile desktop add "github:Melonlollipop/dsh-openui#v0.2.0"
```

### 卸载

```powershell
dsh plugin --profile desktop remove dsh-openui
```

卸载后完整重启 DSH。

## 使用

正常向 DSH 提问即可，例如：

- “规划一个北京三日游，用可切换的每日行程展示。”
- “把这组数据做成交互式对比图。”
- “做一个贷款计算器，可以调整期限和利率。”
- “用图片卡片比较这几个产品。”

如果任务更适合普通文本，模型不会调用 OpenUI。也可以在提示中明确要求“使用交互界面展示”。

## 本地开发

```powershell
git clone https://github.com/Melonlollipop/dsh-openui.git
Set-Location dsh-openui
npm ci
npm run typecheck
npm test
npm run build
```

将本地目录安装到桌面 Profile：

```powershell
dsh plugin --profile desktop add "file:D:/absolute/path/to/dsh-openui"
```

构建输出位于 `lib/`；OpenUI 规范和系统提示词位于 `generated/`。这两个目录需要提交到仓库，因为 GitHub 安装直接使用已构建产物。

## 项目结构

```text
src/host/       DSH 工具注册、提示词和轮次结束逻辑
src/client/     DSH 客户端插槽、流式参数读取和正文挂载
src/openui/     OpenUI 组件、函数、样式和组件库定义
generated/      生成的 OpenUI 规范与模型提示词
lib/            可被 DSH 直接加载的构建产物
tests/          Host、解析、流式数据和布局回归测试
```

## 开发检查

提交前运行：

```powershell
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## 安全说明

- `HtmlView` 在不具备同源权限的沙箱 iframe 中运行，禁止表单提交和宿主页面导航，并受 CSP 限制。
- 生成的界面可以展示远程图片、打开外部链接，以及把用户确认的交互上下文提交回当前对话。
- 安装第三方 DSH 插件前应审查其源码和依赖；本项目不会修改 DSH 核心程序文件。
- 安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告，不要先创建公开 Issue。

## 已知限制

- 当前依赖 DSH `0.2.0-rc.2` 系列的客户端插槽和 DOM 标记；DSH 大版本更新后可能需要适配。
- 交互式地图使用 MapLibre GL、OpenFreeMap/OpenStreetMap 底图；路线叠加由 OSRM 公共演示服务提供，属于道路概览，不是步行或公交导航。
- OpenUI 是否出现由模型和任务共同决定，不能保证每个模型都在相同问题上作出完全一致的选择。

## 上游与授权

组件、样式、函数与提示词基于 [`thesysdev/open-intelligent-ui`](https://github.com/thesysdev/open-intelligent-ui) 的提交 `6a4a0ba192ea285b3a5ed39dcc1295d7d4080d6f` 修改。上游作者已书面同意这些衍生内容在本仓库中公开发布。

DSH 集成层和上游衍生内容适用不同条款。完整范围见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。本项目与 DeepSeek、thesysdev 均无官方隶属或背书关系。

## 贡献

提交 Issue 或 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。版本变化记录在 [CHANGELOG.md](CHANGELOG.md)。

仓库维护者首次上传和创建 Release 前，请按 [PUBLISHING.md](PUBLISHING.md) 完成地址替换、授权留档与发布检查。
