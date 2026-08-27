# 教材 PDF 下载（去水印）— 智慧教育平台 / 人教社电子教材

一个 Tampermonkey 用户脚本，同时支持两个教材平台，在页面原生工具栏生成同款「下载PDF」按钮：

1. **[国家中小学智慧教育平台](https://basic.smartedu.cn)**：一键下载**无水印**的原始 PDF 教材
2. **[人教社电子教材](https://book.pep.com.cn)**：抓取全部页面图片合成 PDF

## 功能

### 智慧教育平台
- **融于页面**：深克隆页面原生「添加到我的资源库」按钮，样式、布局与站点完全一致
- **原始资源**：直接解析预览 iframe 中的签名 URL 与 `X-ND-AUTH` 鉴权头，抓取平台原始 PDF（非预览截图）
- **去水印**：移除每页底部「仅供个人学习使用，未经授权不得另做他用」水印，纯内容流层面删除（`/Artifact <</Subtype /Watermark>>` 标记块），不损伤扫描图、页码、眉题等正文内容
- **自动命名**：以资源原始文件名保存，例如 `义务教育教科书•英语 九年级 上册.pdf`

### 人教社电子教材
- 按钮出现在阅读器底部工具栏（与「上一页 / 下一页」同排），样式一致
- 通过 `<img>` 元素加载页面图片（该站 WAF 反爬对 fetch/XHR 有约 18 次/会话的配额，`<img>` 不受限），canvas 捕获后合成 PDF
- 页面为扫描图（如 1274×1800），无平台水印；含自动重试与失败提示

## 安装

### 方式一：GreasyFork（推荐，自动更新）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）
2. 打开脚本页：[greasyfork.org/zh-CN/scripts/593206](https://greasyfork.org/zh-CN/scripts/593206)
3. 点击「安装此脚本」→ 确认安装

### 方式二：手动安装（本地开发版）

1. 复制 `smartedu-pdf-downloader.user.js` 全部内容
2. Tampermonkey → 管理面板 → 「+」新建脚本 → 粘贴 → Ctrl+S 保存

## 使用

### 智慧教育平台
1. 打开任意教材详情页，如 `basic.smartedu.cn/tchMaterial/detail?contentType=assets_document&contentId=...`
2. 点击「添加到我的资源库」右侧的「下载PDF」按钮
3. 等待「下载中… → 处理中… → 已保存（移除 N 个水印）」
4. 文件自动保存到浏览器下载目录

> 提示：若提示「签名过期 (HTTP 403)」，刷新页面即可——预览地址会重新签名。

### 人教社电子教材
1. 打开任意电子书页，如 `book.pep.com.cn/1312001303141/mobile/index.html`
2. 点击底部工具栏的「下载PDF」按钮
3. 等待「下载中 n/204 → 生成 PDF… → 已保存」（204 页约需 3-5 分钟，生成 PDF 阶段浏览器可能短暂卡顿属正常）
4. 文件以书名命名保存，如 `义务教育教科书 英语 九年级 全一册.pdf`

> 提示：下载过程中请勿刷新页面；若提示大量页失败，可能触发了网站防护，关闭页面重新打开后再试。

## 工作原理

| 环节 | 智慧教育平台 | 人教社 |
|------|------------|--------|
| 定位资源 | pdf.js 预览 iframe 的 `file` + `headers` 参数（`X-ND-AUTH` MAC 鉴权） | `window.bookConfig` 的页数、路径与 `CreatedTime` |
| 抓取页面 | `fetch` + 鉴权头请求原始 PDF | `<img>` 元素加载 `files/mobile/{n}.jpg`（绕过 WAF），canvas 捕获 |
| 处理 | 内容流删除水印 `BDC...EMC` 标记块后重新压缩 | 图片直接嵌入（无重编码） |
| 组装 | 原 PDF 保存 | pdf-lib 逐页 `embedJpg` 合成 |

依赖仅在运行时从 jsdelivr CDN 加载 `pdf-lib`（`@require` 声明）。

## 开发与更新

仓库通过 **GreasyFork GitHub 同步**发布：脚本在仓库根目录，推送即同步。

```bash
# 修改 smartedu-pdf-downloader.user.js 后
git add smartedu-pdf-downloader.user.js
git commit -m "…"
git push
```

GreasyFork 侧已配置 **Webhook**：推送后立即同步；另有定期自动同步兜底。

> 版本号规则：每次更新请递增 `// @version` 字段（如 `1.2.0` → `1.3.0`），Tampermonkey 据此触发更新检查。

## 许可

MIT
