# Tampermonkey 用户脚本集

自用的油猴脚本仓库，每个脚本一个目录，内含脚本本体和独立 README。

## 脚本列表

| 脚本 | 说明 | 安装 |
|------|------|------|
| [smartedu-pdf-downloader](smartedu-pdf-downloader/) | 智慧教育平台 / 人教社电子教材 PDF 下载（去水印） | [GreasyFork](https://greasyfork.org/zh-CN/scripts/593206) |
| [uber-invoice-downloader](uber-invoice-downloader/) | Uber 行程票据批量下载（Invoice 优先，Receipt 兜底，生成明细 CSV） | 手动安装 |

## 目录结构

```
<脚本名>/
  <脚本名>.user.js   # 脚本本体
  README.md          # 脚本说明
```

## 发布与更新

仓库通过 **GreasyFork GitHub 同步**发布：推送对应脚本文件即同步到 GreasyFork。

- 每个脚本在 GreasyFork 侧的同步源指向各自目录下的 `.user.js` 文件
- GreasyFork 侧已配置 **Webhook**：推送后立即同步；另有定期自动同步兜底
- 版本号规则：每次更新请递增脚本头部的 `// @version` 字段，Tampermonkey 据此触发更新检查

```bash
# 修改某个脚本后
git add <脚本名>/
git commit -m "…"
git push
```

## 许可

MIT
