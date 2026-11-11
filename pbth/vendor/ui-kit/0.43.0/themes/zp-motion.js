/* zp-motion.js — бренд ZP (Steel): Motion v2, общий для дашбордов ZP и ZP Studio.
   Правится ЗДЕСЬ, в ui-kit; продукты получают копию через `bun scripts/sync.js`
   (vendor/ui-kit/<версия>/themes/zp-motion.js). Подключать после ui-kit.js (значки берутся из UI.icon). */
/* zp-motion.js — Motion v2 runtime helpers (2026-04-24, Motion Council).
   Exposes window.ZPMotion:
     ZPMotion.reveal(el)          — wraps words in <span class="w"> so CSS .zp-reveal kicks in
     ZPMotion.autoReveal()        — applies to every element carrying .zp-reveal
     ZPMotion.autoReveal({lazy:true}) — reveals only when the element enters the viewport
     ZPMotion.tweenNumber(el, to) — counts the numeric content from current to `to` (600ms expo-out)
     ZPMotion.flashCell(td)       — flashes a table cell on value change (600ms text-color)
*/
(function (root) {
  'use strict';

  function reveal(el) {
    if (!el || el.dataset.zpRevealed === '1') return;
    var text = el.textContent;
    var parts = text.split(/(\s+)/);       // keep whitespace
    el.textContent = '';
    parts.forEach(function (p) {
      if (/^\s+$/.test(p)) { el.appendChild(document.createTextNode(p)); }
      else if (p.length) {
        var s = document.createElement('span');
        s.className = 'w';
        s.textContent = p;
        el.appendChild(s);
      }
    });
    el.dataset.zpRevealed = '1';
  }

  function autoReveal(rootOrOptions, maybeOptions) {
    var rootEl = rootOrOptions && typeof rootOrOptions.querySelectorAll === 'function'
      ? rootOrOptions : document;
    var options = rootEl === rootOrOptions ? (maybeOptions || {}) : (rootOrOptions || {});
    var elements = Array.from(rootEl.querySelectorAll('.zp-reveal'))
      .filter(function (el) { return el.dataset.zpRevealed !== '1'; });

    if (!options.lazy || typeof IntersectionObserver === 'undefined') {
      elements.forEach(reveal);
      return null;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    elements.forEach(function (el) { observer.observe(el); });
    return observer;
  }

  var _numberFrames = new WeakMap();
  function animateNumber(el, from, to, opts) {
    opts = opts || {};
    var dur = opts.duration == null ? 600 : opts.duration;
    var format = opts.formatter;
    var start = performance.now();
    var previousFrame = _numberFrames.get(el);
    if (previousFrame != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(previousFrame);
    }

    function step(now) {
      var t = dur <= 0 ? 1 : Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 4);
      el.textContent = format(from + (to - from) * eased);
      if (t < 1) {
        _numberFrames.set(el, requestAnimationFrame(step));
      } else {
        _numberFrames.delete(el);
        el.textContent = format(to);
        if (opts.onComplete) opts.onComplete();
      }
    }
    _numberFrames.set(el, requestAnimationFrame(step));
  }

  function tweenNumber(el, to, opts) {
    if (!el) return;
    opts = opts || {};
    var datasetKey = opts.datasetKey || 'num';
    var currentAttr = el.dataset[datasetKey];
    var parsedText = parseFloat((el.textContent || '0').replace(/[^\d.-]/g, ''));
    var from = Number.isFinite(opts.from) ? Number(opts.from)
      : (currentAttr != null && currentAttr !== '' ? parseFloat(currentAttr) : parsedText);
    if (!Number.isFinite(from)) from = 0;
    var target = Number(to);
    if (!Number.isFinite(target)) target = 0;
    var suffix = opts.suffix != null ? opts.suffix : ((el.textContent.match(/[^\d.,\s-]+$/) || [''])[0]).trim();
    var locale = opts.locale || 'ru-RU';
    var formatter = opts.formatter || function (value) {
      return Math.round(value).toLocaleString(locale) + (suffix ? ' ' + suffix : '');
    };
    animateNumber(el, from, target, {
      duration: opts.duration,
      formatter: formatter,
      onComplete: function () {
        el.dataset[datasetKey] = String(target);
        if (opts.onComplete) opts.onComplete();
      },
    });
  }

  var _flashTimers = new WeakMap();
  function retriggerClass(el, className, duration) {
    var previousTimer = _flashTimers.get(el);
    if (previousTimer != null) clearTimeout(previousTimer);
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    if (duration == null) return;
    _flashTimers.set(el, setTimeout(function () {
      el.classList.remove(className);
      _flashTimers.delete(el);
    }, duration));
  }

  function flashCell(td) {
    if (!td) return;
    retriggerClass(td, 'is-hot');
  }

  /* ─── autoTween — общий механизм анимации цифр для всех дашбордов ───
     Применение: на любом DOM-элементе ставится data-num="<число>" и
     data-fmt="money|moneyShort|num|pct|pctRaw". При вызове ZPMotion.autoTween()
     каждый такой элемент анимируется от dataset.numPrev до dataset.num за 600ms
     expo-out. Первый mount — без анимации (только стамп numPrev). При изменении —
     добавляется .zp-flash на 700ms (steel-blue вспышка). */
  function fmtMoneyRu(n) {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(Math.round(n));
    const s = abs.toLocaleString('ru-RU');
    return n < 0 ? '(' + s + ')\u00a0₽' : s + '\u00a0₽'; // между числом и ₽ — неразрывный пробел
  }
  function fmtShortRu(n) {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e6) return (n < 0 ? '−' : '') + (abs / 1e6).toFixed(1) + 'M\u00a0₽';
    if (abs >= 1e3) return (n < 0 ? '−' : '') + Math.round(abs / 1e3) + 'к\u00a0₽';
    return fmtMoneyRu(n);
  }
  function fmtNumRu(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('ru-RU');
  }
  function fmtPctRu(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(n * 100) + '%';
  }
  function fmtPctRawRu(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(n) + '%';
  }
  function pickFormatter(key) {
    // Каждый дашборд может иметь свой window.fmtAuto — пробуем его сначала,
    // потом fallback на встроенные функции.
    if (typeof window.fmtAuto === 'function') {
      return (n) => window.fmtAuto(n, key);
    }
    if (key === 'moneyShort') return fmtShortRu;
    if (key === 'num') return fmtNumRu;
    if (key === 'pct') return fmtPctRu;
    if (key === 'pctRaw') return fmtPctRawRu;
    return fmtMoneyRu;
  }

  function prefersReduced() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  function tweenInto(el, value, fmtKey) {
    if (!el) return;
    const v = (value == null || isNaN(value)) ? 0 : Number(value);
    const fmtFn = pickFormatter(fmtKey || 'money');
    const prev = el.dataset.numPrev;
    if (prev == null || prev === '') {
      el.textContent = fmtFn(v);
      el.dataset.numPrev = String(v);
      return;
    }
    const from = parseFloat(prev);
    if (Math.abs(from - v) < 0.5) return;
    if (prefersReduced()) { // без анимации: сразу итог (и снимки раскатки не ловят цифру на середине)
      el.textContent = fmtFn(v);
      el.dataset.numPrev = String(v);
      return;
    }
    tweenNumber(el, v, {
      from: from,
      formatter: fmtFn,
      datasetKey: 'numPrev',
    });
    retriggerClass(el, 'zp-flash', 700);
  }

  // Persistent cache — переживает innerHTML wipes. Ключ: id || data-key
  const _NUM_CACHE = new Map();

  function autoTween(rootEl) {
    (rootEl || document).querySelectorAll('[data-num]').forEach(node => {
      const target = parseFloat(node.dataset.num);
      if (isNaN(target)) return;
      const fmtKey = node.dataset.fmt || 'money';
      const cacheKey = node.id || node.dataset.key || null;

      // Restore previous value from persistent cache (survives innerHTML)
      if (cacheKey && _NUM_CACHE.has(cacheKey)) {
        node.dataset.numPrev = String(_NUM_CACHE.get(cacheKey));
      }

      tweenInto(node, target, fmtKey);

      if (cacheKey) _NUM_CACHE.set(cacheKey, target);
    });
  }

  function clearNumCache(prefix) {
    if (!prefix) { _NUM_CACHE.clear(); return; }
    for (const k of _NUM_CACHE.keys()) {
      if (k.startsWith(prefix)) _NUM_CACHE.delete(k);
    }
  }

  /* ─── Scroll-reveal (Steel v2.2, 2026-04-28) ───
     IntersectionObserver-обёртка для лендинговых секций. На дашбордах
     не нужен — там короткие маршруты и .zp-enter покрывает re-mount.
     На сайте-агрегаторе длинные страницы — секции должны появляться
     по мере скролла, а не выскакивать все сразу при загрузке.

     Применение:
       <div class="zp-scroll-reveal">…секция…</div>
       <div class="zp-stagger-on-view">…карточки…</div>
     Авто-вызов на DOMContentLoaded — никаких ручных init не нужно.
     Срабатывает один раз: после .is-visible элемент перестаёт наблюдаться. */
  let _scrollObserver = null;
  function scrollReveal(rootEl) {
    if (typeof IntersectionObserver === 'undefined') {
      // Fallback: показываем всё сразу
      (rootEl || document).querySelectorAll('.zp-scroll-reveal, .zp-stagger-on-view')
        .forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    if (!_scrollObserver) {
      _scrollObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            _scrollObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    }
    (rootEl || document).querySelectorAll('.zp-scroll-reveal, .zp-stagger-on-view')
      .forEach(function (el) {
        if (!el.classList.contains('is-visible')) _scrollObserver.observe(el);
      });
  }

  root.ZPMotion = {
    reveal: reveal,
    autoReveal: autoReveal,
    tweenNumber: tweenNumber,
    flashCell: flashCell,
    flashValue: function (el) { if (el) retriggerClass(el, 'zp-flash', 700); },
    tweenInto: tweenInto,
    autoTween: autoTween,
    clearNumCache: clearNumCache,
    scrollReveal: scrollReveal,
  };

  /* ─── ZPThresholds (Steel v1.6) ───
     Декларативные пороги для метрик + классификация значения как good/warn/alert.
     Использование:
       const cls = ZPThresholds.classify('cpl', 2800);  // → 'alert'
       el.classList.add('zp-th-' + cls);
     Бар-визуализация:
       el.innerHTML = ZPThresholds.bar('cpl', 2800);
   */
  const _DEFAULT_THRESHOLDS = {
    // Маркетинг (lower is better)
    cpl:        { lower: true,  good: 1500, warn: 2500, max: 4000, label: '₽' },
    cpql:       { lower: true,  good: 2000, warn: 3500, max: 6000, label: '₽' },
    cac:        { lower: true,  good: 4000, warn: 6000, max: 10000, label: '₽' },
    cpo:        { lower: true,  good: 5000, warn: 8000, max: 12000, label: '₽' },
    // Performance (higher is better)
    romi:       { higher: true, good: 300,  warn: 150,  max: 500,  label: '%' },
    conversion: { higher: true, good: 15,   warn: 8,    max: 30,   label: '%' },
    margin:     { higher: true, good: 30,   warn: 15,   max: 60,   label: '%' },
  };

  function classifyThreshold(metricKey, value) {
    const r = _DEFAULT_THRESHOLDS[metricKey];
    if (!r || value == null || isNaN(value)) return 'neutral';
    if (r.lower) {
      if (value <= r.good) return 'good';
      if (value <= r.warn) return 'warn';
      return 'alert';
    }
    if (r.higher) {
      if (value >= r.good) return 'good';
      if (value >= r.warn) return 'warn';
      return 'alert';
    }
    return 'neutral';
  }

  function thresholdBar(metricKey, value) {
    const r = _DEFAULT_THRESHOLDS[metricKey];
    if (!r) return '';
    const max = r.max || (r.lower ? r.warn * 1.6 : r.good * 1.6);
    const pos = Math.min(100, Math.max(0, (Number(value) || 0) / max * 100));
    let zoneGoodPct, zoneWarnPct, zoneAlertPct;
    if (r.lower) {
      zoneGoodPct  = (r.good / max) * 100;
      zoneWarnPct  = ((r.warn - r.good) / max) * 100;
      zoneAlertPct = 100 - zoneGoodPct - zoneWarnPct;
    } else {
      zoneAlertPct = (r.warn / max) * 100;
      zoneWarnPct  = ((r.good - r.warn) / max) * 100;
      zoneGoodPct  = 100 - zoneAlertPct - zoneWarnPct;
    }
    const goodFirst = r.lower;
    return `<div class="zp-threshold-bar">
      ${goodFirst
        ? `<span class="zone zone-good"  style="width:${zoneGoodPct}%"></span>
           <span class="zone zone-warn"  style="width:${zoneWarnPct}%"></span>
           <span class="zone zone-alert" style="width:${zoneAlertPct}%"></span>`
        : `<span class="zone zone-alert" style="width:${zoneAlertPct}%"></span>
           <span class="zone zone-warn"  style="width:${zoneWarnPct}%"></span>
           <span class="zone zone-good"  style="width:${zoneGoodPct}%"></span>`}
      <span class="marker" style="left:${pos}%"></span>
    </div>`;
  }

  function thresholdMeta(metricKey) {
    const r = _DEFAULT_THRESHOLDS[metricKey];
    if (!r) return '';
    // порог в рублях — разряды и неразрывный пробел перед ₽, как у остальных сумм
    const lbl = (v) => (r.label === '₽' ? Math.round(v).toLocaleString('ru-RU') + '\u00a0₽' : v + (r.label || ''));
    const goodLbl  = lbl(r.good);
    const warnLbl  = lbl(r.warn);
    if (r.lower) {
      return `<div class="zp-threshold-meta"><span>0</span><span>${goodLbl} норма</span><span>${warnLbl} алерт</span></div>`;
    }
    return `<div class="zp-threshold-meta"><span>${warnLbl} алерт</span><span>${goodLbl} цель</span></div>`;
  }

  root.ZPThresholds = {
    rules: _DEFAULT_THRESHOLDS,
    classify: classifyThreshold,
    bar: thresholdBar,
    meta: thresholdMeta,
    // Allow consumers to extend/override per dashboard
    register: function (key, rule) { _DEFAULT_THRESHOLDS[key] = rule; },
  };

  /* ─── zpEmpty (Steel v1.6) — единый helper для empty states ─── */
  function zpEmpty(opts) {
    opts = opts || {};
    // Значок — Lucide из ui-kit (window.UI подключён в base.html)
    const icon = opts.icon || (window.UI ? UI.icon('circle-alert', { size: 24, cls: 'zp-empty-icon' }) : '');
    const title = opts.title || 'Нет данных';
    const hint = opts.hint || '';
    const actions = (opts.actions || []).map(a => {
      const cls = a.ghost ? 'ghost' : '';
      const tag = a.onclick ? `<button class="${cls}" onclick="${a.onclick}">${a.label}</button>`
                            : `<a class="${cls}" href="${a.href || '#'}">${a.label}</a>`;
      return tag;
    }).join('');
    const cta = actions ? `<div class="zp-empty-cta">${actions}</div>` : '';
    return `<div class="zp-empty">
      ${icon}
      <div class="zp-empty-text">${title}</div>
      ${hint ? `<div class="zp-empty-hint">${hint}</div>` : ''}
      ${cta}
    </div>`;
  }
  root.zpEmpty = zpEmpty;

  /* ─── ZPDelta (Steel v1.7) — % изменение vs прошлый период ───
     Использование:
       const html = ZPDelta.chip(currentValue, prevValue, { lower: false });
       // → '<span class="zp-delta up">↑ 12.4%</span>'
       const cls = ZPDelta.classify(cur, prev, { lower: false });  // 'up'|'down'|'flat'
     `lower:true` — для метрик где меньше = лучше (CPL, CAC). Стрелки одинаковые,
     но цвет инвертируется.
   */
  function classifyDelta(cur, prev, opts) {
    if (cur == null || prev == null || isNaN(cur) || isNaN(prev) || prev === 0) return 'flat';
    const pct = (cur - prev) / Math.abs(prev) * 100;
    if (Math.abs(pct) < 2) return 'flat';
    const lower = opts && opts.lower;
    if (lower) return pct > 0 ? 'down' : 'up';  // higher CPL = bad = down
    return pct > 0 ? 'up' : 'down';
  }
  function deltaPctStr(cur, prev) {
    if (cur == null || prev == null || isNaN(cur) || isNaN(prev) || prev === 0) return '';
    const pct = (cur - prev) / Math.abs(prev) * 100;
    const sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(Math.abs(pct) < 10 ? 1 : 0) + '%';
  }
  function deltaChip(cur, prev, opts) {
    const cls = classifyDelta(cur, prev, opts);
    const arrow = cls === 'up' ? '↑' : cls === 'down' ? '↓' : '≈';
    const pctStr = deltaPctStr(cur, prev) || '0%';
    return `<span class="zp-delta ${cls}">${arrow} ${pctStr}</span>`;
  }
  root.ZPDelta = { classify: classifyDelta, chip: deltaChip, pct: deltaPctStr };

  /* ─── ZPSpark (Steel v1.8, с ui-kit 0.12.0 — поверх UI.stat.core) — спарклайн ───
     Рисует ядро ui-kit (UI.stat.core.sparkSvg): 1:1, без растяжения viewBox, сплайн, круглая точка.
     Класс по направлению: up (хорошо) / down (плохо) / flat; цвет — currentColor из .zp-spark.up/.down в zp-steel.css.
       lower:false → растёт = up (зелёный), падает = down (красный)
       lower:true  → растёт = down (плохо для CPL), падает = up
     Использование:
       el.innerHTML = ZPSpark.line([100, 120, 90, 150, 130], { lower: false });   // строка <svg> 180×24 px (w, h в opts)
       const sp = ZPSpark.mount(el, values, { lower: true, h: 24 });              // живой: под ширину блока, перерисовка при ресайзе
   */
  function sparkClass(values, opts) {
    const first = values[0], last = values[values.length - 1];
    if (Math.abs(last - first) / Math.abs(first || 1) <= 0.05) return 'flat';
    const goingUp = last > first;
    return (opts.lower ? !goingUp : goingUp) ? 'up' : 'down';
  }
  function sparkLine(values, opts) {
    if (!values || values.length < 2 || !(root.UI && root.UI.stat && root.UI.stat.core)) return '';
    opts = opts || {};
    const w = opts.w || 180, h = opts.h || 24;
    return root.UI.stat.core.sparkSvg(values, { w, h, r: 2.5, stroke: 1.5, cls: 'zp-spark ' + sparkClass(values, opts) })
      .replace('<svg ', `<svg style="width:${w}px;max-width:100%;height:auto" `);
  }
  function sparkMount(el, values, opts) {
    if (!(root.UI && root.UI.stat && root.UI.stat.spark)) return null;
    opts = opts || {};
    const sp = root.UI.stat.spark(el, values, { h: opts.h || 24, r: 2.5, stroke: 1.5 });
    el.classList.add('zp-spark');
    el.classList.remove('up', 'down', 'flat');
    if (values && values.length > 1) el.classList.add(sparkClass(values, opts));
    return sp;
  }
  root.ZPSpark = { line: sparkLine, mount: sparkMount };

  /* ─── ZPInsights (Steel v1.9) — actionable recommendations bar ───
     Использование:
       ZPInsights.load(targetEl, { from: '2026-04-01', to: '2026-04-27' });
     Делает fetch('/api/insights') и заполняет targetEl HTML-ом.
     При пустом массиве — bar скрывается (CSS :empty).
   */
  // Тексты инсайтов собирает сервер из данных (владелец кампаний в CPL-алерте) — только как текст
  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function renderInsight(it) {
    const icon = it.severity === 'alert' ? '●' : it.severity === 'warn' ? '▲' : 'ℹ';
    const actions = (it.actions || []).map(a => {
      const onclick = a.onclick ? `onclick="${escHtml(a.onclick)}"` : '';
      return `<a class="zp-insight-action" href="${escHtml(a.href || '#')}" ${onclick}>${escHtml(a.label)}</a>`;
    }).join('');
    return `<div class="zp-insight ${escHtml(it.severity)}">
      <div class="zp-insight-icon">${icon}</div>
      <div class="zp-insight-text">
        <div class="t">${escHtml(it.title)}</div>
        ${it.message ? `<div class="m">${escHtml(it.message)}</div>` : ''}
      </div>
      ${actions ? `<div class="zp-insight-actions">${actions}</div>` : ''}
    </div>`;
  }
  async function loadInsights(targetEl, params) {
    if (!targetEl) return;
    const qs = new URLSearchParams(params || {}).toString();
    try {
      const resp = await fetch('/api/insights' + (qs ? '?' + qs : ''));
      if (!resp.ok) { targetEl.innerHTML = ''; return; }
      const data = await resp.json();
      const items = data.items || [];
      targetEl.innerHTML = items.map(renderInsight).join('');
    } catch (e) {
      console.warn('ZPInsights.load failed', e);
      targetEl.innerHTML = '';
    }
  }
  root.ZPInsights = { load: loadInsights, render: renderInsight };

  /* ZPCmdK (Steel v1.10) убран в ui-kit 0.10.0: палитра ⌘K — UI.palette и UI.keys ui-kit. */

  /* ─── ZPInfo (Steel v2.1) — click-to-show formula popover ─── */
  let _infoEl = null;
  let _infoBtn = null;
  function infoClose() {
    if (_infoEl) _infoEl.remove();
    if (_infoBtn) _infoBtn.classList.remove('is-active');
    _infoEl = null;
    _infoBtn = null;
  }
  function infoToggle(e, btn, html) {
    e.preventDefault();
    e.stopPropagation();
    if (_infoBtn === btn) { infoClose(); return; }
    infoClose();
    const div = document.createElement('div');
    div.className = 'zp-info-popover';
    div.innerHTML = html;
    document.body.appendChild(div);
    // Position: below the button, aligned to its left, but keep on screen
    const rect = btn.getBoundingClientRect();
    const dRect = div.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left;
    if (left + dRect.width > vw - 16) left = vw - dRect.width - 16;
    if (left < 8) left = 8;
    let top = rect.bottom + 6;
    if (top + dRect.height > vh - 16) top = rect.top - dRect.height - 6;
    div.style.top = top + 'px';
    div.style.left = left + 'px';
    btn.classList.add('is-active');
    _infoEl = div;
    _infoBtn = btn;
    // Close on next outside click / Esc
    setTimeout(() => {
      document.addEventListener('click', infoOutsideClick, { once: true });
      document.addEventListener('keydown', infoEscClose);
    }, 0);
  }
  function infoOutsideClick(e) {
    if (_infoEl && _infoEl.contains(e.target)) {
      // Click inside popover — keep open, re-arm listener
      setTimeout(() => document.addEventListener('click', infoOutsideClick, { once: true }), 0);
      return;
    }
    infoClose();
    document.removeEventListener('keydown', infoEscClose);
  }
  function infoEscClose(e) {
    if (e.key === 'Escape') {
      infoClose();
      document.removeEventListener('keydown', infoEscClose);
    }
  }
  root.ZPInfo = { toggle: infoToggle, close: infoClose };

  // auto-run reveal + scroll-reveal on DOMContentLoaded
  function _autoBoot() {
    autoReveal();
    scrollReveal();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoBoot);
  } else {
    _autoBoot();
  }
})(typeof window !== 'undefined' ? window : this);
