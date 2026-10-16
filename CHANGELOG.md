# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## Unreleased

### Added

- 按 OpenUI 工具调用持久化交互状态，在会话切换或页面重载后恢复。
- 卡片内结构化解析和渲染错误提示。
- Host 图片代理和持久化磁盘缓存，支持显式图片 URL 与搜索图片。
- 服务端分级重试、前端延迟重试、候选图片切换、网络恢复重试和 30 秒自动恢复。
- 按会话与工具调用维护图片引用；永久删除会话时联动清理无共享引用的图片。
- 500 MB 容量上限、按最近使用时间自动清理、启动一致性修复，以及缓存状态和手动清理接口。

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
