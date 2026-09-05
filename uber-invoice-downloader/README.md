# Uber 行程票据批量下载（Invoice 优先，Receipt 兜底）

一个 Tampermonkey 用户脚本，在 [Uber Riders 行程页](https://riders.uber.com/trips) 批量下载行程票据 PDF：有 Invoice 优先下 Invoice，没有则自动下 Receipt，并生成明细 CSV。

## 功能

- **批量下载**：遍历指定日期范围内的全部行程，自动下载票据 PDF
- **Invoice 优先**：通过 `GetInvoiceFiles` 接口取 Invoice PDF；无 Invoice 的行程（如部分国家/地区）自动回退到 Receipt PDF
- **自动跳过**：取消（Canceled）/ 未完成（Unfulfilled）的行程不产生票据，自动跳过
- **顺序命名**：按行程从新到旧编号保存为 `1.pdf`、`2.pdf`、`3.pdf`……
- **明细 CSV**：下载完成后自动保存 `uber_trips.csv`，含编号、文件名、类型、日期、目的地、币种、金额，可直接用 Excel 打开求和
- **日期筛选**：面板可选开始/结束日期（默认最近 30 天），服务端过滤，留空即全量

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）
2. 复制 `uber-invoice-downloader.user.js` 全部内容
3. Tampermonkey → 管理面板 → 「+」新建脚本 → 粘贴 → Ctrl+S 保存

## 使用

1. 登录并打开 <https://riders.uber.com/trips>
2. 页面右下角出现「Uber 票据批量下载」面板，按需调整日期范围（默认最近 30 天）
3. 点击「开始批量下载 (Invoice 优先)」，面板内实时显示进度和日志
4. PDF 逐个保存到浏览器下载目录，完成后自动保存 `uber_trips.csv`

> 首次运行浏览器可能提示「允许此网站下载多个文件」，允许一次即可。

## CSV 格式

```csv
number,filename,type,date,title,currency,amount
1,1.pdf,invoice,2026/09/05,"Praam 263",EUR,32.68
2,2.pdf,receipt,2026/09/05,"Bucharest Otopeni Airport",RON,73.98
```

- `date`：`yyyy/mm/dd`，由行程列表倒序推断年份（列表接口不返回年份），跨年自动处理
- `currency`：统一三字母代码（EUR/USD/RON/HUF/CZK…），符号自动映射
- `amount`：纯数值（千分位已去除），可按币种分组求和

## 工作原理

全部走 Uber Riders 网页端自用的 GraphQL 接口（`POST /graphql`，复用浏览器登录态）：

| 环节 | 接口 |
|------|------|
| 行程列表（分页/日期过滤） | `Activities` 查询，`nextPageToken` 翻页，`startTimeMs/endTimeMs` 过滤 |
| Invoice PDF | `GetInvoiceFiles(tripUUID)` → 签名 PDF 直链（约 15 分钟过期，现取现下） |
| Receipt PDF 兜底 | `GetReceipt(tripUUID)` 取 `timestamp`，GET `/trips/{uuid}/receipt?contentType=PDF&timestamp={ts}` |

下载通过 `GM_download` 执行，避免浏览器多文件下载限制。

## 已知边界

- 日期解析依赖英文月份缩写（页面语言为英文时正常）；其他语言下个别行的日期会退化为原始文本
- 金额不换算币种，多币种需按 `currency` 列分组统计

## 许可

MIT
