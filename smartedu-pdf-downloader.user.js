// ==UserScript==
// @name         国家中小学智慧教育平台 / 人教社电子教材 PDF 下载（去水印）
// @namespace    smartedu-pdf-downloader
// @version      1.2.0
// @description  1) 智慧教育平台教材详情页「添加到我的资源库」旁生成同款「下载PDF」按钮：抓取签名原始 PDF 并移除"仅供个人学习使用"水印；2) 人教社电子书（book.pep.com.cn）工具栏生成「下载PDF」按钮：抓取全部页面图片合成 PDF
// @match        https://basic.smartedu.cn/*
// @match        https://book.pep.com.cn/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (typeof PDFLib === 'undefined') {
    console.error('[pdf-dl] pdf-lib 未能加载（检查网络或 CDN 可用性）');
    return;
  }

  var host = location.hostname;
  if (host === 'basic.smartedu.cn') {
    initSmartedu();
  } else if (host === 'book.pep.com.cn') {
    initPep();
  }

  /* ==================== 国家中小学智慧教育平台 ==================== */

  function initSmartedu() {
    // 水印块：PDF 标准 /Artifact <</Subtype /Watermark ...>>BDC ... EMC
    var WM_RE = new RegExp('/Artifact <</Subtype /Watermark[\\s\\S]*?EMC', 'g');

    function bytesToLatin1(u8) {
      var s = '';
      var CHUNK = 0x8000;
      for (var i = 0; i < u8.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
      }
      return s;
    }
    function latin1ToBytes(s) {
      var out = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
      return out;
    }
    function deflate(u8) {
      return new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    }

    // 找 pdfjs 预览 iframe（其 src 带 file + headers 两个参数）
    function findViewer() {
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        var u;
        try { u = new URL(frames[i].src); } catch (e) { continue; }
        if (u.searchParams.has('file') && u.searchParams.has('headers')) return u;
      }
      return null;
    }

    // 遍历每页内容流，删除水印 Artifact 块
    function stripWatermark(doc) {
      var removed = 0;
      var tasks = [];
      for (var p = 0; p < doc.getPageCount(); p++) {
        var page = doc.getPage(p);
        var contents = page.node.Contents();
        if (!contents) continue;
        var streams = [];
        if (contents instanceof PDFLib.PDFArray) {
          var arr = contents.asArray();
          for (var i = 0; i < arr.length; i++) {
            var s = arr[i] instanceof PDFLib.PDFRef ? doc.context.lookup(arr[i]) : arr[i];
            if (s) streams.push(s);
          }
        } else {
          streams.push(contents);
        }
        (function (page, streams) {
          tasks.push(
            Promise.all(streams.map(function (s) { return Promise.resolve(PDFLib.decodePDFRawStream(s).getBytes()); }))
              .then(function (parts) {
                var total = 0;
                for (var k = 0; k < parts.length; k++) total += parts[k].length;
                var merged = new Uint8Array(total);
                var off = 0;
                for (var k2 = 0; k2 < parts.length; k2++) { merged.set(parts[k2], off); off += parts[k2].length; }
                var str = bytesToLatin1(merged);
                var cleaned = str.replace(WM_RE, function () { removed++; return ''; });
                if (cleaned.length === str.length) return; // 本页无变化
                return deflate(latin1ToBytes(cleaned)).then(function (newBytes) {
                  var dict = doc.context.obj({ Filter: 'FlateDecode' });
                  var stream = PDFLib.PDFRawStream.of(dict, newBytes);
                  page.node.set(PDFLib.PDFName.of('Contents'), doc.context.register(stream));
                });
              })
          );
        })(page, streams);
      }
      return Promise.all(tasks).then(function () { return removed; });
    }

    function filenameFromUrl(fileUrl) {
      try {
        var u = new URL(fileUrl);
        var name = decodeURIComponent(u.pathname.split('/').pop() || '');
        if (name) return name.replace(/[\\/:*?"<>|]/g, '_');
      } catch (e) { /* ignore */ }
      return 'textbook.pdf';
    }

    var BTN_ID = 'smartedu-dl-btn';

    // 找到"添加到我的资源库"按钮，用于克隆样式
    function findResourceBtn() {
      var spans = document.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        var t = (spans[i].textContent || '').trim();
        if (t === '添加到我的资源库' || t === '我的资源库') return spans[i].parentElement;
      }
      return null;
    }

    function runDownload(btn) {
      if (btn.disabled) return;
      var u = findViewer();
      if (!u) { alert('未找到 PDF 预览（请先打开教材详情页）'); return; }
      var fileUrl = u.searchParams.get('file');
      var headers;
      try { headers = JSON.parse(u.searchParams.get('headers')); } catch (e) { alert('解析签名失败，请刷新页面重试'); return; }
      var fname = filenameFromUrl(fileUrl);
      var set = function (t) {
        var span = btn.querySelector('span');
        if (span) span.textContent = t;
      };
      btn.disabled = true;
      set('下载中…');
      fetch(fileUrl, { headers: headers })
        .then(function (res) {
          if (!res.ok) throw { status: res.status, msg: 'HTTP ' + res.status };
          set('处理中…');
          return res.arrayBuffer();
        })
        .then(function (buf) {
          return PDFLib.PDFDocument.load(new Uint8Array(buf));
        })
        .then(function (doc) {
          return stripWatermark(doc).then(function (removed) {
            return doc.save().then(function (out) {
              var blob = new Blob([out], { type: 'application/pdf' });
              var a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = fname;
              a.click();
              setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
              set(removed ? '已保存（移除' + removed + '个水印）' : '已保存');
            });
          });
        })
        .catch(function (err) {
          console.error('[pdf-dl]', err);
          if (err && err.status === 403) {
            set('签名过期');
            alert('下载被拒 (HTTP 403)：签名已过期，请刷新页面后重试。');
          } else if (err && err.status) {
            set('下载失败');
            alert('下载失败：' + err.msg + '。请刷新页面后重试。');
          } else {
            set('出错');
            alert('处理失败：' + ((err && err.message) || String(err)));
          }
        })
        .then(function () {
          btn.disabled = false;
          setTimeout(function () { set('下载PDF'); }, 2500);
        });
    }

    // 深克隆"我的资源库"按钮，换图标文字后插到它旁边
    function ensureButton() {
      if (document.getElementById(BTN_ID)) return;
      var orig = findResourceBtn();
      if (!orig || !findViewer()) return;

      var btn = orig.cloneNode(true);
      btn.id = BTN_ID;
      var span = btn.querySelector('span');
      if (span) span.textContent = '下载PDF';
      var svg = btn.querySelector('svg');
      if (svg) {
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.innerHTML = '<path d="M12 3v10.55l-3.6-3.6L7 11.4 12 16.4l5-5-1.4-1.4-3.6 3.6V3h-1zM5 19h14v-2H5v2z" fill="currentColor"></path>';
      }
      btn.addEventListener('click', function () { runDownload(btn); });
      orig.insertAdjacentElement('afterend', btn);
    }

    ensureButton();
    new MutationObserver(ensureButton).observe(document.body, { childList: true, subtree: true });
  }

  /* ==================== 人教社电子教材 ==================== */

  function initPep() {
    var BTN_ID = 'pep-dl-btn';

    function ensureButton() {
      if (document.getElementById(BTN_ID)) return;
      var bar = document.querySelector('.buttonBar');
      if (!bar || !window.bookConfig) return;
      var btn = document.createElement('div');
      btn.id = BTN_ID;
      btn.className = 'button';
      btn.textContent = '下载PDF';
      btn.style.cursor = 'pointer';
      bar.appendChild(btn);
      btn.addEventListener('click', function () { runDownload(btn); });
    }

    function runDownload(btn) {
      if (btn.getAttribute('data-busy')) return;
      var cfg = window.bookConfig;
      var total = parseInt(cfg.totalPageCount, 10);
      if (!total || total <= 0) { alert('未获取到页数信息，请刷新页面重试'); return; }
      var base;
      try { base = new URL(cfg.normalPath, location.href).href; } catch (e) { return; }
      if (base.slice(-1) !== '/') base += '/';
      var query = cfg.CreatedTime ? '?' + cfg.CreatedTime : '';
      var title = (cfg.bookTitle || '电子教材').replace(/[\\/:*?"<>|]/g, '_');
      btn.setAttribute('data-busy', '1');
      var set = function (t) { btn.textContent = t; };

      set('下载中 0/' + total);
      PDFLib.PDFDocument.create()
        .then(function (pdf) {
          var next = 1;
          var active = 0;
          var failed = [];
          var CONCURRENCY = 3;

          // 用 <img> 元素加载图片绕过 WAF（fetch/XHR 有约 18 次/会话配额）
          function loadImageViaDOM(url) {
            return new Promise(function (resolve, reject) {
              var img = new Image();
              var timer = setTimeout(function () { img.src = ''; reject(new Error('timeout')); }, 30000);
              img.onload = function () {
                clearTimeout(timer);
                if (!img.naturalWidth || !img.naturalHeight) { reject(new Error('bad size')); return; }
                var canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);
                canvas.toBlob(function (blob) {
                  if (blob && blob.size > 5000) resolve(blob);
                  else reject(new Error('bad blob'));
                }, 'image/jpeg', 0.92);
              };
              img.onerror = function () { clearTimeout(timer); reject(new Error('load error')); };
              img.src = url;
            });
          }

          function fetchPage(n, attempt) {
            return loadImageViaDOM(base + n + '.jpg' + query).catch(function () {
              if (attempt < 2) {
                return new Promise(function (res) { setTimeout(res, 1500 * (attempt + 1)); }).then(function () {
                  return fetchPage(n, attempt + 1);
                });
              }
              throw new Error('failed page ' + n);
            });
          }

          function worker() {
            if (next > total) {
              if (active === 0) return finish();
              return;
            }
            var n = next++;
            active++;
            fetchPage(n, 0)
              .then(function (blob) { return blob.arrayBuffer(); })
              .then(function (buf) { return pdf.embedJpg(new Uint8Array(buf)); })
              .then(function (img) {
                var page = pdf.addPage([img.width, img.height]);
                page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
              })
              .catch(function () { failed.push(n); })
              .then(function () {
                active--;
                set('下载中 ' + Math.min(next - 1, total) + '/' + total);
                worker();
              });
          }

          function finish() {
            if (failed.length) {
              set('出错');
              btn.removeAttribute('data-busy');
              alert('有 ' + failed.length + ' 页下载失败：' + failed.slice(0, 10).join(', ') + (failed.length > 10 ? ' …' : '') + '\n若为连续失败，可能触发了网站防护，请关闭页面重新打开后再试。');
              return;
            }
            set('生成 PDF…');
            return pdf.save().then(function (out) {
              var blob = new Blob([out], { type: 'application/pdf' });
              var a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = title + '.pdf';
              a.click();
              setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
              set('已保存');
              btn.removeAttribute('data-busy');
              setTimeout(function () { set('下载PDF'); }, 2500);
            });
          }

          for (var i = 0; i < CONCURRENCY; i++) worker();
        });
    }

    ensureButton();
    new MutationObserver(ensureButton).observe(document.body, { childList: true, subtree: true });
  }
})();
