// ==UserScript==
// @name         Uber 行程票据批量下载 (Invoice 优先, Receipt 兜底)
// @namespace    https://riders.uber.com/
// @version      1.0.1
// @description  批量下载 Uber Activity 里的行程票据：有 Invoice 下 Invoice(PDF)，没有则下 Receipt(PDF)，按 1.pdf/2.pdf... 命名，并生成对照 CSV
// @license      MIT
// @match        https://riders.uber.com/trips*
// @grant        GM_download
// @grant        GM.xmlHttpRequest
// @connect      tbgs-static.uber.com
// @connect      riders.uber.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /************** 可配置项 **************/
  const CONFIG = {
    maxTrips: 0,          // 0 = 全部行程；调试用可设成 10
    pageSize: 20,         // 行程列表每页数量
    reqDelayMs: 300,      // GraphQL 请求间隔，防限流
    dlDelayMs: 800,       // PDF 下载间隔
    skipKeywords: ['Canceled', 'Unfulfilled', '已取消'], // 取消/未完成的行程直接跳过
    csvName: 'uber_trips.csv',
  };
  /************************************/

  const ACTIVITIES_QUERY = `query Activities($cityID: Int, $endTimeMs: Float, $includePast: Boolean = true, $includeUpcoming: Boolean = true, $limit: Int = 5, $nextPageToken: String, $orderTypes: [RVWebCommonActivityOrderType!] = [RIDES, TRAVEL], $profileType: RVWebCommonActivityProfileType = PERSONAL, $startTimeMs: Float) {
  activities(cityID: $cityID) {
    cityID
    past(endTimeMs: $endTimeMs, limit: $limit, nextPageToken: $nextPageToken, orderTypes: $orderTypes, profileType: $profileType, startTimeMs: $startTimeMs) @include(if: $includePast) {
      activities { cardURL description subtitle title uuid __typename }
      nextPageToken
      __typename
    }
    upcoming @include(if: $includeUpcoming) { activities { uuid __typename } __typename }
    __typename
  }
}`;

  const INVOICE_QUERY = `query GetInvoiceFiles($tripUUID: ID!) {
  invoiceFiles(tripUUID: $tripUUID) {
    archiveURL
    files { downloadURL __typename }
    __typename
  }
}`;

  const RECEIPT_QUERY = `query GetReceipt($tripUUID: String!, $timestamp: String) {
  getReceipt(tripUUID: $tripUUID, timestamp: $timestamp) {
    actionList { type __typename }
    receiptsForJob { timestamp type eventUUID __typename }
    __typename
  }
}`;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (msg) => {
    const el = document.getElementById('uber-dl-log');
    if (el) {
      el.textContent += msg + '\n';
      el.scrollTop = el.scrollHeight;
    }
  };
  const setStatus = (msg) => {
    const el = document.getElementById('uber-dl-status');
    if (el) el.textContent = msg;
  };

  async function gql(query, variables) {
    const resp = await fetch('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'x' },
      credentials: 'include',
      body: JSON.stringify({ operationName: 'BatchDL', variables, query }),
    });
    const j = await resp.json();
    if (j.errors) throw new Error(j.errors.map((e) => e.message).join('; '));
    return j.data;
  }

  // 读取面板上的筛选条件
  function getFilters() {
    const val = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    const startDate = val('uber-dl-start-date'); // YYYY-MM-DD
    const endDate = val('uber-dl-end-date');
    return {
      startDate,
      endDate,
      startTimeMs: startDate ? new Date(startDate + 'T00:00:00').getTime() : null,
      endTimeMs: endDate ? new Date(endDate + 'T23:59:59').getTime() : null,
    };
  }

  // 从 "€32.68" / "RON73.98" / "HUF12,938" 中解析币种和数值；币种统一成字母代码
  const CURRENCY_SYMBOLS = {
    '€': 'EUR', '$': 'USD', '£': 'GBP', '¥': 'JPY', '₹': 'INR',
    '₩': 'KRW', '₽': 'RUB', '₺': 'TRY', 'R$': 'BRL', 'zł': 'PLN',
    'kr': 'SEK', 'Fr': 'CHF', '₦': 'NGN', '₫': 'VND', '฿': 'THB',
  };

  function parseAmount(desc) {
    const m = (desc || '').match(/^\s*([A-Z]{3}|[^\d\s.,]{1,2})?\s*([\d,]+(?:\.\d+)?)/);
    if (!m) return { currency: '', amount: null };
    let currency = m[1] || '';
    if (!/^[A-Z]{3}$/.test(currency)) currency = CURRENCY_SYMBOLS[currency] || currency;
    return { currency, amount: parseFloat(m[2].replace(/,/g, '')) };
  }

  async function fetchAllTrips(filters) {
    const trips = [];
    let token = null;
    while (true) {
      const variables = {
        includePast: true,
        includeUpcoming: false,
        limit: CONFIG.pageSize,
        orderTypes: ['RIDES', 'TRAVEL'],
        profileType: 'PERSONAL',
      };
      if (filters.startTimeMs) variables.startTimeMs = filters.startTimeMs;
      if (filters.endTimeMs) variables.endTimeMs = filters.endTimeMs;
      if (token) variables.nextPageToken = token;
      const data = await gql(ACTIVITIES_QUERY, variables);
      const past = data.activities && data.activities.past;
      if (!past) break;
      trips.push(...past.activities);
      setStatus(`已获取行程列表 ${trips.length} 条...`);
      token = past.nextPageToken;
      if (!token || (CONFIG.maxTrips && trips.length >= CONFIG.maxTrips)) break;
      await sleep(CONFIG.reqDelayMs);
    }
    return CONFIG.maxTrips ? trips.slice(0, CONFIG.maxTrips) : trips;
  }

  function isSkippable(trip) {
    const text = `${trip.description || ''} ${trip.subtitle || ''}`;
    return CONFIG.skipKeywords.some((k) => text.includes(k));
  }

  // 返回 { type: 'invoice'|'receipt', url } 或 null
  async function resolvePdfUrl(trip) {
    try {
      const data = await gql(INVOICE_QUERY, { tripUUID: trip.uuid });
      const files = (data.invoiceFiles && data.invoiceFiles.files) || [];
      const pdf = files.find((f) => /\.pdf(\?|$)/i.test(f.downloadURL));
      if (pdf) return { type: 'invoice', url: pdf.downloadURL };
    } catch (e) {
      log(`  [${trip.uuid.slice(0, 8)}] 查询 invoice 出错: ${e.message}，尝试 receipt`);
    }
    // receipt 兜底
    const data = await gql(RECEIPT_QUERY, { tripUUID: trip.uuid, timestamp: '' });
    const jobs = (data.getReceipt && data.getReceipt.receiptsForJob) || [];
    const job = jobs.find((j) => j.type === 'COMPLETED') || jobs[0];
    if (!job) return null;
    return {
      type: 'receipt',
      url: `${location.origin}/trips/${trip.uuid}/receipt?contentType=PDF&timestamp=${job.timestamp}`,
    };
  }

  function gmDownload(url, name) {
    return new Promise((resolve, reject) => {
      GM_download({
        url,
        name,
        onload: () => resolve(true),
        onerror: (e) => reject(new Error(e && e.error ? e.error : 'download error')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  function saveCsv(name, text) {
    // 加 BOM 让 Excel 正确识别 UTF-8
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // subtitle 形如 "Sep 5 • 8:04 PM"（无年份）。列表按时间倒序，
  // 从参考日期（默认今天）往回推：遇到月份-日期比上一条更晚的，说明跨了年，年份减 1。
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  function assignTripDates(trips, refDate) {
    let year = refDate.getFullYear();
    let prevM = refDate.getMonth(), prevD = refDate.getDate();
    for (const t of trips) {
      const m = (t.subtitle || '').match(/([A-Z][a-z]{2})\s+(\d{1,2})/);
      if (!m || !(m[1] in MONTHS)) {
        t._date = t.subtitle || ''; // 解析不了就保留原文
        continue;
      }
      const mon = MONTHS[m[1]], day = parseInt(m[2], 10);
      if (mon > prevM || (mon === prevM && day > prevD)) year--;
      prevM = mon; prevD = day;
      t._date = `${year}/${String(mon + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
    }
  }

  function downloadCsv(rows) {
    const header = 'number,filename,type,date,title,currency,amount\n';
    const body = rows
      .map((r) =>
        [
          r.number,
          r.filename,
          r.type,
          r.date,
          `"${(r.title || '').replace(/"/g, '""')}"`,
          r.currency,
          r.amount != null ? r.amount : '',
        ].join(',')
      )
      .join('\n');
    saveCsv(CONFIG.csvName, header + body);
  }

  let running = false;

  async function run() {
    if (running) return;
    running = true;
    const btn = document.getElementById('uber-dl-start');
    if (btn) btn.disabled = true;
    try {
      const filters = getFilters();
      const fr = [];
      if (filters.startTimeMs) fr.push(`从 ${new Date(filters.startTimeMs).toLocaleDateString()}`);
      if (filters.endTimeMs) fr.push(`到 ${new Date(filters.endTimeMs).toLocaleDateString()}`);
      log('开始获取行程列表...' + (fr.length ? `（筛选: ${fr.join(', ')}）` : '（无筛选，全量）'));
      const trips = await fetchAllTrips(filters);
      log(`符合条件共 ${trips.length} 条行程`);
      // 推断每条行程的年份并生成 yyyy/mm/dd 日期
      assignTripDates(trips, filters.endTimeMs ? new Date(filters.endTimeMs) : new Date());

      const rows = [];
      let n = 0, skipped = 0, failed = 0;
      for (let i = 0; i < trips.length; i++) {
        const trip = trips[i];
        const label = `${trip.subtitle || ''} ${trip.description || ''}`.trim();
        if (isSkippable(trip)) {
          skipped++;
          log(`[${i + 1}/${trips.length}] 跳过(取消/未完成): ${label}`);
          continue;
        }
        setStatus(`处理中 ${i + 1}/${trips.length}（已下载 ${n}）`);
        try {
          const file = await resolvePdfUrl(trip);
          await sleep(CONFIG.reqDelayMs);
          if (!file) {
            failed++;
            log(`[${i + 1}/${trips.length}] 无票据可用: ${label} (${trip.uuid})`);
            continue;
          }
          n++;
          const filename = `${n}.pdf`;
          await gmDownload(file.url, filename);
          const { currency, amount } = parseAmount(trip.description);
          rows.push({ number: n, filename, type: file.type, date: trip._date, title: trip.title, currency, amount });
          log(`[${i + 1}/${trips.length}] ${filename} (${file.type}) <- ${label}`);
          await sleep(CONFIG.dlDelayMs);
        } catch (e) {
          failed++;
          log(`[${i + 1}/${trips.length}] 失败: ${label} - ${e.message}`);
        }
      }
      downloadCsv(rows);
      setStatus(`完成：下载 ${n} 个，跳过 ${skipped} 个，失败 ${failed} 个。CSV 已保存为 ${CONFIG.csvName}`);
      log('--- 全部完成 ---');
    } catch (e) {
      setStatus('出错: ' + e.message);
      log(' fatal: ' + e.message);
    } finally {
      running = false;
      if (btn) btn.disabled = false;
    }
  }

  function buildPanel() {
    if (document.getElementById('uber-dl-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'uber-dl-panel';
    panel.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:99999;width:360px;background:#fff;color:#000;' +
      'border:1px solid #ccc;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:12px;' +
      'font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;';
    const inputStyle =
      'border:1px solid #ccc;border-radius:4px;padding:4px 6px;font-size:12px;width:100%;box-sizing:border-box;';
    panel.innerHTML =
      '<div style="font-weight:700;margin-bottom:8px;">Uber 票据批量下载</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
      '<label style="flex:1;font-size:11px;color:#555;">开始日期<input type="date" id="uber-dl-start-date" style="' + inputStyle + '"></label>' +
      '<label style="flex:1;font-size:11px;color:#555;">结束日期<input type="date" id="uber-dl-end-date" style="' + inputStyle + '"></label>' +
      '</div>' +
      '<div style="font-size:11px;color:#888;margin-bottom:8px;">默认最近 30 天，可改；留空 = 不限制</div>' +
      '<button id="uber-dl-start" style="background:#000;color:#fff;border:none;border-radius:6px;' +
      'padding:8px 14px;cursor:pointer;font-size:13px;">开始批量下载 (Invoice 优先)</button>' +
      '<div id="uber-dl-status" style="margin:8px 0;color:#333;"></div>' +
      '<pre id="uber-dl-log" style="max-height:220px;overflow:auto;background:#f6f6f6;border-radius:6px;' +
      'padding:8px;margin:0;white-space:pre-wrap;word-break:break-all;font-size:11px;"></pre>';
    document.body.appendChild(panel);
    panel.querySelector('#uber-dl-start').addEventListener('click', run);

    // 默认日期：结束 = 今天，开始 = 今天往前 30 天
    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = new Date();
    const ago30 = new Date(now);
    ago30.setDate(now.getDate() - 30);
    panel.querySelector('#uber-dl-end-date').value = fmt(now);
    panel.querySelector('#uber-dl-start-date').value = fmt(ago30);
  }

  // 页面是 SPA，导航后定时确保面板存在
  buildPanel();
  setInterval(buildPanel, 3000);
})();
