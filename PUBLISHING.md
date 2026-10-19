# Publishing checklist

本文件供仓库维护者发布首个 GitHub 版本时使用。

## 1. 仓库地址

当前仓库元数据使用以下地址：

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/collabgod/dsh-intelligent-ui.git"
  },
  "homepage": "https://github.com/collabgod/dsh-intelligent-ui#readme",
  "bugs": {
    "url": "https://github.com/collabgod/dsh-intelligent-ui/issues"
  }
}
```

修改仓库所有者或名称时，需要同步更新 README 与 `package.json`。

## 2. 保存授权记录

- 私下保存上游作者同意修改并公开发布衍生内容的原始记录。
- 不要把包含私人账号、联系方式或其他隐私的聊天截图直接提交到仓库。
- 如果授权进一步允许对上游衍生内容采用标准开源许可证，再单独更新 LICENSE 和 NOTICE；不要自行扩大授权范围。

## 3. 发布前验证

```powershell
npm ci
npm run check
npm audit --omit=dev
npm pack --dry-run
```

确认 `npm pack --dry-run` 包含 `lib/`、`generated/`、`LICENSE`、`NOTICE.md` 和 `README.md`，但不包含 `node_modules/`、本机配置或凭据。

## 4. 初始化并上传

在 Git Bash 中执行：

```bash
git init -b main
git add .
git status
git commit -m "Initial release"
git remote add origin https://github.com/collabgod/dsh-intelligent-ui.git
git push -u origin main
```

GitHub 上的空仓库不要预先创建 README、`.gitignore` 或 LICENSE，以免首次推送产生无关冲突。

## 5. GitHub 仓库设置

- 在 **Settings → Security → Private vulnerability reporting** 中启用私密漏洞报告。
- 确认 Actions 中的 CI 首次运行通过。
- 根据需要创建 `bug` 和 `enhancement` 标签，Issue 模板会自动使用它们。
- 在 About 中填写描述和 Topics：`deepseek-harness`、`dsh`、`openui`、`interactive-ui`、`plugin`。

## 6. 创建首个 Release

```bash
git tag -a v0.1.1 -m "dsh-intelligent-ui v0.1.1"
git push origin v0.1.1
```

然后在 GitHub Releases 中基于 `v0.1.1` 创建 Release，正文可复制 `CHANGELOG.md` 的 `0.1.1` 部分。
