# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## Unreleased

### Added

- 按 OpenUI 工具调用持久化交互状态，在会话切换或页面重载后恢复。
- 卡片内结构化解析和渲染错误提示。

### Changed

- 复制操作改为复用上游的 Clipboard API 降级逻辑。
- 打开链接前使用上游 `webUrl()` 限制为绝对 HTTP(S) 地址。

## 0.1.0 - 2026-10-16

### Added

- 注册按需调用的 `render_openui` DSH 工具。
- 流式解析和渲染 OpenUI Lang。
- 将最终界面直接挂载到回答正文区域。
- 布局、文本、表单、媒体、表格、图表、SVG、数学、轮播、小游戏和沙箱 HTML 组件。
- `Map`、`MapMarker`、MapLibre GL 底图、地点筛选、展开视图和 OSRM 路线叠加。
- 复制、打开链接和继续对话动作。
- DSH 明暗主题和响应式回答列布局。
- Host、OpenUI 解析、流式 JSON 和 CSS 布局回归测试。

### Changed

- OpenUI 工具调用完成后立即结束当前轮次。
- 轮播子卡片统一使用 `border-box`，避免宽度溢出和重叠。
