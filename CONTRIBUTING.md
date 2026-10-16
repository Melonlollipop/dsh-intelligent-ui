# Contributing

感谢你帮助改进 `dsh-openui`。

## 开始之前

- 搜索现有 Issue，避免重复报告。
- Bug 请提供 DSH 版本、Profile 类型、插件版本、复现步骤和截图。
- 不要在 Issue、日志或截图中提交 API Key、Token、Cookie、私人对话或其他敏感信息。
- 涉及 `src/openui/**` 的修改可能属于上游衍生内容，提交前请阅读 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。

## 本地检查

需要 Node.js 24 或更高版本：

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Pull Request 必须保持上述命令全部通过，并提交由构建产生的 `lib/` 与 `generated/` 更新。

## 提交规范

- 一次提交只解决一个主题。
- 清楚说明行为变化、原因和验证方法。
- UI 变化请附修改前后的截图。
- 新功能应补充或更新测试。
- 不要修改 DSH 安装目录或把 DSH 私有文件提交进本仓库。

## Pull Request 检查表

- [ ] 变更范围与 Issue/说明一致。
- [ ] 没有提交凭据或个人数据。
- [ ] 类型检查、测试和构建通过。
- [ ] `lib/`、`generated/` 与源码一致。
- [ ] README、CHANGELOG 或 NOTICE 已按需要更新。
- [ ] 新增或复用代码的许可来源已说明。
