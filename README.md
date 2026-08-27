# 国家中小学智慧教育平台 PDF 教材下载（去水印）

一个 Tampermonkey 用户脚本：在[国家中小学智慧教育平台](https://basic.smartedu.cn)教材详情页的「添加到我的资源库」旁边生成同款「下载PDF」按钮，一键下载**无水印**的原始 PDF 教材。

## 功能

- **融于页面**：深克隆页面原生「添加到我的资源库」按钮，样式、布局与站点完全一致，不破坏页面观感
- **原始资源**：直接解析预览 iframe 中的签名 URL 与 `X-ND-AUTH` 鉴权头，抓取平台原始 PDF（非预览截图）
- **去水印**：移除每页底部「仅供个人学习使用，未经授权不得另做他用」水印，纯内容流层面删除（`/Artifact <</Subtype /Watermark>>` 标记块），不损伤扫描图、页码、眉题等正文内容
- **自动命名**：以资源原始文件名保存，例如 `义务教育教科书•英语 九年级 上册.pdf`

## 安装

### 方式一：GreasyFork（推荐，自动更新）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）
2. 打开脚本页：[greasyfork.org/zh-CN/scripts/593206](https://greasyfork.org/zh-CN/scripts/593206)
3. 点击「安装此脚本」→ 确认安装

### 方式二：手动安装（本地开发版）

1. 复制 `smartedu-pdf-downloader.user.js` 全部内容
2. Tampermonkey → 管理面板 → 「+」新建脚本 → 粘贴 → Ctrl+S 保存

## 使用

1. 打开任意教材详情页，如 `basic.smartedu.cn/tchMaterial/detail?contentType=assets_document&contentId=...`
2. 等待页面右上角工具栏出现「下载PDF」按钮（位于「添加到我的资源库」右侧）
3. 点击按钮，等待「下载中… → 处理中… → 已保存（移除 N 个水印）」
4. 文件自动保存到浏览器下载目录

> 提示：若提示「签名过期 (HTTP 403)」，刷新页面即可——预览地址会重新签名。

## 工作原理

| 环节 | 说明 |
|------|------|
| 定位资源 | 教材预览是 pdf.js iframe，其 `src` 带 `file`（签名 URL）与 `headers`（`X-ND-AUTH` MAC 鉴权）两个参数 |
| 抓取 PDF | 用 `fetch` + 鉴权头请求原始文件（需登录态，与预览同一来源） |
| 去水印 | 用 [pdf-lib](https://pdf-lib.js.org/) 解析每页内容流，正则删除水印的 `BDC...EMC` 标记块后重新压缩，再输出新 PDF |
| 触发下载 | `Blob` + `a[download]` 保存，文件名取自资源 URL |

依赖仅在运行时从 jsdelivr CDN 加载 `pdf-lib`（`@require` 声明）。

## 开发与更新

仓库通过 **GreasyFork GitHub 同步**发布：脚本在仓库根目录，推送即同步。

```bash
# 修改 smartedu-pdf-downloader.user.js 后
git add smartedu-pdf-downloader.user.js
git commit -m "…"
git push
```

GreasyFork 侧已配置**自动同步**（定期检查更新）；如需推送后立即生效，可在脚本[管理页](https://greasyfork.org/zh-CN/scripts/593206/admin)设置 Webhook。

> 版本号规则：每次更新请递增 `// @version` 字段（如 `1.1.0` → `1.2.0`），Tampermonkey 据此触发更新检查。

## 许可

MIT
