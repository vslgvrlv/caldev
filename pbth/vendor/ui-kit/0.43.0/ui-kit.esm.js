/* ui-kit 0.43.0 */
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/toast/toast.core.js
var DEFAULT_TIMEOUT = { info: 4000, success: 3000, error: 7000 };
var ACTION_TIMEOUT = 1e4;
var KINDS = ["info", "success", "error"];
function createToastCore(o = {}) {
  let limit = o.limit ?? 4;
  let overflow = o.overflow === "queue" ? "queue" : "drop";
  const now = o.now ?? (() => Date.now());
  const setT = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = o.clearTimer ?? ((id) => clearTimeout(id));
  const items = [];
  const queue = [];
  const listeners = new Set;
  let seq = 0;
  const emit = () => {
    const snap = list();
    for (const fn of listeners)
      fn(snap);
  };
  const find = (id) => items.find((t) => t.id === id);
  function timeoutFor(kind, hasAction, explicit) {
    if (explicit !== undefined && explicit !== null)
      return explicit;
    return hasAction ? ACTION_TIMEOUT : DEFAULT_TIMEOUT[kind] ?? DEFAULT_TIMEOUT.info;
  }
  function arm(t, ms) {
    t.remaining = ms;
    t.total = ms;
    t.startedAt = now();
    t.timer = ms > 0 ? setT(() => dismiss(t.id, "timeout"), ms) : null;
  }
  function list() {
    return items.map((t) => ({ id: t.id, text: t.text, kind: t.kind, action: t.action ? { label: t.action.label } : null, paused: t.paused, timeout: t.total }));
  }
  function queued() {
    return queue.map((t) => ({ id: t.id, text: t.text, kind: t.kind }));
  }
  function promote() {
    while (items.length < limit && queue.length) {
      const t = queue.shift();
      items.push(t);
      arm(t, t.ms);
    }
  }
  function show({ text, kind = "info", action = null, timeout } = {}) {
    if (!KINDS.includes(kind))
      kind = "info";
    const act = action && typeof action.onClick === "function" ? { label: action.label || "Отменить", onClick: action.onClick } : null;
    const t = { id: ++seq, text: String(text ?? ""), kind, action: act, paused: false, timer: null, remaining: 0, startedAt: 0, onDismiss: typeof o.onDismiss === "function" ? o.onDismiss : null };
    t.ms = timeoutFor(kind, !!act, timeout);
    if (overflow === "queue" && items.length >= limit) {
      queue.push(t);
      return t.id;
    }
    items.push(t);
    arm(t, t.ms);
    while (items.length > limit)
      dismiss(items[0].id, "limit", true);
    emit();
    return t.id;
  }
  function dismiss(id, reason = "manual", silent = false) {
    const qi = queue.findIndex((t2) => t2.id === id);
    if (qi >= 0) {
      const [q] = queue.splice(qi, 1);
      if (q.onDismiss)
        q.onDismiss(q.id, reason);
      return true;
    }
    const i = items.findIndex((t2) => t2.id === id);
    if (i < 0)
      return false;
    const [t] = items.splice(i, 1);
    if (t.timer != null)
      clearT(t.timer);
    if (t.onDismiss)
      t.onDismiss(t.id, reason);
    if (reason !== "limit" && reason !== "clear")
      promote();
    if (!silent)
      emit();
    return true;
  }
  function runAction(id) {
    const t = find(id);
    if (!t || !t.action)
      return false;
    const fn = t.action.onClick;
    dismiss(id, "action");
    fn();
    return true;
  }
  function pause(id) {
    const t = find(id);
    if (!t || t.paused)
      return false;
    t.paused = true;
    if (t.timer != null) {
      clearT(t.timer);
      t.timer = null;
      t.remaining = Math.max(0, t.remaining - (now() - t.startedAt));
    }
    emit();
    return true;
  }
  function resume(id) {
    const t = find(id);
    if (!t || !t.paused)
      return false;
    t.paused = false;
    if (t.remaining > 0)
      arm(t, Math.max(t.remaining, 1000));
    emit();
    return true;
  }
  function clear() {
    for (const q of queue.splice(0))
      if (q.onDismiss)
        q.onDismiss(q.id, "clear");
    for (const t of [...items])
      dismiss(t.id, "clear", true);
    emit();
  }
  function configure(next = {}) {
    if (Number.isInteger(next.limit) && next.limit > 0)
      limit = next.limit;
    if (next.overflow === "queue" || next.overflow === "drop")
      overflow = next.overflow;
    promote();
    emit();
  }
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  return { show, dismiss, runAction, pause, resume, clear, configure, list, queued, subscribe, get size() {
    return items.length;
  }, get waiting() {
    return queue.length;
  } };
}

// src/icon/icon.core.js
var PREFIX = "ui-i-";
var esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function symbolId(name) {
  return PREFIX + name;
}
function iconMarkup(name, { size = 16, label = "", cls = "", href = "" } = {}) {
  if (!/^[a-z0-9-]+$/.test(String(name)))
    return "";
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  const c = `ui-icon ui-icon-${name}${cls ? " " + esc(cls) : ""}`;
  return `<svg class="${c}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" focusable="false" ${a11y}><use href="${esc(href)}#${symbolId(name)}"></use></svg>`;
}

// src/icon/icon.mount.js
var state = { href: "" };
function icon(name, opts = {}) {
  return iconMarkup(name, { href: state.href, ...opts });
}
var icons = {
  configure({ href } = {}) {
    if (typeof href === "string")
      state.href = href;
  },
  inject(svgText, doc = document) {
    let box = doc.getElementById("ui-icons-sprite");
    if (!box) {
      box = doc.createElement("div");
      box.id = "ui-icons-sprite";
      box.hidden = true;
      box.setAttribute("aria-hidden", "true");
      doc.body.prepend(box);
    }
    box.innerHTML = svgText;
  },
  async load(url, doc = document) {
    const r = await fetch(url);
    if (!r.ok)
      throw new Error(`icons: ${r.status}`);
    this.inject(await r.text(), doc);
  },
  has: (name, doc = document) => !!doc.getElementById(symbolId(name))
};
function mount(el, cfg = {}) {
  function update() {
    for (const n of el.querySelectorAll("[data-ui-icon]")) {
      n.outerHTML = icon(n.dataset.uiIcon, { size: +n.dataset.size || cfg.size || 16, label: n.dataset.label || "" });
    }
  }
  update();
  return { update, destroy() {} };
}

// src/toast/toast.mount.js
function mount2(el, cfg = {}) {
  const doc = el.ownerDocument;
  let core = null;
  let opts = { ...cfg };
  let unsub = null;
  const nodes = new Map;
  el.classList.add("ui-toast-host");
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", cfg.label || "Уведомления");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "false");
  function build(t) {
    const row = doc.createElement("div");
    row.className = `ui-toast ui-toast--${t.kind}`;
    row.setAttribute("role", t.kind === "error" ? "alert" : "status");
    row.dataset.toastId = String(t.id);
    const msg = doc.createElement("span");
    msg.className = "ui-toast__msg";
    msg.textContent = t.text;
    row.appendChild(msg);
    if (t.action) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "ui-toast__act";
      b.textContent = t.action.label;
      b.addEventListener("click", () => core.runAction(t.id));
      row.appendChild(b);
      if (opts.progress && t.timeout > 0) {
        const bar = doc.createElement("span");
        bar.className = "ui-toast__bar";
        bar.style.animationDuration = `${t.timeout}ms`;
        bar.setAttribute("aria-hidden", "true");
        row.appendChild(bar);
      }
    }
    if (opts.closable) {
      const x = doc.createElement("button");
      x.type = "button";
      x.className = "ui-toast__x";
      x.setAttribute("aria-label", opts.closeLabel || "Закрыть");
      x.innerHTML = icon("x", { size: 14 });
      x.addEventListener("click", () => core.dismiss(t.id));
      row.appendChild(x);
    }
    row.addEventListener("mouseenter", () => core.pause(t.id));
    row.addEventListener("mouseleave", () => core.resume(t.id));
    row.addEventListener("focusin", () => core.pause(t.id));
    row.addEventListener("focusout", () => core.resume(t.id));
    return row;
  }
  function render(list) {
    const ids = new Set(list.map((t) => t.id));
    for (const [id, node] of nodes)
      if (!ids.has(id)) {
        node.remove();
        nodes.delete(id);
      }
    for (const t of list) {
      if (!nodes.has(t.id)) {
        const n = build(t);
        nodes.set(t.id, n);
        el.appendChild(n);
      }
      nodes.get(t.id).toggleAttribute("data-paused", !!t.paused);
    }
  }
  function init(c) {
    if (unsub)
      unsub();
    opts = { ...c };
    core = createToastCore(c);
    unsub = core.subscribe(render);
  }
  init(cfg);
  return {
    show: (opts2) => core.show(opts2),
    dismiss: (id) => core.dismiss(id),
    configure(next = {}) {
      opts = { ...opts, ...next };
      core.configure(next);
      render(core.list());
    },
    list: () => core.list(),
    queued: () => core.queued(),
    clear: () => core.clear(),
    subscribe: (fn) => core.subscribe(fn),
    update(next) {
      core.clear();
      init({ ...cfg, ...next });
    },
    destroy() {
      core.clear();
      if (unsub)
        unsub();
      nodes.clear();
      el.replaceChildren();
      el.classList.remove("ui-toast-host");
      el.removeAttribute("role");
      el.removeAttribute("aria-live");
    }
  };
}

// src/dialog/dialog.core.js
function createLayerStack() {
  const layers = [];
  let seq = 0;
  function open({ opener = null, esc: esc2 = true, backdrop = true } = {}) {
    const layer = { id: ++seq, opener, esc: esc2, backdrop };
    layers.push(layer);
    return layer.id;
  }
  function close(id) {
    const i = layers.findIndex((l) => l.id === id);
    if (i < 0)
      return { closed: false, restoreTo: null };
    const [layer] = layers.splice(i, 1);
    if (i === layers.length)
      return { closed: true, restoreTo: layer.opener };
    layers[i].opener = layer.opener;
    return { closed: true, restoreTo: null };
  }
  function escape() {
    const top = layers[layers.length - 1];
    return top && top.esc ? top.id : null;
  }
  function backdropClick(id) {
    const top = layers[layers.length - 1];
    return !!top && top.id === id && top.backdrop;
  }
  return {
    open,
    close,
    escape,
    backdropClick,
    top: () => layers.length ? layers[layers.length - 1].id : null,
    has: (id) => layers.some((l) => l.id === id),
    get size() {
      return layers.length;
    },
    ids: () => layers.map((l) => l.id)
  };
}
var SIDES = ["left", "right"];
var SWIPE_MIN = 60;
function sideOf(v) {
  return SIDES.includes(v) ? v : null;
}
function swipeCloses(side, dx, dy, min = SWIPE_MIN) {
  const s = sideOf(side);
  if (!s || !Number.isFinite(dx) || !Number.isFinite(dy))
    return false;
  if (Math.abs(dx) <= Math.abs(dy) * 1.5)
    return false;
  return s === "left" ? dx < -min : dx > min;
}

// src/dialog/dialog.mount.js
var X_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
function mount3(root, cfg = {}) {
  const doc = root.ownerDocument;
  const stack = createLayerStack();
  const live = new Map;
  const closeLabel = cfg.closeLabel || "Закрыть";
  let uid = 0;
  function open(opts = {}) {
    const dlg = doc.createElement("dialog");
    dlg.className = "ui-dialog";
    if (opts.size === "lg" || opts.size === "xl")
      dlg.classList.add(`ui-dialog--${opts.size}`);
    if (typeof opts.className === "string") {
      for (const c of opts.className.split(/\s+/))
        if (c && !c.startsWith("ui-dialog"))
          dlg.classList.add(c);
    }
    const side = sideOf(opts.side);
    if (side) {
      dlg.classList.add("ui-dialog--side");
      dlg.classList.add(`ui-dialog--${side}`);
    }
    if (side && opts.label)
      dlg.setAttribute("aria-label", String(opts.label));
    const titleId = `ui-dialog-t${++uid}`;
    if (opts.title)
      dlg.setAttribute("aria-labelledby", titleId);
    const panel = doc.createElement("div");
    panel.className = "ui-dialog__panel";
    const grip = doc.createElement("div");
    grip.className = "ui-dialog__grip";
    if (!side)
      panel.appendChild(grip);
    const head = doc.createElement("header");
    head.className = "ui-dialog__head";
    const h = doc.createElement("h2");
    h.className = "ui-dialog__title";
    h.id = titleId;
    h.textContent = opts.title || "";
    const x = doc.createElement("button");
    x.type = "button";
    x.className = "ui-dialog__x";
    x.setAttribute("aria-label", closeLabel);
    x.innerHTML = X_SVG;
    const sub = opts.subtitle;
    const hasSub = typeof sub === "string" ? sub !== "" : !!(sub && typeof sub === "object" && sub.nodeType === 1);
    if (hasSub) {
      const titles = doc.createElement("div");
      titles.className = "ui-dialog__titles";
      const s = doc.createElement("div");
      s.className = "ui-dialog__subtitle";
      if (typeof sub === "string")
        s.textContent = sub;
      else
        s.appendChild(sub);
      titles.append(h, s);
      head.appendChild(titles);
    } else
      head.appendChild(h);
    if (opts.head && typeof opts.head === "object" && opts.head.nodeType === 1) {
      const aside = doc.createElement("div");
      aside.className = "ui-dialog__aside";
      aside.appendChild(opts.head);
      head.appendChild(aside);
    }
    head.appendChild(x);
    if (!side || opts.title)
      panel.appendChild(head);
    const body = doc.createElement("div");
    body.className = "ui-dialog__body";
    if (opts.content && typeof opts.content === "object" && opts.content.nodeType)
      body.appendChild(opts.content);
    else if (opts.content != null) {
      const p = doc.createElement("div");
      p.className = "ui-dialog__text";
      p.textContent = String(opts.content);
      body.appendChild(p);
    }
    panel.appendChild(body);
    const opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    const id = stack.open({ opener, esc: opts.esc !== false, backdrop: opts.backdrop !== false });
    let done = false;
    function finish(reason) {
      if (done)
        return;
      done = true;
      const { restoreTo } = stack.close(id);
      live.delete(id);
      if (dlg.open)
        dlg.close();
      dlg.remove();
      if (restoreTo && restoreTo.isConnected && typeof restoreTo.focus === "function")
        restoreTo.focus();
      if (typeof opts.onClose === "function")
        opts.onClose(reason);
    }
    let pending = false;
    let askedAt = -Infinity;
    function request(reason) {
      if (done || pending)
        return;
      askedAt = Date.now();
      const out = (reason2) => finish(reason2 === "x" ? "close" : reason2);
      if (typeof opts.beforeClose !== "function")
        return out(reason);
      let r;
      try {
        r = opts.beforeClose(reason);
      } catch (e) {
        console.error(e);
        return;
      }
      if (r && typeof r.then === "function") {
        pending = true;
        r.then((v) => {
          pending = false;
          if (v !== false && !done)
            out(reason);
        }, (e) => {
          pending = false;
          console.error(e);
        });
      } else if (r !== false)
        out(reason);
    }
    if (Array.isArray(opts.actions) && opts.actions.length) {
      const foot = doc.createElement("footer");
      foot.className = "ui-dialog__foot";
      for (const a of opts.actions) {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = `ui-dialog__btn${a.kind ? ` ui-dialog__btn--${a.kind}` : ""}`;
        b.textContent = a.label;
        b.addEventListener("click", async () => {
          let keep = false;
          if (typeof a.onClick === "function")
            keep = await a.onClick() === false;
          if (!keep && a.close !== false)
            finish("action");
        });
        foot.appendChild(b);
      }
      panel.appendChild(foot);
    }
    dlg.appendChild(panel);
    x.addEventListener("click", () => request("x"));
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      const target = stack.escape();
      if (target != null && live.has(target))
        live.get(target).request("esc");
    });
    dlg.addEventListener("close", () => {
      if (done)
        return;
      if (opts.esc === false || typeof opts.beforeClose === "function") {
        if (!dlg.open && dlg.isConnected)
          dlg.showModal();
        if (opts.esc !== false && Date.now() - askedAt > 200)
          request("esc");
        return;
      }
      finish("esc");
    });
    let downOnBackdrop = false;
    const markDown = (e) => {
      downOnBackdrop = e.target === dlg;
    };
    dlg.addEventListener("pointerdown", markDown);
    dlg.addEventListener("mousedown", markDown);
    dlg.addEventListener("click", (e) => {
      const fromBackdrop = downOnBackdrop;
      downOnBackdrop = false;
      if (e.target === dlg && fromBackdrop && stack.backdropClick(id))
        request("backdrop");
    });
    if (side) {
      let sx = 0, sy = 0, tracking = false;
      const pt = (e) => e.changedTouches && e.changedTouches[0] || e.touches && e.touches[0] || null;
      panel.addEventListener("touchstart", (e) => {
        const t = pt(e);
        tracking = !!t && (!e.touches || e.touches.length === 1);
        if (t) {
          sx = t.clientX;
          sy = t.clientY;
        }
      }, { passive: true });
      panel.addEventListener("touchcancel", () => {
        tracking = false;
      });
      panel.addEventListener("touchend", (e) => {
        const t = pt(e);
        if (!tracking || !t)
          return;
        tracking = false;
        if (swipeCloses(side, t.clientX - sx, t.clientY - sy))
          request("swipe");
      });
    }
    live.set(id, { el: dlg, finish, request });
    root.appendChild(dlg);
    dlg.showModal();
    function setTitle(text) {
      h.textContent = text == null ? "" : String(text);
      if (h.textContent)
        dlg.setAttribute("aria-labelledby", titleId);
      else
        dlg.removeAttribute("aria-labelledby");
    }
    return { close: () => finish("api"), el: dlg, body, setTitle };
  }
  return {
    open,
    closeAll() {
      for (const id of [...stack.ids()].reverse())
        live.get(id)?.finish("api");
    },
    destroy() {
      this.closeAll();
    }
  };
}

// src/period/period.core.js
var exports_period_core = {};
__export(exports_period_core, {
  validateRange: () => validateRange,
  validDay: () => validDay,
  toISO: () => toISO,
  shiftMonth: () => shiftMonth,
  parseISO: () => parseISO,
  monthTitle: () => monthTitle,
  monthGrid: () => monthGrid,
  fmtLabel: () => fmtLabel,
  findPreset: () => findPreset,
  computeRange: () => computeRange,
  addDaysISO: () => addDaysISO,
  PRESET_SETS: () => PRESET_SETS,
  NAV_KINDS: () => NAV_KINDS
});
var PRESET_SETS = {
  back: [
    { id: "today", label: "Сегодня", kind: "day", dir: 0 },
    { id: "yesterday", label: "Вчера", kind: "day", dir: -1 },
    { id: "this-week", label: "Неделя", kind: "week", dir: 0 },
    { id: "last-week", label: "Прош. нед", kind: "week", dir: -1 },
    { id: "this-month", label: "Месяц", kind: "month", dir: 0 },
    { id: "last-month", label: "Прош. мес", kind: "month", dir: -1 }
  ],
  forward: [
    { id: "current-month", label: "Этот месяц", kind: "calendar-month", dir: 0 },
    { id: "window30", label: "±15 дн", kind: "window", back: 15, fwd: 15 },
    { id: "next-30d", label: "+30 дн", kind: "forward-days", days: 30 },
    { id: "next-90d", label: "+90 дн", kind: "forward-days", days: 90 },
    { id: "next-month", label: "След. месяц", kind: "calendar-month", dir: 1 }
  ]
};
var NAV_KINDS = { days: 1, day: 1, week: 1, month: 1, "calendar-month": 1 };
function parseISO(s) {
  return new Date(s + "T00:00:00");
}
function toISO(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function daysBetween(a, b) {
  return Math.round((b - a) / 86400000) + 1;
}
function day0(today) {
  const d = today == null ? new Date : typeof today === "string" ? parseISO(today.slice(0, 10)) : new Date(today);
  d.setHours(0, 0, 0, 0);
  return d;
}
function fmtLabel(fromS, toS) {
  if (!fromS || !toS)
    return "—";
  const f = parseISO(fromS), t = parseISO(toS);
  const sameYear = f.getFullYear() === t.getFullYear();
  const sameMonth = sameYear && f.getMonth() === t.getMonth();
  if (sameMonth && f.getDate() === 1 && t.getDate() === new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()) {
    return t.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  }
  if (sameMonth && f.getDate() === t.getDate()) {
    return f.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  }
  if (sameMonth) {
    return f.getDate() + "–" + t.getDate() + " " + f.toLocaleDateString("ru-RU", { month: "short", year: "numeric" });
  }
  const fOpts = sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" };
  return f.toLocaleDateString("ru-RU", fOpts) + " — " + t.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}
function computeRange(preset, state2 = {}, today) {
  const t = day0(today);
  const off = state2.offset || 0;
  let from, to;
  switch (preset.kind) {
    case "days":
      to = addDays(t, -off * preset.days);
      from = addDays(to, -(preset.days - 1));
      break;
    case "day":
      from = to = addDays(t, (preset.dir || 0) - off);
      break;
    case "week": {
      const monday = addDays(t, -((t.getDay() + 6) % 7));
      from = addDays(monday, 7 * ((preset.dir || 0) - off));
      to = addDays(from, 6);
      break;
    }
    case "month": {
      const eff = (preset.dir || 0) - off;
      if (eff === 0) {
        from = new Date(t.getFullYear(), t.getMonth(), 1);
        to = t;
      } else {
        from = new Date(t.getFullYear(), t.getMonth() + eff, 1);
        to = new Date(t.getFullYear(), t.getMonth() + eff + 1, 0);
      }
      break;
    }
    case "calendar-month": {
      const dir = (preset.dir || 0) - off;
      from = new Date(t.getFullYear(), t.getMonth() + dir, 1);
      to = new Date(t.getFullYear(), t.getMonth() + dir + 1, 0);
      break;
    }
    case "window":
      from = addDays(t, -(preset.back || 15));
      to = addDays(t, preset.fwd || 15);
      break;
    case "forward-days":
      from = t;
      to = addDays(t, preset.days || 30);
      break;
    case "all":
      from = parseISO(preset.since || "2026-01-01");
      to = t;
      break;
    case "custom":
    default:
      if (state2.from && state2.to) {
        return { from: state2.from, to: state2.to, label: fmtLabel(state2.from, state2.to), preset: "custom", offset: 0, days: daysBetween(parseISO(state2.from), parseISO(state2.to)) };
      }
      to = t;
      from = addDays(t, -29);
  }
  const fromS = toISO(from), toS = toISO(to);
  return { from: fromS, to: toS, label: fmtLabel(fromS, toS), preset: preset.id, offset: off, days: daysBetween(from, to) };
}
function findPreset(presets, id) {
  for (let i = 0;i < presets.length; i++)
    if (presets[i].id === id)
      return presets[i];
  return null;
}
function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || ""))
    return false;
  const parsed = new Date(day + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}
function validateRange(from, to, today, { maxDays = 366, noFuture = false } = {}) {
  if (!from || !to)
    return { ok: false, error: "Укажи обе даты периода." };
  if (!validDay(from) || !validDay(to) || noFuture && !validDay(today))
    return { ok: false, error: "Проверь формат и существование дат." };
  if (from > to)
    return { ok: false, error: "Дата начала должна быть не позже даты окончания." };
  if (noFuture && to > today)
    return { ok: false, error: "Будущие даты пока недоступны." };
  const days = Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
  if (days > maxDays)
    return { ok: false, error: `Можно выбрать не больше ${maxDays} дней.` };
  return { ok: true, error: "" };
}
function addDaysISO(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
var dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
function monthGrid(year, month) {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lead = (dow(first) + 6) % 7;
  const start = addDaysISO(first, -lead);
  const weeks = [];
  for (let w = 0;w < 6; w++) {
    const row = [];
    for (let d = 0;d < 7; d++) {
      const iso = addDaysISO(start, w * 7 + d);
      row.push({ iso, day: Number(iso.slice(8, 10)), inMonth: Number(iso.slice(5, 7)) === month });
    }
    if (w >= 4 && !row.some((c) => c.inMonth))
      break;
    weeks.push(row);
  }
  return weeks;
}
var MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
var monthTitle = (year, month) => `${MONTHS[month - 1]} ${year}`;
var shiftMonth = (year, month, by) => {
  const i = year * 12 + (month - 1) + by;
  return { year: Math.floor(i / 12), month: i % 12 + 1 };
};

// src/period/period.mount.js
var REG = {};
function store(cfg) {
  if (cfg.storage)
    return cfg.storage;
  try {
    return globalThis.localStorage || null;
  } catch (e) {
    return null;
  }
}
function save(inst) {
  try {
    inst.store && inst.store.setItem(inst.prefix + inst.cfg.key, JSON.stringify(inst.state));
  } catch (e) {}
}
function load(st, name) {
  try {
    const raw = st && st.getItem(name);
    if (raw)
      return JSON.parse(raw);
  } catch (e) {}
  return null;
}
function currentRange(inst) {
  const presets = inst.presets.concat([{ id: "custom", kind: "custom" }]);
  const p = findPreset(presets, inst.state.preset) || inst.presets[0];
  return computeRange(p, inst.state, inst.cfg.today);
}
function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls)
    n.className = cls;
  if (text != null)
    n.textContent = text;
  return n;
}
function button(doc, cls, text) {
  const b = el(doc, "button", cls, text);
  b.type = "button";
  return b;
}
function render(inst) {
  const { cfg, state: state2, presets, host } = inst;
  const doc = host.ownerDocument;
  const range = currentRange(inst);
  const cur = findPreset(presets, state2.preset);
  const navOk = !!(cfg.nav && cur && NAV_KINDS[cur.kind]);
  const bar = el(doc, "div", "ui-period");
  if (navOk) {
    const prev = button(doc, "ui-period__chip ui-period__nav", "‹");
    prev.setAttribute("aria-label", "Раньше");
    prev.addEventListener("click", () => {
      state2.offset = (state2.offset || 0) + 1;
      commit(inst, true);
    });
    bar.appendChild(prev);
  }
  for (const p of presets) {
    const active = state2.preset === p.id;
    const b = button(doc, "ui-period__chip" + (active ? " is-active" : ""), p.label);
    b.setAttribute("aria-pressed", active ? "true" : "false");
    b.addEventListener("click", () => {
      if (state2.preset !== p.id) {
        state2.preset = p.id;
        state2.offset = 0;
      }
      commit(inst, true);
    });
    bar.appendChild(b);
  }
  if (navOk) {
    const next = button(doc, "ui-period__chip ui-period__nav", "›");
    next.setAttribute("aria-label", "Позже");
    if ((state2.offset || 0) <= 0)
      next.disabled = true;
    next.addEventListener("click", () => {
      const n = (state2.offset || 0) - 1;
      if (n < 0)
        return;
      state2.offset = n;
      commit(inst, true);
    });
    bar.appendChild(next);
  }
  let errorEl = null;
  if (cfg.custom !== false) {
    const wrap = el(doc, "span", "ui-period__custom");
    const fromI = el(doc, "input", "ui-period__date");
    fromI.type = "date";
    fromI.value = range.from;
    fromI.setAttribute("aria-label", "Начало периода");
    const toI = el(doc, "input", "ui-period__date");
    toI.type = "date";
    toI.value = range.to;
    toI.setAttribute("aria-label", "Конец периода");
    wrap.append(fromI, el(doc, "span", "ui-period__sep", "—"), toI);
    bar.appendChild(wrap);
    errorEl = el(doc, "span", "ui-period__error");
    errorEl.setAttribute("role", "alert");
    const onCustom = () => {
      const from = fromI.value, to = toI.value;
      if (cfg.validate) {
        const today = toISO(todayDate(cfg));
        const v = validateRange(from, to, today, cfg.validate);
        if (!v.ok) {
          errorEl.textContent = v.error;
          return;
        }
      } else if (!(from && to && from <= to))
        return;
      errorEl.textContent = "";
      state2.from = from;
      state2.to = to;
      state2.preset = "custom";
      state2.offset = 0;
      commit(inst, true);
    };
    fromI.addEventListener("change", onCustom);
    toI.addEventListener("change", onCustom);
  }
  bar.appendChild(el(doc, "span", "ui-period__label", range.label));
  if (errorEl)
    bar.appendChild(errorEl);
  host.textContent = "";
  host.appendChild(bar);
}
function todayDate(cfg) {
  const t = cfg.today;
  if (t == null)
    return new Date;
  return typeof t === "string" ? new Date(t.slice(0, 10) + "T00:00:00") : new Date(t);
}
function commit(inst, fire) {
  save(inst);
  render(inst);
  if (fire && typeof inst.cfg.onChange === "function")
    inst.cfg.onChange(currentRange(inst));
}
function get(key) {
  const inst = REG[key];
  return inst ? currentRange(inst) : null;
}
function set(key, presetId) {
  const inst = REG[key];
  if (!inst)
    return;
  inst.state.preset = presetId;
  inst.state.offset = 0;
  commit(inst, true);
}
function mount4(host, cfg) {
  if (!host || !cfg || !cfg.key)
    return null;
  const presets = Array.isArray(cfg.presets) ? cfg.presets : PRESET_SETS[cfg.presets] || PRESET_SETS.back;
  const st = store(cfg);
  const prefix = cfg.storagePrefix == null ? "ui-period-" : cfg.storagePrefix;
  const saved = load(st, prefix + cfg.key);
  const state2 = saved && (findPreset(presets, saved.preset) || saved.preset === "custom") ? saved : { preset: cfg.defaultPreset || presets[0].id, offset: 0, from: null, to: null };
  const inst = { cfg, presets, state: state2, host, store: st, prefix };
  REG[cfg.key] = inst;
  render(inst);
  if (typeof cfg.onChange === "function")
    cfg.onChange(currentRange(inst));
  return { get: () => get(cfg.key), set: (id) => set(cfg.key, id) };
}

// src/drill/drill.core.js
var exports_drill_core = {};
__export(exports_drill_core, {
  totalOf: () => totalOf,
  thinSep: () => thinSep,
  tableHtml: () => tableHtml,
  sortRows: () => sortRows,
  safeUrl: () => safeUrl,
  rowAt: () => rowAt,
  parentsOf: () => parentsOf,
  noteHtml: () => noteHtml,
  kids: () => kids,
  isNumCol: () => isNumCol,
  fmtDate: () => fmtDate,
  esc: () => esc2,
  defaultMap: () => defaultMap,
  cellInner: () => cellInner
});
function esc2(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function thinSep(n) {
  const r = Math.round(n);
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (r < 0 ? "−" : "") + s;
}
function get2(col, row) {
  return col.value ? col.value(row) : row[col.key];
}
function isEmpty(col, v) {
  if (v == null || v === "")
    return true;
  return col.type === "money" && v === 0 && !col.showZero;
}
function fmtDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? m[3] + "." + m[2] + "." + m[1].slice(2) : String(v);
}
function safeClass(s) {
  return String(s == null ? "" : s).replace(/[^\w -]/g, "");
}
function safeUrl(u) {
  return /^https?:\/\//i.test(String(u || "")) ? String(u) : "";
}
function isNumCol(col) {
  return col.type === "num" || col.type === "money";
}
function isRight(col) {
  return isNumCol(col) || col.align === "right";
}
function sortValue(col, row) {
  const s = col.sort;
  const v = typeof s === "function" ? s(row) : s ? row[s] : get2(col, row);
  if (isNumCol(col) || typeof s !== "undefined" && typeof v === "number")
    return v == null || v === "" ? null : +v;
  if (v == null || v === "")
    return null;
  return String(v).toLowerCase();
}
function kids(row) {
  return row && Array.isArray(row.children) ? row.children.filter((r) => r && typeof r === "object") : [];
}
function parentsOf(rows, out = []) {
  for (const r of rows || []) {
    const k = kids(r);
    if (k.length) {
      out.push(r);
      parentsOf(k, out);
    }
  }
  return out;
}
function rowAt(rows, path) {
  let list = rows, row = null;
  for (const part of String(path).split(".")) {
    row = list && list[+part];
    if (!row)
      return null;
    list = kids(row);
  }
  return row;
}
function sortRows(rows, col, dir) {
  const k = dir === "asc" ? 1 : -1;
  const keyed = rows.map((row, i) => ({ row, i, v: sortValue(col, row) }));
  keyed.sort((a, b) => {
    const ea = a.v == null || col.type === "money" && a.v === 0 && !col.showZero;
    const eb = b.v == null || col.type === "money" && b.v === 0 && !col.showZero;
    if (ea !== eb)
      return ea ? 1 : -1;
    if (!ea) {
      const c = typeof a.v === "string" ? a.v.localeCompare(b.v, "ru") : a.v - b.v;
      if (c)
        return c * k;
    }
    return a.i - b.i;
  });
  return keyed.map((x) => x.row);
}
function totalOf(col, rows) {
  if (!col.total)
    return null;
  const vals = rows.map((r) => get2(col, r)).filter((v) => !isEmpty(col, v));
  if (col.total === "count")
    return vals.length;
  const nums = vals.map(Number).filter((n) => !isNaN(n));
  if (!nums.length)
    return col.total === "sum" ? 0 : null;
  const sum = nums.reduce((a, n) => a + n, 0);
  return col.total === "avg" ? sum / nums.length : sum;
}
function numText(col, v, forTotal) {
  if (col.type === "money")
    return thinSep(v) + " ₽";
  const t = thinSep(v);
  return col.suffix && !(forTotal && col.total === "count") ? t + col.suffix : t;
}
function linkUrl(col, row, cfg) {
  let u;
  if (typeof col.href === "function")
    u = col.href(row);
  else if (col.href)
    u = row[col.href];
  else if (cfg && typeof cfg.link === "function")
    u = cfg.link(row);
  else
    u = row.url;
  if (u && typeof u === "object")
    u = u.url;
  return safeUrl(u);
}
function cellInner(col, row, cfg = {}) {
  const badgeClass = safeClass(cfg.badgeClass || "ui-drill__badge");
  const v = get2(col, row);
  let main;
  if (isEmpty(col, v)) {
    main = "—";
  } else if (col.type === "num" || col.type === "money") {
    main = esc2(numText(col, +v));
  } else if (col.type === "date") {
    main = esc2(fmtDate(v));
  } else if (col.type === "link") {
    const href = linkUrl(col, row, cfg);
    main = href ? '<a href="' + esc2(href) + '" target="_blank" rel="noopener" title="' + esc2(v) + '">' + esc2(v) + "</a>" : esc2(v);
  } else if (col.type === "badge") {
    const cls = col.cls ? safeClass(col.cls(row)) : "";
    const hex = col.color ? row[col.color] : null;
    const style = hex && /^#[0-9a-f]{6}$/i.test(hex) ? ' style="color:' + hex + ";border-color:" + hex + '59"' : "";
    main = '<span class="' + badgeClass + (cls ? " " + cls : "") + '"' + style + ">" + esc2(v) + "</span>";
  } else if (col.maxChars && String(v).length > col.maxChars) {
    main = '<span title="' + esc2(v) + '">' + esc2(String(v).slice(0, col.maxChars - 1)) + "…</span>";
  } else {
    main = esc2(v);
  }
  const tag = col.tag ? col.tag(row) : null;
  if (tag)
    main += ' <span class="' + badgeClass + '">' + esc2(tag) + "</span>";
  const sub = col.sub ? col.sub(row) : null;
  if (sub) {
    const st = typeof col.subTitle === "function" ? col.subTitle(row) : col.subTitle;
    main += '<div class="ui-drill__sub"' + (st ? ' title="' + esc2(st) + '"' : "") + ">" + esc2(sub) + "</div>";
  }
  return main;
}
function tableHtml(cfg, rows, state2) {
  const cols = cfg.columns;
  const sortable = cfg.sortable !== false;
  const head = cols.map((c, i) => {
    const active = sortable && state2.col === i;
    const arrow = !sortable ? "" : '<span class="ui-drill__arrow">' + (active ? state2.dir === "asc" ? "↑" : "↓" : "↕") + "</span>";
    return '<th class="' + (isRight(c) ? "num" : "") + (sortable ? " is-sortable" : "") + (active ? " is-active" : "") + '"' + (sortable ? ' data-ui-drill-col="' + i + '"' : "") + (c.title ? ' title="' + esc2(c.title) + '"' : "") + ">" + esc2(c.label) + arrow + "</th>";
  }).join("");
  const nested = rows.some((r) => kids(r).length);
  const isOpen = (row) => state2.open ? typeof state2.open.has === "function" ? state2.open.has(row) : false : !!cfg.expandAll;
  const lines = [];
  const walk = (list, prefix, depth, shown) => list.forEach((row, i) => {
    const path = prefix + i, ch = kids(row), open = ch.length > 0 && isOpen(row);
    const cls = (depth ? "ui-drill__child" : "") + (ch.length ? (depth ? " " : "") + "ui-drill__parent" : "");
    const attrs = (cls ? ' class="' + cls + '"' : "") + (depth ? ' style="--ui-drill-depth:' + depth + '"' : "") + (ch.length ? ' data-ui-drill-row="' + path + '"' : "") + (shown ? "" : " hidden");
    const lead = ch.length ? '<button type="button" class="ui-drill__toggle" data-ui-drill-toggle="' + path + '" aria-expanded="' + open + '" aria-label="' + (open ? "Свернуть" : "Раскрыть") + '">›</button>' : nested ? '<span class="ui-drill__toggle-pad"></span>' : "";
    lines.push("<tr" + attrs + ">" + cols.map((c, ci) => '<td class="' + (isRight(c) ? "num" : "") + '">' + (ci === 0 ? lead : "") + cellInner(c, row, cfg) + "</td>").join("") + "</tr>");
    if (ch.length)
      walk(ch, path + ".", depth + 1, shown && open);
  });
  walk(rows, "", 0, true);
  const body = lines.join("");
  let foot = "";
  if (cols.some((c) => c.total)) {
    foot = "<tfoot><tr>" + cols.map((c, i) => {
      const t = totalOf(c, rows);
      let txt = t == null ? "" : esc2(numText(c.total === "count" ? { type: "num" } : c, t, true));
      if (i === 0 && !c.total)
        txt = "Итого";
      return '<td class="' + (isRight(c) ? "num" : "") + '">' + txt + "</td>";
    }).join("") + "</tr></tfoot>";
  }
  return '<div class="ui-drill__wrap"><table class="ui-drill">' + "<thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody>" + foot + "</table></div>";
}
function noteHtml(text) {
  return '<div class="ui-drill__note">' + esc2(text) + "</div>";
}
function defaultMap(json) {
  const rows = Array.isArray(json) ? json : json && (json.rows || json.deals) || [];
  return { rows };
}

// src/drill/drill.mount.js
function mount5(el2, cfg) {
  const view = { cfg, rows: [], shown: [], state: { col: null, dir: "asc", open: new Set }, el: el2 };
  const token = {};
  el2.__uiDrill = token;
  function draw() {
    let rows = view.rows;
    if (!rows.length) {
      el2.innerHTML = noteHtml(cfg.empty || "Пусто — в этой выборке строк нет.");
      return;
    }
    const st = view.state;
    if (cfg.sortable !== false && st.col != null)
      rows = sortRows(rows, cfg.columns[st.col], st.dir);
    view.shown = rows;
    el2.innerHTML = tableHtml(cfg, rows, st);
  }
  view.toggle = (row, focusPath) => {
    if (!row)
      return;
    const open = view.state.open;
    if (open.has(row))
      open.delete(row);
    else
      open.add(row);
    draw();
    if (focusPath != null && el2.querySelector) {
      const b = el2.querySelector('[data-ui-drill-toggle="' + focusPath + '"]');
      if (b && b.focus)
        b.focus();
    }
  };
  view.sortBy = (i) => {
    const col = cfg.columns[i];
    if (!col || cfg.sortable === false)
      return;
    const st = view.state;
    st.dir = st.col === i ? st.dir === "asc" ? "desc" : "asc" : isNumCol(col) || col.type === "date" ? "desc" : "asc";
    st.col = i;
    draw();
  };
  el2.onclick = (e) => {
    const t = e && e.target && e.target.closest ? e.target : null;
    if (!t)
      return;
    const th = t.closest("[data-ui-drill-col]");
    if (th) {
      view.sortBy(+th.getAttribute("data-ui-drill-col"));
      return;
    }
    const btn = t.closest("[data-ui-drill-toggle]");
    if (btn) {
      const p = btn.getAttribute("data-ui-drill-toggle");
      view.toggle(rowAt(view.shown, p), p);
      return;
    }
    if (t.closest("a, button, input, select, textarea, label"))
      return;
    const tr = t.closest("[data-ui-drill-row]");
    if (tr)
      view.toggle(rowAt(view.shown, tr.getAttribute("data-ui-drill-row")));
  };
  function accept(res) {
    view.rows = res.rows || [];
    view.state.open = new Set(cfg.expandAll ? parentsOf(view.rows) : []);
    if (cfg.onLoad)
      cfg.onLoad({ rows: view.rows, subtitle: res.subtitle, json: res.json });
    draw();
  }
  if (cfg.fetch) {
    el2.innerHTML = noteHtml(cfg.loading || "Загрузка…");
    const doFetch = cfg.fetchFn || globalThis.fetch;
    return Promise.resolve(doFetch(cfg.fetch)).then((r) => {
      if (!r.ok)
        throw new Error("HTTP " + r.status);
      return r.json();
    }).then((json) => {
      if (el2.__uiDrill !== token)
        return view;
      const res = (cfg.map || defaultMap)(json) || {};
      res.json = json;
      accept(res);
      return view;
    }).catch((e) => {
      if (el2.__uiDrill !== token)
        return view;
      console.error("UI.drill: не удалось загрузить", e);
      el2.innerHTML = noteHtml(cfg.error || "Не удалось загрузить данные.");
      return view;
    });
  }
  accept({ rows: cfg.rows || [] });
  return Promise.resolve(view);
}
function createOpener(getDialog, getDoc) {
  let current = null;
  function close() {
    const c = current;
    current = null;
    if (c)
      c.handle.close();
  }
  function open(cfg = {}) {
    close();
    const doc = getDoc();
    const wantSub = !!(cfg.subtitle || cfg.fetch);
    let subEl = null;
    if (wantSub) {
      subEl = doc.createElement("span");
      subEl.textContent = cfg.subtitle || "загружаю…";
    }
    const mine = {};
    const handle = getDialog().open({
      title: cfg.title || "Детали",
      subtitle: subEl || undefined,
      head: cfg.head,
      size: "xl",
      onClose: () => {
        if (current === mine)
          current = null;
        if (typeof cfg.onClose === "function")
          cfg.onClose();
      }
    });
    mine.handle = handle;
    current = mine;
    const inner = Object.assign({}, cfg, {
      onLoad(res) {
        if (res.subtitle != null && subEl)
          subEl.textContent = res.subtitle;
        if (cfg.onLoad)
          cfg.onLoad(res);
      }
    });
    return mount5(handle.body, inner).then((view) => {
      view.dialog = handle;
      return view;
    });
  }
  return { open, close, isOpen: () => current != null };
}

// src/stat/stat.core.js
var exports_stat_core = {};
__export(exports_stat_core, {
  sparkTipModel: () => sparkTipModel,
  sparkTicks: () => sparkTicks,
  sparkSvg: () => sparkSvg,
  sparkPath: () => sparkPath,
  sparkNearest: () => sparkNearest,
  sparkDir: () => sparkDir,
  nearestFinite: () => nearestFinite,
  fmtDelta: () => fmtDelta,
  fmt: () => fmt,
  deltaOf: () => deltaOf,
  TONES: () => TONES,
  FORMATS: () => FORMATS
});
var NBSP = " ";
function groupInt(n) {
  const s = String(Math.round(Math.abs(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}
function withSign(n, s) {
  return n < 0 ? "−" + s : s;
}
function dec(n, digits) {
  return n.toFixed(digits).replace(".", ",");
}
var FORMATS = {
  int: (v) => withSign(v, groupInt(v)),
  money: (v) => withSign(v, groupInt(v) + NBSP + "₽"),
  moneyShort: (v) => {
    const a = Math.abs(v);
    if (a >= 1e6)
      return withSign(v, dec(a / 1e6, a >= 1e7 ? 1 : 2) + NBSP + "млн" + NBSP + "₽");
    if (a >= 1e4)
      return withSign(v, groupInt(Math.round(a / 1000)) + NBSP + "тыс" + NBSP + "₽");
    return FORMATS.money(v);
  },
  pct: (v) => FORMATS.pctRaw(v * 100),
  pctRaw: (v) => {
    const a = Math.abs(v);
    return withSign(v, (Math.abs(a - Math.round(a)) < 0.05 ? String(Math.round(a)) : dec(a, 1)) + "%");
  },
  text: (v) => String(v)
};
function fmt(value, format = "int") {
  if (value == null || typeof value === "number" && !Number.isFinite(value))
    return "—";
  if (typeof format === "function")
    return format(value);
  const f = FORMATS[format] || FORMATS.text;
  if (f === FORMATS.text)
    return f(value);
  return f(typeof value === "number" ? value : Number(value));
}
function deltaOf(cur, prev, { lower = false } = {}) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0)
    return { pct: null, dir: "flat", good: null };
  const pct = (cur - prev) / Math.abs(prev) * 100;
  const dir = Math.abs(pct) < 0.05 ? "flat" : pct > 0 ? "up" : "down";
  const good = dir === "flat" ? null : dir === "up" !== lower;
  return { pct, dir, good };
}
function fmtDelta(d) {
  if (!d || d.pct == null)
    return "—";
  const a = Math.abs(d.pct);
  const n = a >= 100 ? String(Math.round(a)) : dec(a, 1).replace(/,0$/, "");
  return (d.dir === "up" ? "↑ " : d.dir === "down" ? "↓ " : "") + n + "%";
}
function monotoneSlopes(pts) {
  const n = pts.length, d = [], m = new Array(n).fill(0);
  for (let i = 0;i < n - 1; i++)
    d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1;i < n - 1; i++)
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0;i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i], q = a * a + b * b;
    if (q > 9) {
      const t = 3 / Math.sqrt(q);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return m;
}
var r2 = (x) => +x.toFixed(2);
function sparkPath(values, { w = 240, h = 32, pad = 4, padR = 0, smooth = true, indexed = false } = {}) {
  const all = (values || []).map((x) => x == null || x === "" ? NaN : Number(x));
  const idx = [];
  all.forEach((x, i) => {
    if (Number.isFinite(x))
      idx.push(i);
  });
  const v = idx.map((i) => all[i]);
  if (v.length < 2)
    return null;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const iw = Math.max(1, w - padR);
  const pts = v.map((y, k) => [
    r2((indexed ? idx[k] / (all.length - 1) : k / (v.length - 1)) * iw),
    r2(h - pad - (y - lo) / span * (h - 2 * pad))
  ]);
  let line;
  if (smooth && pts.length > 2) {
    const m = monotoneSlopes(pts);
    line = "M" + pts[0][0] + " " + pts[0][1];
    for (let i = 0;i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = (x1 - x0) / 3;
      line += ` C${r2(x0 + dx)} ${r2(y0 + m[i] * dx)} ${r2(x1 - dx)} ${r2(y1 - m[i + 1] * dx)} ${x1} ${y1}`;
    }
  } else {
    line = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
  }
  const last = { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
  return { line, area: `${line} L${last.x} ${h} L${indexed ? pts[0][0] : 0} ${h} Z`, last, dir: sparkDir(v), pts, idx };
}
function sparkDir(values) {
  const v = (values || []).map(Number).filter(Number.isFinite);
  if (v.length < 2)
    return null;
  const d = v[v.length - 1] - v[0];
  return Math.abs(d) < 0.000000001 ? "flat" : d > 0 ? "up" : "down";
}
function sparkSvg(values, { w = 240, h = 32, r = 3, stroke = 2, id = "ui-spark-g", cls = "", smooth = true, indexed = false } = {}) {
  const p = sparkPath(values, { w, h, pad: r + stroke / 2, padR: r, smooth, indexed });
  if (!p)
    return "";
  return `<svg class="ui-spark${cls ? " " + cls : ""} is-${p.dir}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">` + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".32"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>` + `<path d="${p.area}" fill="url(#${id})"/>` + `<path d="${p.line}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>` + `<circle cx="${p.last.x}" cy="${p.last.y}" r="${r}" fill="currentColor"/></svg>`;
}
function sparkTicks(n, w, { padR = 3, minGap = 26 } = {}) {
  if (!(n >= 1))
    return [];
  const iw = Math.max(1, w - padR), gap = n > 1 ? iw / (n - 1) : iw;
  const step = Math.max(1, Math.ceil(minGap / gap));
  const out = [];
  for (let i = n - 1;i >= 0; i -= step)
    out.push({ i, x: r2(n > 1 ? i / (n - 1) * iw : 0), last: i === n - 1 });
  return out.reverse();
}
function nearestFinite(i, finite) {
  let best = -1;
  for (const j of finite)
    if (best < 0 || Math.abs(j - i) < Math.abs(best - i))
      best = j;
  return best;
}
function sparkNearest(x, n, w, { padR = 3 } = {}) {
  if (!(n >= 1))
    return -1;
  if (n === 1)
    return 0;
  const iw = Math.max(1, w - padR);
  return Math.min(n - 1, Math.max(0, Math.round(x / iw * (n - 1))));
}
function sparkTipModel(i, values, labels, tip) {
  if (typeof tip === "function") {
    const t = tip(i);
    if (t === null)
      return null;
    if (typeof t === "string" || typeof t === "number")
      return t === "" ? null : { title: String(t), rows: [] };
    if (t && typeof t === "object")
      return { title: t.title == null ? "" : String(t.title), rows: Array.isArray(t.rows) ? t.rows : [] };
  }
  const v = values[i];
  if (v == null)
    return null;
  return { title: labels && labels[i] != null ? String(labels[i]) : "", rows: [{ label: "Значение", value: String(v).replace(".", ",") }] };
}
var TONES = ["accent", "blue", "violet", "green", "warn", "danger"];

// src/tip/tip.core.js
var exports_tip_core = {};
__export(exports_tip_core, {
  translate: () => translate,
  place: () => place,
  model: () => model,
  PAD: () => PAD,
  GAP: () => GAP
});
var GAP = 14;
var PAD = 4;
var finite = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
function place({ hostW, hostH, x, y, w = 0, h = 0, gap = GAP, pad = PAD }) {
  let left = x + gap;
  if (finite(hostW)) {
    if (left + w > hostW - pad)
      left = x - gap - w;
    left = Math.min(Math.max(left, pad), Math.max(pad, hostW - w - pad));
  }
  let top = y - gap - h;
  if (finite(hostH)) {
    if (top < pad)
      top = y + gap;
    top = Math.min(Math.max(top, pad), Math.max(pad, hostH - h - pad));
  }
  return { left, top };
}
var translate = (x, y) => `translate3d(${x}px, ${y}px, 0)`;
function model(spec) {
  const s = spec || {};
  const rows = [];
  for (const r of s.rows || []) {
    if (!r || r.value == null)
      continue;
    rows.push({ label: r.label == null ? "" : String(r.label), value: String(r.value), color: r.color || "", cls: r.cls || "" });
  }
  return { title: s.title == null ? "" : String(s.title), rows };
}

// src/tip/tip.mount.js
function glide(node, x, y) {
  const was = node.classList.contains("is-on");
  if (!was)
    node.classList.add("is-snap");
  node.style.transform = translate(x, y);
  if (!was) {
    node.offsetWidth;
    node.classList.remove("is-snap");
    node.classList.add("is-on");
  }
}
function unglide(node) {
  node.classList.remove("is-on");
}
function create(host, opts = {}) {
  const doc = host.ownerDocument || document;
  const el2 = doc.createElement("div");
  el2.className = "ui-tip ui-chart-tip ui-glass";
  el2.setAttribute("role", "status");
  host.appendChild(el2);
  let sig = "";
  function fill(m) {
    const key = JSON.stringify(m);
    if (key === sig)
      return;
    sig = key;
    while (el2.firstChild)
      el2.removeChild(el2.firstChild);
    if (m.title) {
      const t = doc.createElement("div");
      t.className = "ui-tip__d";
      t.textContent = m.title;
      el2.appendChild(t);
    }
    for (const r of m.rows) {
      const line = doc.createElement("div");
      line.className = "ui-tip__l" + (r.cls ? " " + r.cls : "");
      const left = doc.createElement("span");
      if (r.color) {
        const dot = doc.createElement("i");
        dot.style.background = r.color;
        left.appendChild(dot);
      }
      left.appendChild(doc.createTextNode(r.label));
      const right = doc.createElement("b");
      right.textContent = r.value;
      line.appendChild(left);
      line.appendChild(right);
      el2.appendChild(line);
    }
  }
  return {
    el: el2,
    show(content, x, y, size) {
      fill(model(content));
      const s = size || {};
      const p = place({
        hostW: s.w != null ? s.w : host.clientWidth,
        hostH: opts.bounds === "x" ? undefined : s.h != null ? s.h : host.clientHeight,
        x,
        y,
        w: el2.offsetWidth || 0,
        h: el2.offsetHeight || 0
      });
      glide(el2, p.left, p.top);
    },
    hide() {
      unglide(el2);
    },
    destroy() {
      if (el2.parentNode)
        el2.parentNode.removeChild(el2);
    }
  };
}

// src/stat/stat.mount.js
var SPARK_W = 240;
var SPARK_H = 32;
var uid = 0;
function measure(node, fallbackH) {
  const w = node.clientWidth || node.getBoundingClientRect && node.getBoundingClientRect().width || 0;
  const h = node.clientHeight || node.getBoundingClientRect && node.getBoundingClientRect().height || 0;
  return { w: Math.round(w) || SPARK_W, h: Math.round(h) || fallbackH };
}
function spark(host, values, opts = {}) {
  const id = "ui-spark-g" + ++uid;
  const r = opts.r == null ? 3 : opts.r, stroke = opts.stroke == null ? 2 : opts.stroke;
  let cur = values, labs = opts.labels || null, drawn = { w: 0, h: 0 }, dir = null;
  let key = "", plot = null, line = null, ticks = null, dot = null, cross = null, tip = null, geo = null;
  const doc = host.ownerDocument;
  function build(withTicks) {
    host.replaceChildren();
    plot = el2(doc, "div", "ui-spark__plot");
    if (opts.h)
      plot.style.height = opts.h + "px";
    line = el2(doc, "div", "ui-spark__line");
    cross = el2(doc, "span", "ui-spark__cross");
    dot = el2(doc, "span", "ui-spark__dot");
    plot.append(line, cross, dot);
    host.appendChild(plot);
    tip = create(plot, { bounds: "x" });
    ticks = null;
    if (withTicks) {
      ticks = el2(doc, "div", "ui-spark__ticks");
      host.appendChild(ticks);
    }
    const move = (e) => {
      if (!geo)
        return;
      const box = plot.getBoundingClientRect ? plot.getBoundingClientRect() : { left: 0 };
      const i = nearestFinite(sparkNearest(e.clientX - box.left, cur.length, drawn.w, { padR: r }), geo.idx);
      const model2 = sparkTipModel(i, cur, labs, opts.tip);
      const [x, y] = geo.pts[geo.idx.indexOf(i)];
      glide(cross, x, 0);
      glide(dot, x, y);
      if (model2)
        tip.show(model2, x, y, { w: drawn.w });
      else
        tip.hide();
    };
    const leave = () => {
      unglide(dot);
      unglide(cross);
      tip.hide();
    };
    plot.addEventListener("pointermove", move);
    plot.addEventListener("pointerdown", move);
    plot.addEventListener("pointerleave", leave);
    plot.addEventListener("pointercancel", leave);
  }
  function redraw(force) {
    dir = sparkDir(cur);
    const inter = !!(labs || opts.tip) && dir != null;
    if (!inter) {
      key = "";
      plot = null;
      const m2 = measure(host, opts.h || SPARK_H);
      if (opts.h)
        m2.h = opts.h;
      if (!force && m2.w === drawn.w && m2.h === drawn.h)
        return;
      drawn = m2;
      host.innerHTML = sparkSvg(cur, { w: m2.w, h: m2.h, r: opts.r, stroke: opts.stroke, smooth: opts.smooth, id, cls: opts.cls });
      return;
    }
    const withTicks = !!labs, k = withTicks ? "t" : "i";
    if (k !== key) {
      key = k;
      build(withTicks);
      force = true;
    }
    const m = { w: measure(host, 0).w, h: opts.h || Math.round(plot.clientHeight || 0) || SPARK_H };
    if (!force && m.w === drawn.w && m.h === drawn.h)
      return;
    drawn = m;
    line.innerHTML = sparkSvg(cur, { w: m.w, h: m.h, r: opts.r, stroke: opts.stroke, smooth: opts.smooth, id, cls: opts.cls, indexed: true });
    geo = sparkPath(cur, { w: m.w, h: m.h, pad: r + stroke / 2, padR: r, smooth: opts.smooth !== false, indexed: true });
    if (ticks) {
      ticks.replaceChildren();
      for (const t of sparkTicks(cur.length, m.w, { padR: r })) {
        const sp = el2(doc, "span", "ui-spark__tick" + (t.last ? " is-last" : ""), labs[t.i] == null ? "" : String(labs[t.i]));
        sp.style.left = t.x + "px";
        ticks.appendChild(sp);
      }
    }
  }
  redraw(true);
  let ro = null;
  if (typeof ResizeObserver === "function") {
    ro = new ResizeObserver(() => redraw(false));
    ro.observe(host);
  }
  return {
    get dir() {
      return dir;
    },
    set(v, l) {
      cur = v;
      if (arguments.length > 1)
        labs = l || null;
      redraw(true);
    },
    redraw: () => redraw(true),
    destroy() {
      if (ro)
        ro.disconnect();
      ro = null;
    }
  };
}
function el2(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls)
    n.className = cls;
  if (text != null)
    n.textContent = text;
  return n;
}
function mount6(host, cfg = {}) {
  const doc = host.ownerDocument;
  const state2 = { ...cfg };
  const tone = TONES.includes(cfg.tone) ? cfg.tone : "accent";
  const card = el2(doc, "div", `ui-stat ${cfg.layer === 2 ? "ui-glass2" : "ui-glass"} ui-stat--${tone}`);
  if (cfg.onClick) {
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.addEventListener("click", (e) => cfg.onClick(e));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault && e.preventDefault();
        cfg.onClick(e);
      }
    });
  }
  const label = el2(doc, "div", "ui-stat__label");
  label.appendChild(el2(doc, "span", "ui-stat__name", cfg.label || ""));
  if (cfg.tag)
    label.appendChild(el2(doc, "span", "ui-stat__tag", cfg.tag));
  if (cfg.info != null) {
    const b = el2(doc, "button", "ui-stat__info", "?");
    b.type = "button";
    b.setAttribute("aria-label", "Как считается");
    b.addEventListener("click", (e) => {
      e.stopPropagation && e.stopPropagation();
      cfg.onInfo && cfg.onInfo(b, cfg.info);
    });
    label.appendChild(b);
  }
  card.appendChild(label);
  if (cfg.icon && /^[a-z0-9-]+$/.test(cfg.icon)) {
    const ic = el2(doc, "div", "ui-stat__icon");
    ic.innerHTML = icon(cfg.icon, { size: 18 });
    card.appendChild(ic);
  }
  const value = el2(doc, "div", "ui-stat__value");
  if (typeof cfg.format === "string")
    value.setAttribute("data-fmt", cfg.format);
  if (cfg.numKey)
    value.setAttribute("data-key", cfg.numKey);
  card.appendChild(value);
  const row = el2(doc, "div", "ui-stat__row");
  const delta = el2(doc, "span", "ui-stat__delta");
  const hint = el2(doc, "span", "ui-stat__hint");
  row.append(delta, hint);
  card.appendChild(row);
  const sparkBox = el2(doc, "div", "ui-stat__spark");
  card.appendChild(sparkBox);
  host.appendChild(card);
  const sp = spark(sparkBox, state2.spark, {
    cls: "ui-stat__svg",
    labels: state2.sparkLabels,
    tip: cfg.sparkTip ? (i) => state2.sparkTip ? state2.sparkTip(i) : undefined : undefined
  });
  function render2() {
    value.textContent = fmt(state2.value, state2.format);
    if (typeof state2.value === "number")
      value.setAttribute("data-num", String(state2.value));
    const d = deltaOf(state2.value, state2.prev, { lower: !!state2.lower });
    delta.textContent = fmtDelta(d);
    delta.className = "ui-stat__delta" + (d.pct == null ? " is-none" : ` is-${d.dir}` + (d.good === true ? " is-good" : d.good === false ? " is-bad" : ""));
    hint.textContent = state2.hint || "";
    sp.set(state2.spark, state2.sparkLabels);
    sparkBox.className = "ui-stat__spark" + (sp.dir ? "" : " is-empty") + (state2.sparkLabels && sp.dir ? " has-ticks" : "");
  }
  render2();
  return {
    el: card,
    set(patch = {}) {
      Object.assign(state2, patch);
      render2();
    }
  };
}

// src/chart/chart.core.js
var exports_chart_core = {};
__export(exports_chart_core, {
  weekends: () => weekends,
  tipRows: () => tipRows,
  tipPlace: () => tipPlace,
  rgba: () => rgba,
  progressiveStep: () => progressiveStep,
  progressive: () => progressive,
  presets: () => presets,
  overlayBarsTip: () => overlayBarsTip,
  overlayBarsConfig: () => overlayBarsConfig,
  headModel: () => headModel,
  gridColor: () => gridColor,
  fmtNum: () => fmtNum,
  fill: () => fill,
  easeOut: () => easeOut,
  draw: () => draw,
  donutTip: () => donutTip,
  donutConfig: () => donutConfig,
  deltaView: () => deltaView,
  crosshairPlugin: () => crosshairPlugin,
  countStep: () => countStep,
  centerTextPlugin: () => centerTextPlugin,
  calloutPlace: () => calloutPlace,
  calloutModel: () => calloutModel,
  calloutIndex: () => calloutIndex,
  base: () => base,
  bandsPlugin: () => bandsPlugin,
  animation: () => animation,
  DEFAULT_FONTS: () => DEFAULT_FONTS,
  DEFAULT_COLORS: () => DEFAULT_COLORS
});
var DEFAULT_COLORS = {
  accent: "#7da0f0",
  blue: "#7da0f0",
  violet: "#a78bfa",
  green: "#5cc98f",
  yellow: "#e0b052",
  red: "#ef7a6c",
  text: "#ecebe7",
  muted: "#9c9a94",
  bg: "#121212"
};
var DEFAULT_FONTS = { num: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", body: "system-ui, sans-serif" };
function rgba(color, a) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m)
    return color;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`;
}
var gridColor = (text) => rgba(text, 0.06);
var withDefaults = (o = {}) => ({ colors: { ...DEFAULT_COLORS, ...o.colors || {} }, fonts: { ...DEFAULT_FONTS, ...o.fonts || {} } });
function fill(color, top = 0.3) {
  let cache = null, key = null;
  return (context) => {
    const chart = context.chart, area = chart.chartArea;
    if (!area)
      return rgba(color, top);
    const k = area.top + ":" + area.bottom;
    if (cache && key === k)
      return cache;
    const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, rgba(color, top));
    g.addColorStop(1, rgba(color, 0));
    cache = g;
    key = k;
    return g;
  };
}
var progressiveStep = (n) => Math.max(6, Math.min(40, Math.round(900 / Math.max(1, n))));
function progressive(n) {
  const per = progressiveStep(n);
  const delay = (flag) => (ctx) => {
    if (ctx.type !== "data" || ctx[flag])
      return 0;
    ctx[flag] = true;
    return ctx.index * per;
  };
  return {
    x: { type: "number", easing: "linear", duration: per, from: NaN, delay: delay("xStarted") },
    y: {
      type: "number",
      easing: "linear",
      duration: per,
      delay: delay("yStarted"),
      from: (ctx) => ctx.index === 0 ? ctx.chart.scales.y.getPixelForValue(0) : ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1].getProps(["y"], true).y
    }
  };
}
function animation({ first = false, progressive: prog = false, points = 31, reduced = false } = {}) {
  if (reduced)
    return false;
  if (first)
    return prog ? progressive(points) : { duration: 900, easing: "easeOutQuart" };
  return { duration: 400, easing: "easeOutQuart" };
}
function base(opts = {}) {
  const { colors: C, fonts: F } = withDefaults(opts);
  const grid = gridColor(C.text);
  const fmtY = opts.fmtY || ((v) => v);
  const tick = { color: C.muted, font: { family: F.num, size: 10 }, padding: 6 };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: animation({ first: opts.first, progressive: opts.progressive, points: opts.points, reduced: opts.reduced }),
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: 8, right: 8, bottom: 0, left: 0 } },
    onClick(e, els, chart) {
      if (!opts.onClick)
        return;
      const pts = chart.getElementsAtEventForMode(e, "index", { intersect: false }, true);
      if (pts.length)
        opts.onClick(pts[0].index);
    },
    onHover(e, els, chart) {
      if (opts.onClick)
        chart.canvas.style.cursor = els.length ? "pointer" : "default";
    },
    plugins: {
      legend: { display: false },
      tooltip: opts.external ? { enabled: false, external: opts.external } : { enabled: false },
      ...opts.crosshair ? { uiCrosshair: { enabled: true, color: opts.crosshair === true ? rgba(C.text, 0.22) : opts.crosshair } } : {},
      ...opts.callout ? { uiCallout: { enabled: true, color: C.accent, bg: C.bg, ...opts.callout } } : {},
      ...opts.bands ? { uiBands: { enabled: true, runs: opts.bands, color: rgba(C.accent, 0.08) } } : {}
    },
    scales: {
      x: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { ...tick, maxRotation: 0, autoSkip: true, maxTicksLimit: opts.xMax || 8 } },
      y: { beginAtZero: true, grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { ...tick, maxTicksLimit: 5, callback: (v) => fmtY(v) } }
    }
  };
}
var presets = {
  line: (color, { top = 0.38, points = false, bg = DEFAULT_COLORS.bg } = {}) => ({
    borderColor: color,
    borderWidth: 2.2,
    pointRadius: points ? 3.5 : 0,
    pointHoverRadius: points ? 6 : 5,
    pointHoverBackgroundColor: color,
    tension: 0.3,
    fill: true,
    backgroundColor: fill(color, top),
    order: 1,
    ...points ? { pointBackgroundColor: bg, pointBorderColor: color, pointBorderWidth: 2, pointHoverBorderColor: rgba(color, 0.3), pointHoverBorderWidth: 5 } : {}
  }),
  points: (color, o = {}) => presets.line(color, { ...o, points: true }),
  forecast: (color) => ({ borderColor: rgba(color, 0.55), borderDash: [3, 5], borderWidth: 2, pointRadius: 0, tension: 0, fill: true, backgroundColor: fill(color, 0.12), order: 2 }),
  plan: (color) => ({ borderColor: color, borderDash: [6, 6], borderWidth: 1.5, pointRadius: 0, order: 3 }),
  norm: (color) => ({ type: "line", borderColor: color, borderDash: [4, 3], borderWidth: 1.5, pointRadius: 0, order: 1 }),
  bars: (color) => ({ backgroundColor: rgba(color, 0.85), borderRadius: 3, order: 2 })
};
function centerTextPlugin(fonts) {
  const F = { ...DEFAULT_FONTS, ...fonts || {} };
  return {
    id: "uiCenterText",
    afterDraw(chart) {
      const o = chart.options.plugins && chart.options.plugins.uiCenterText;
      if (!o || !chart.chartArea)
        return;
      const { ctx, chartArea: a } = chart, cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = o.color;
      ctx.font = "800 24px " + F.num;
      ctx.fillText(String(o.value), cx, cy - 7);
      ctx.fillStyle = o.muted;
      ctx.font = "500 10px " + F.body;
      ctx.fillText(String(o.label || ""), cx, cy + 13);
      ctx.restore();
    }
  };
}
var tipRows = (dataPoints) => dataPoints.map((p) => ({ label: p.dataset.label, value: p.formattedValue, color: p.dataset.borderColor || p.dataset.backgroundColor }));
function donutTip(items, unit = "") {
  return {
    title: (i) => items[i] ? items[i].label : "",
    rows: (i) => items[i] ? [{ label: unit, value: String(items[i].value), color: items[i].color }] : []
  };
}
function tipPlace({ width, height, caretX, caretY, tipW, tipH }) {
  return place({ hostW: width, hostH: height, x: caretX, y: caretY, w: tipW, h: tipH });
}
function donutConfig(spec = {}) {
  const { colors: C, fonts: F } = withDefaults(spec);
  const items = spec.items || [];
  return {
    type: "doughnut",
    data: {
      labels: items.map((i) => i.label),
      datasets: [{ data: items.map((i) => i.value), backgroundColor: items.map((i) => i.color), borderWidth: 0, spacing: 2, hoverOffset: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      animation: spec.reduced ? false : { animateRotate: true, duration: spec.first ? 900 : 400, easing: "easeOutQuart" },
      onClick() {
        if (spec.onClick)
          spec.onClick();
      },
      onHover(e, els, chart) {
        if (spec.onClick)
          chart.canvas.style.cursor = els.length ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: spec.external ? { enabled: false, external: spec.external } : { enabled: false },
        uiCenterText: { value: spec.total != null ? spec.total : items.reduce((s, i) => s + (i.value || 0), 0), label: spec.centerLabel || "", color: C.text, muted: C.muted }
      }
    },
    plugins: [centerTextPlugin(F)]
  };
}
function overlayBarsConfig(spec = {}) {
  const tot = spec.total || { data: [] }, part = spec.part || { data: [] };
  const fmt2 = spec.fmt || ((v) => v);
  const cfg = {
    type: "bar",
    data: {
      labels: spec.labels || [],
      datasets: [
        { label: tot.label, data: tot.data, backgroundColor: rgba(tot.color, 0.32), borderRadius: 2, grouped: false, barPercentage: 0.9, categoryPercentage: 0.9, order: 2 },
        { label: part.label, data: part.data, backgroundColor: rgba(part.color, 0.95), borderRadius: 2, grouped: false, barPercentage: 0.55, categoryPercentage: 0.9, order: 1 }
      ]
    },
    options: base({ colors: spec.colors, fonts: spec.fonts, reduced: spec.reduced, fmtY: fmt2, first: spec.first, xMax: 7, onClick: spec.onClick, external: spec.external })
  };
  cfg.options.scales.y.ticks.maxTicksLimit = 4;
  return cfg;
}
function overlayBarsTip(spec) {
  const fmt2 = spec.fmt || ((v) => v);
  return {
    title: spec.title,
    rows: (i) => [{ label: spec.total.label, value: fmt2(spec.total.data[i]), color: spec.total.color }, { label: spec.part.label, value: fmt2(spec.part.data[i]), color: spec.part.color }]
  };
}
function draw(Chart, prev, canvas, cfg) {
  if (!canvas || !Chart)
    return prev || null;
  if (prev && prev.config && prev.config.type === cfg.type && prev.canvas === canvas) {
    prev.data = cfg.data;
    prev.options = cfg.options;
    prev.update();
    return prev;
  }
  if (prev && prev.destroy)
    prev.destroy();
  return new Chart(canvas, cfg);
}
var NBSP2 = " ";
function crosshairPlugin() {
  return {
    id: "uiCrosshair",
    afterDraw(chart) {
      const o = chart.options && chart.options.plugins && chart.options.plugins.uiCrosshair;
      if (!o || o.enabled !== true || !chart.chartArea)
        return;
      const act = chart.getActiveElements ? chart.getActiveElements() : [];
      if (!act.length || !act[0].element)
        return;
      const x = act[0].element.x, a = chart.chartArea, ctx = chart.ctx;
      if (!Number.isFinite(x))
        return;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, a.top);
      ctx.lineTo(x, a.bottom);
      ctx.lineWidth = o.width || 1;
      ctx.strokeStyle = o.color || rgba(DEFAULT_COLORS.text, 0.22);
      ctx.stroke();
      ctx.restore();
    }
  };
}
function weekends(dates = []) {
  const runs = [];
  dates.forEach((d, i) => {
    const t = Date.parse(String(d).slice(0, 10) + "T00:00:00Z");
    if (!Number.isFinite(t))
      return;
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6)
      return;
    const last = runs[runs.length - 1];
    if (last && last[1] === i - 1)
      last[1] = i;
    else
      runs.push([i, i]);
  });
  return runs;
}
function bandsPlugin() {
  return {
    id: "uiBands",
    beforeDatasetsDraw(chart) {
      const o = chart.options && chart.options.plugins && chart.options.plugins.uiBands;
      const sc = chart.scales && chart.scales.x, a = chart.chartArea;
      if (!o || o.enabled !== true || !sc || !a || !o.runs || !o.runs.length)
        return;
      const n = chart.data && chart.data.labels && chart.data.labels.length || 0;
      const step = n > 1 ? Math.abs(sc.getPixelForValue(1) - sc.getPixelForValue(0)) : a.right - a.left;
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = o.color || rgba(DEFAULT_COLORS.accent, 0.08);
      for (const [from, to] of o.runs) {
        const l = Math.max(a.left, sc.getPixelForValue(from) - step / 2), r = Math.min(a.right, sc.getPixelForValue(to) + step / 2);
        if (Number.isFinite(l) && Number.isFinite(r) && r > l)
          ctx.fillRect(l, a.top, r - l, a.bottom - a.top);
      }
      ctx.restore();
    }
  };
}
function fmtNum(v) {
  if (v == null || typeof v === "number" && !Number.isFinite(v))
    return "—";
  if (typeof v !== "number")
    return String(v);
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  const body = a >= 100 || Number.isInteger(a) ? String(Math.round(a)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP2) : a.toFixed(2).replace(".", ",").replace(/,?0+$/, "");
  return sign + body;
}
function deltaView(delta, { tone, lower = false } = {}) {
  if (delta == null)
    return null;
  let d;
  if (typeof delta === "object" && delta.abs != null) {
    const v = Number(delta.abs);
    if (!Number.isFinite(v))
      return null;
    const lw = delta.lower != null ? !!delta.lower : lower;
    const dir = v === 0 ? "flat" : v > 0 ? "up" : "down";
    const t2 = ["up", "down", "flat"].includes(tone) ? tone : dir === "flat" ? "flat" : dir === "up" !== lw ? "up" : "down";
    const body = fmtNum(Math.abs(v)).replace(/^−/, "") + (delta.unit ? " " + delta.unit : "");
    return { text: body, sign: dir === "up" ? "+" : dir === "down" ? "−" : "", dir, tone: t2, icon: dir === "up" ? "arrow-up" : dir === "down" ? "arrow-down" : "minus" };
  }
  if (typeof delta === "object")
    d = deltaOf(delta.cur, delta.prev, { lower: delta.lower != null ? !!delta.lower : lower });
  else {
    const pct = Number(delta);
    if (!Number.isFinite(pct))
      return null;
    const dir0 = Math.abs(pct) < 0.05 ? "flat" : pct > 0 ? "up" : "down";
    d = { pct, dir: dir0, good: dir0 === "flat" ? null : dir0 === "up" !== lower };
  }
  if (d.pct == null)
    return null;
  const t = ["up", "down", "flat"].includes(tone) ? tone : d.good === true ? "up" : d.good === false ? "down" : "flat";
  return { text: fmtDelta({ pct: Math.abs(d.pct), dir: "flat" }), sign: d.dir === "up" ? "+" : d.dir === "down" ? "−" : "", dir: d.dir, tone: t, icon: d.dir === "up" ? "arrow-up" : d.dir === "down" ? "arrow-down" : "minus" };
}
function calloutPlace({ width, height, x, y, w, h, gap = 12 }) {
  let left = x + gap, top = y - h - gap, flipX = false, flipY = false;
  if (left + w > width) {
    left = x - w - gap;
    flipX = true;
  }
  if (top < 0) {
    top = y + gap;
    flipY = true;
  }
  left = Math.max(0, Math.min(left, Math.max(0, width - w)));
  top = Math.max(0, Math.min(top, Math.max(0, height - h)));
  return { left, top, flipX, flipY };
}
function calloutIndex(index, data) {
  const arr = data || [];
  if (typeof index === "number")
    return index >= 0 && index < arr.length ? index : -1;
  for (let i = arr.length - 1;i >= 0; i--)
    if (arr[i] != null && arr[i] !== "" && !(typeof arr[i] === "number" && Number.isNaN(arr[i])))
      return i;
  return -1;
}
function calloutModel(spec = {}) {
  return { key: spec.key == null ? "" : String(spec.key), value: fmtNum(spec.value), unit: spec.unit == null ? "" : String(spec.unit), delta: deltaView(spec.delta, { tone: spec.tone, lower: spec.lower }) };
}
function headModel(spec = {}) {
  return { title: spec.title == null ? "" : String(spec.title), sub: spec.sub == null ? "" : String(spec.sub), deltaLabel: spec.deltaLabel == null ? "" : String(spec.deltaLabel), ...calloutModel(spec) };
}
var easeOut = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
var countStep = (from, to, p) => p >= 1 ? to : from + (to - from) * easeOut(p);

// src/chart/chart.mount.js
function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}
function colors() {
  const D = DEFAULT_COLORS;
  return {
    accent: cssVar("--ui-accent", D.accent),
    blue: cssVar("--ui-link", D.blue),
    violet: cssVar("--ui-violet", D.violet),
    green: cssVar("--ui-success", D.green),
    yellow: cssVar("--ui-warning", D.yellow),
    red: cssVar("--ui-danger", D.red),
    text: cssVar("--ui-text", D.text),
    muted: cssVar("--ui-muted", D.muted),
    bg: cssVar("--ui-bg", D.bg)
  };
}
function fonts() {
  return { num: cssVar("--ui-font-num", DEFAULT_FONTS.num), body: cssVar("--ui-font", DEFAULT_FONTS.body) };
}
function reduced() {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    return false;
  }
}
var chartLib = (opts) => opts && opts.Chart || (typeof globalThis !== "undefined" ? globalThis.Chart : undefined);
var tips = new WeakMap;
function tipFor(chart) {
  const host = chart.canvas.parentNode;
  let t = tips.get(host);
  if (!t || t.el.parentNode !== host) {
    t = create(host);
    tips.set(host, t);
  }
  return t;
}
function tooltip(spec) {
  return (context) => {
    const { chart, tooltip: tt } = context, tip = tipFor(chart);
    if (!tt || tt.opacity === 0 || !tt.dataPoints || !tt.dataPoints.length) {
      tip.hide();
      return;
    }
    const i = tt.dataPoints[0].dataIndex;
    const rows = spec && spec.rows ? spec.rows(i, tt.dataPoints) : tipRows(tt.dataPoints);
    const title = spec && spec.title ? spec.title(i) : (tt.title || []).join(" ");
    tip.show({ title, rows }, tt.caretX, tt.caretY, { w: chart.width, h: chart.height });
  };
}
function base2(opts = {}) {
  const external = typeof opts.tooltip === "function" ? opts.tooltip : tooltip(opts.tooltip);
  return base({ ...opts, colors: colors(), fonts: fonts(), reduced: reduced(), external });
}
function withPlugins(cfg) {
  const o = cfg && cfg.options && cfg.options.plugins || {};
  const have = (cfg.plugins || []).map((p) => p && p.id);
  const add = [];
  if (o.uiCrosshair && !have.includes("uiCrosshair"))
    add.push(crosshairPlugin());
  if (o.uiCallout && !have.includes("uiCallout"))
    add.push(calloutPlugin);
  if (o.uiBands && !have.includes("uiBands"))
    add.push(bandsPlugin());
  if (add.length)
    cfg.plugins = [...cfg.plugins || [], ...add];
  return cfg;
}
var draw2 = (prev, canvas, cfg, opts) => draw(chartLib(opts), prev, canvas, withPlugins(cfg));
function calloutEl(chart) {
  const host = chart.canvas.parentNode, doc = host.ownerDocument || document;
  let el3 = host.querySelector(".ui-chart-callout");
  if (!el3) {
    el3 = doc.createElement("div");
    el3.className = "ui-chart-callout ui-glass";
    el3.setAttribute("role", "status");
    host.appendChild(el3);
  }
  return el3;
}
function fillCallout(el3, m) {
  const doc = el3.ownerDocument || document;
  const sig = JSON.stringify(m);
  if (el3._sig === sig)
    return;
  el3._sig = sig;
  while (el3.firstChild)
    el3.removeChild(el3.firstChild);
  const k = doc.createElement("div");
  k.className = "ui-chart-callout__k";
  k.textContent = m.key;
  el3.appendChild(k);
  const v = doc.createElement("div");
  v.className = "ui-chart-callout__v";
  const b = doc.createElement("b");
  b.textContent = m.value;
  v.appendChild(b);
  if (m.unit) {
    const u = doc.createElement("span");
    u.textContent = m.unit;
    v.appendChild(u);
  }
  el3.appendChild(v);
  if (m.delta) {
    const d = doc.createElement("div");
    d.className = "ui-chart-callout__d is-" + m.delta.tone;
    const ic = doc.createElement("i");
    ic.innerHTML = icon(m.delta.icon, { size: 12 });
    d.appendChild(ic);
    d.appendChild(doc.createTextNode(m.delta.sign + m.delta.text));
    el3.appendChild(d);
  }
}
var specs = new WeakMap;
var calloutPlugin = {
  id: "uiCallout",
  afterDatasetsDraw(chart) {
    const o = specs.has(chart) ? specs.get(chart) : chart.options && chart.options.plugins && chart.options.plugins.uiCallout;
    const el3 = chart.canvas && chart.canvas.parentNode && chart.canvas.parentNode.querySelector ? chart.canvas.parentNode.querySelector(".ui-chart-callout") : null;
    if (!o || o.enabled !== true && !specs.has(chart)) {
      if (el3)
        el3.style.opacity = "0";
      return;
    }
    const meta = chart.getDatasetMeta(o.dataset || 0), ds = chart.data.datasets[o.dataset || 0];
    const i = calloutIndex(o.index, ds && ds.data), pt = meta && meta.data[i];
    const box = calloutEl(chart);
    const p = pt && pt.getProps(["x", "y"], true);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !chart.chartArea) {
      box.style.opacity = "0";
      return;
    }
    const color = o.color || (ds && typeof ds.borderColor === "string" ? ds.borderColor : DEFAULT_COLORS.accent);
    const { chartArea: a, ctx } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, a.bottom);
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(color, 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 0.2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = o.bg || DEFAULT_COLORS.bg;
    ctx.stroke();
    ctx.restore();
    fillCallout(box, calloutModel(o));
    const hover = chart.getActiveElements && chart.getActiveElements().length || chart.tooltip && chart.tooltip.opacity > 0;
    const pos = calloutPlace({ width: chart.width, height: chart.height, x: p.x, y: p.y, w: box.offsetWidth || 0, h: box.offsetHeight || 0 });
    box.style.left = pos.left + "px";
    box.style.top = pos.top + "px";
    box.style.opacity = hover ? "0" : "1";
  },
  afterDestroy(chart) {
    const host = chart.canvas && chart.canvas.parentNode;
    const el3 = host && host.querySelector && host.querySelector(".ui-chart-callout");
    if (el3 && el3.parentNode)
      el3.parentNode.removeChild(el3);
  }
};
var registered = new WeakSet;
function callout(chart, spec = {}, opts) {
  const lib = chartLib(opts) || chart && chart.constructor;
  if (lib && lib.register && !registered.has(lib)) {
    registered.add(lib);
    lib.register(calloutPlugin);
  }
  const hasBox = () => {
    const h = chart.canvas && chart.canvas.parentNode;
    return !!(h && h.querySelector && h.querySelector(".ui-chart-callout"));
  };
  const apply = (next) => {
    specs.set(chart, next);
    chart.update("none");
    if (!hasBox())
      chart.update("none");
  };
  let cur = { color: colors().accent, bg: colors().bg, ...spec };
  apply(cur);
  return {
    update(patch = {}) {
      cur = { ...cur, ...patch };
      apply(cur);
    },
    destroy() {
      specs.delete(chart);
      chart.update("none");
      const host = chart.canvas && chart.canvas.parentNode, el3 = host && host.querySelector && host.querySelector(".ui-chart-callout");
      if (el3 && el3.parentNode)
        el3.parentNode.removeChild(el3);
    }
  };
}
function head(host, spec = {}) {
  const doc = host.ownerDocument || document;
  const state2 = { ...spec };
  const mk = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls)
      n.className = cls;
    if (text != null)
      n.textContent = text;
    return n;
  };
  const root = mk("div", "ui-chart-head");
  const top = mk("div", "ui-chart-head__top");
  const title = mk("div", "ui-chart-head__title"), sub = mk("div", "ui-chart-head__sub");
  top.append(title, sub);
  const main = mk("div", "ui-chart-head__main");
  const val = mk("span", "ui-chart-head__value"), unit = mk("span", "ui-chart-head__unit");
  const pill = mk("span", "ui-chart-head__delta ui-chip ui-chip--soft"), dlabel = mk("span", "ui-chart-head__dlabel");
  main.append(val, unit, pill, dlabel);
  root.append(top, main);
  host.appendChild(root);
  let shown = null, raf = 0;
  const fmt2 = (v) => typeof state2.format === "function" ? state2.format(v) : fmtNum(v);
  const cancel = () => {
    if (raf && typeof cancelAnimationFrame === "function")
      cancelAnimationFrame(raf);
    raf = 0;
  };
  function paintValue(v) {
    val.textContent = fmt2(v);
  }
  function render2(animate) {
    const m = headModel(state2);
    title.textContent = m.title;
    sub.textContent = m.sub;
    title.style.display = m.title ? "" : "none";
    sub.style.display = m.sub ? "" : "none";
    unit.textContent = m.unit;
    unit.style.display = m.unit ? "" : "none";
    dlabel.textContent = m.deltaLabel;
    dlabel.style.display = m.deltaLabel ? "" : "none";
    if (m.delta) {
      pill.className = "ui-chart-head__delta ui-chip ui-chip--soft " + (m.delta.tone === "up" ? "ui-chip--success" : m.delta.tone === "down" ? "ui-chip--danger" : "ui-chip--muted");
      while (pill.firstChild)
        pill.removeChild(pill.firstChild);
      const ic = mk("i");
      ic.innerHTML = icon(m.delta.icon, { size: 12 });
      pill.appendChild(ic);
      pill.appendChild(doc.createTextNode(m.delta.sign + m.delta.text));
      pill.style.display = "";
    } else
      pill.style.display = "none";
    cancel();
    const to = state2.value;
    if (animate && typeof to === "number" && typeof shown === "number" && shown !== to && !reduced() && typeof requestAnimationFrame === "function") {
      const from = shown, t0 = typeof performance !== "undefined" ? performance.now() : 0, dur = 600;
      const tick = (now) => {
        const p = (now - t0) / dur;
        shown = countStep(from, to, p);
        paintValue(shown);
        raf = p < 1 ? requestAnimationFrame(tick) : 0;
      };
      raf = requestAnimationFrame(tick);
    } else {
      shown = typeof to === "number" ? to : null;
      paintValue(to);
    }
  }
  render2(false);
  return { el: root, set(patch = {}) {
    Object.assign(state2, patch);
    render2(true);
  } };
}
function donut(prev, canvas, spec = {}, opts) {
  const items = spec.items || [];
  const cfg = donutConfig({ ...spec, colors: colors(), fonts: fonts(), reduced: reduced(), external: tooltip(donutTip(items, spec.unit || "")) });
  return draw2(prev, canvas, cfg, opts);
}
function overlayBars(prev, canvas, spec = {}, opts) {
  const cfg = overlayBarsConfig({ ...spec, colors: colors(), fonts: fonts(), reduced: reduced(), external: tooltip(overlayBarsTip(spec)) });
  return draw2(prev, canvas, cfg, opts);
}
var { fill: fill2, rgba: rgba2, presets: presets2, weekends: weekends2 } = exports_chart_core;

// src/skeleton/skeleton.core.js
var exports_skeleton_core = {};
__export(exports_skeleton_core, {
  shape: () => shape,
  KINDS: () => KINDS2
});
var pct = (n) => `${n}%`;
var KINDS2 = ["stat", "chart", "donut", "list", "table", "text"];
function shape(kind, opts = {}) {
  const rows = Math.max(1, Math.min(50, opts.rows || defaultRows(kind)));
  switch (kind) {
    case "stat":
      return [{ w: pct(45), h: 12 }, { w: pct(58), h: 28 }, { w: pct(70), h: 10 }, { w: pct(100), h: 30, gap: 6 }];
    case "chart":
      return [{ w: pct(35), h: 14 }, { w: pct(100), h: opts.height || 200 }, { w: pct(30), h: 10 }];
    case "donut":
      return [{ w: pct(50), h: 14 }, { w: 140, h: 140, r: "50%", side: Array.from({ length: 4 }, () => ({ w: pct(100), h: 10 })) }];
    case "list":
      return [{ w: pct(40), h: 14 }].concat(Array.from({ length: rows }, () => [{ w: pct(100), h: 10 }, { w: pct(100), h: 5 }]).flat());
    case "table": {
      const cols = Math.max(2, Math.min(12, opts.cols || 4));
      return [{ w: pct(40), h: 14 }].concat(Array.from({ length: rows }, () => ({ row: Array.from({ length: cols }, (_, i) => ({ w: i ? pct(100) : 120, h: 10 })) })));
    }
    case "text":
    default:
      return Array.from({ length: rows }, (_, i) => ({ w: pct(i === rows - 1 ? 60 : 100), h: 12 }));
  }
}
function defaultRows(kind) {
  return kind === "list" ? 4 : kind === "table" ? 5 : ["stat", "chart", "donut"].includes(kind) ? 1 : 3;
}

// src/skeleton/skeleton.mount.js
function block(doc, b) {
  const n = doc.createElement("div");
  n.className = "ui-skel";
  n.setAttribute("aria-hidden", "true");
  n.style.width = typeof b.w === "number" ? b.w + "px" : b.w;
  n.style.height = b.h + "px";
  if (b.r)
    n.style.borderRadius = b.r;
  if (b.gap)
    n.style.marginTop = b.gap + "px";
  return n;
}
function el3(kind, opts = {}, doc = globalThis.document) {
  const wrap = doc.createElement("div");
  wrap.className = `ui-skeleton ui-skeleton--${KINDS2.includes(kind) ? kind : "text"}`;
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-label", opts.label || "Загрузка");
  for (const b of shape(kind, opts)) {
    if (b.row) {
      const r = doc.createElement("div");
      r.className = "ui-skeleton__row";
      for (const c of b.row)
        r.appendChild(block(doc, c));
      wrap.appendChild(r);
    } else if (b.side) {
      const r = doc.createElement("div");
      r.className = "ui-skeleton__side";
      r.appendChild(block(doc, b));
      const col = doc.createElement("div");
      col.className = "ui-skeleton__col";
      for (const c of b.side)
        col.appendChild(block(doc, c));
      r.appendChild(col);
      wrap.appendChild(r);
    } else
      wrap.appendChild(block(doc, b));
  }
  return wrap;
}
function show(host, kind, opts = {}) {
  const doc = host.ownerDocument || globalThis.document;
  clear(host);
  const n = el3(kind, opts, doc);
  host.appendChild(n);
  host.setAttribute("aria-busy", "true");
  return n;
}
function clear(host) {
  if (typeof host.replaceChildren === "function")
    host.replaceChildren();
  else {
    while (host.firstChild)
      host.removeChild(host.firstChild);
  }
}
function swap(host, content, { enter = true } = {}) {
  clear(host);
  if (typeof content === "string")
    host.innerHTML = content;
  else if (Array.isArray(content))
    for (const c of content)
      host.appendChild(c);
  else if (content)
    host.appendChild(content);
  host.removeAttribute("aria-busy");
  if (enter) {
    host.classList && host.classList.add("ui-enter");
    const off = () => host.classList && host.classList.remove("ui-enter");
    if (typeof host.addEventListener === "function")
      host.addEventListener("animationend", off, { once: true });
  }
  return host;
}
function html(kind, opts = {}) {
  const doc = globalThis.document;
  if (!doc)
    throw new Error("skeleton.html: нужен document");
  return el3(kind, opts, doc).outerHTML;
}

// src/sidenav/sidenav.core.js
var exports_sidenav_core = {};
__export(exports_sidenav_core, {
  splitMobile: () => splitMobile,
  sideGroups: () => sideGroups,
  normalizeBodyMode: () => normalizeBodyMode,
  normalizeAction: () => normalizeAction,
  moreHasNew: () => moreHasNew,
  markActive: () => markActive,
  flatten: () => flatten,
  activeItem: () => activeItem,
  actionIndex: () => actionIndex
});
function flatten(groups = []) {
  return groups.flatMap((g) => (g.items || []).map((it) => ({ ...it, group: g.title })));
}
function activeItem(groups, path) {
  if (!path)
    return null;
  const p = String(path).split("?")[0].replace(/\/+$/, "") || "/";
  const items = flatten(groups);
  const exact = items.find((it) => (it.href || "").replace(/\/+$/, "") === p || p === "/" && it.href === "/");
  if (exact)
    return exact;
  let best = null;
  for (const it of items) {
    const h = (it.href || "").replace(/\/+$/, "");
    if (!h || h === "/")
      continue;
    if (p.startsWith(h + "/") && (!best || h.length > best.href.replace(/\/+$/, "").length))
      best = it;
  }
  return best;
}
function markActive(groups, path) {
  const act = activeItem(groups, path);
  return (groups || []).map((g) => ({ ...g, items: (g.items || []).map((it) => ({ ...it, active: !!act && it.href === act.href })) }));
}
function sideGroups(groups = []) {
  if (!groups.some((g) => (g.items || []).some((it) => it.side === false)))
    return groups;
  return groups.map((g) => ({ ...g, items: (g.items || []).filter((it) => it.side !== false) })).filter((g) => g.items.length);
}
function splitMobile(groups, max = 4) {
  const items = flatten(groups);
  const pool = items.filter((it) => !it.more), forced = items.filter((it) => it.more);
  let primary = pool.slice(0, max), more = pool.slice(max);
  const ai = more.findIndex((it) => it.active);
  if (ai >= 0 && primary.length) {
    const swapped = primary[primary.length - 1];
    primary = primary.slice(0, -1).concat([more[ai]]);
    more = more.slice(0, ai).concat([swapped], more.slice(ai + 1));
  }
  return { primary, more: more.concat(forced) };
}
function moreHasNew(items = []) {
  return items.some((it) => it.badge != null && it.badge !== "" || !!it.dot);
}
function normalizeBodyMode(m) {
  return m === "side" ? "side" : "hide";
}
function actionIndex(count) {
  const n = Math.max(0, Number(count) || 0);
  return Math.ceil(n / 2);
}
function normalizeAction(a) {
  if (!a)
    return null;
  const o = typeof a === "object" ? a : {};
  return {
    icon: typeof o.icon === "string" && /^[a-z0-9-]+$/.test(o.icon) ? o.icon : "plus",
    label: o.label != null && String(o.label) !== "" ? String(o.label) : "Добавить",
    caption: o.caption != null && o.caption !== false ? o.caption === true ? o.label != null ? String(o.label) : "Добавить" : String(o.caption) : "",
    onClick: typeof o.onClick === "function" ? o.onClick : null
  };
}

// src/glass/glass.core.js
var exports_glass_core = {};
__export(exports_glass_core, {
  supportsLens: () => supportsLens,
  sdf: () => sdf,
  maps: () => maps,
  lensProfile: () => lensProfile
});
function sdf(px, py, w, h, r) {
  const hx = w / 2, hy = h / 2, rr = Math.min(r, hx, hy);
  const dx = px - hx, dy = py - hy;
  const qx = Math.abs(dx) - (hx - rr), qy = Math.abs(dy) - (hy - rr);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  const d = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - rr;
  let nx, ny;
  if (qx > 0 && qy > 0) {
    const l = Math.hypot(qx, qy) || 1;
    nx = qx / l;
    ny = qy / l;
  } else if (qx > qy) {
    nx = 1;
    ny = 0;
  } else {
    nx = 0;
    ny = 1;
  }
  return { d, nx: dx < 0 ? -nx : nx, ny: dy < 0 ? -ny : ny };
}
function lensProfile(dist, bezel) {
  if (!(bezel > 0) || dist < 0 || dist >= bezel)
    return 0;
  return Math.pow(1 - dist / bezel, 2.2);
}
function maps({ w, h, radius = 16, bezel = 16, light = [-0.62, -0.78], rim = 3, scale = 1 } = {}) {
  const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
  const disp = new Uint8ClampedArray(W * H * 4), spec = new Uint8ClampedArray(W * H * 4);
  const ll = Math.hypot(light[0], light[1]) || 1, lx = light[0] / ll, ly = light[1] / ll;
  for (let y = 0;y < H; y++) {
    for (let x = 0;x < W; x++) {
      const { d, nx, ny } = sdf((x + 0.5) / scale, (y + 0.5) / scale, w, h, radius);
      const dist = -d, i = (y * W + x) * 4;
      const m = lensProfile(dist, bezel);
      disp[i] = 128 - nx * m * 127;
      disp[i + 1] = 128 - ny * m * 127;
      disp[i + 2] = 128;
      disp[i + 3] = 255;
      let a = 0;
      if (dist >= 0 && dist < rim) {
        const k = nx * lx + ny * ly;
        a = Math.pow(1 - dist / rim, 0.7) * (0.3 + 0.7 * Math.pow(Math.max(0, k) + Math.max(0, -k) * 0.6, 1.2));
      }
      if (dist >= 0 && dist < bezel)
        a += 0.14 * Math.pow(1 - dist / bezel, 2.2);
      spec[i] = spec[i + 1] = spec[i + 2] = 255;
      spec[i + 3] = Math.min(255, Math.round(a * 255));
    }
  }
  return { width: W, height: H, disp, spec };
}
function supportsLens(nav) {
  const brands = nav && nav.userAgentData && nav.userAgentData.brands;
  if (Array.isArray(brands))
    return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand));
  const ua = nav && nav.userAgent || "";
  return /Chrome\/\d+/.test(ua) && !/Firefox|FxiOS|EdgiOS|CriOS/.test(ua);
}

// src/glass/glass.mount.js
var seq = 0;
function dataUrl(doc, w, h, arr) {
  const c = doc.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext && c.getContext("2d");
  if (!ctx || typeof ImageData === "undefined")
    return "";
  ctx.putImageData(new ImageData(arr, w, h), 0, 0);
  return c.toDataURL();
}
function mount7(el4, cfg = {}) {
  const doc = el4.ownerDocument, win = doc.defaultView || {};
  const id = "ui-lglass-" + ++seq;
  const lens = cfg.lens !== false && supportsLens(win.navigator);
  el4.classList.add("ui-lglass");
  const spec = doc.createElement("span");
  spec.className = "ui-lglass__spec";
  spec.setAttribute("aria-hidden", "true");
  el4.prepend(spec);
  let svg = null, img = null, filter = null;
  if (lens) {
    const NS = "http://www.w3.org/2000/svg";
    svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    filter = doc.createElementNS(NS, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("color-interpolation-filters", "sRGB");
    img = doc.createElementNS(NS, "feImage");
    img.setAttribute("result", "map");
    img.setAttribute("preserveAspectRatio", "none");
    const dm = doc.createElementNS(NS, "feDisplacementMap");
    dm.setAttribute("in", "SourceGraphic");
    dm.setAttribute("in2", "map");
    dm.setAttribute("scale", String(cfg.strength != null ? cfg.strength : 40));
    dm.setAttribute("xChannelSelector", "R");
    dm.setAttribute("yChannelSelector", "G");
    filter.append(img, dm);
    const defs = doc.createElementNS(NS, "defs");
    defs.appendChild(filter);
    svg.appendChild(defs);
    el4.prepend(svg);
    el4.style.setProperty("--ui-lglass-lens", `url(#${id})`);
  }
  let size = "";
  function update() {
    const r = el4.getBoundingClientRect ? el4.getBoundingClientRect() : { width: 0, height: 0 };
    const w = Math.round(r.width), h = Math.round(r.height);
    if (!w || !h || `${w}x${h}` === size)
      return;
    size = `${w}x${h}`;
    const cs = win.getComputedStyle ? win.getComputedStyle(el4) : null;
    const radius = cfg.radius != null ? cfg.radius : Math.min(parseFloat(cs && cs.borderTopLeftRadius) || 0, h / 2);
    const scale = Math.min(2, win.devicePixelRatio || 1);
    const m = maps({ w, h, radius, bezel: cfg.bezel != null ? cfg.bezel : 16, light: cfg.light, scale });
    if (lens) {
      for (const [k, v] of [["x", 0], ["y", 0], ["width", w], ["height", h]]) {
        filter.setAttribute(k, String(v));
        img.setAttribute(k, String(v));
      }
      const d = dataUrl(doc, m.width, m.height, m.disp);
      img.setAttribute("href", d);
    }
    const s = dataUrl(doc, m.width, m.height, m.spec);
    spec.style.backgroundImage = s ? `url(${s})` : "";
  }
  let raf = 0;
  const schedule = () => {
    if (raf)
      return;
    raf = (win.requestAnimationFrame || ((f) => setTimeout(f, 16)))(() => {
      raf = 0;
      update();
    });
  };
  const ro = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
  if (ro)
    ro.observe(el4);
  update();
  return {
    update() {
      size = "";
      update();
    },
    destroy() {
      if (ro)
        ro.disconnect();
      spec.remove();
      if (svg)
        svg.remove();
      el4.classList.remove("ui-lglass");
      el4.style.removeProperty("--ui-lglass-lens");
    }
  };
}

// src/sidenav/sidenav.mount.js
function el4(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls)
    n.className = cls;
  if (text != null)
    n.textContent = text;
  return n;
}
function iconNode(doc, name, size) {
  const s = el4(doc, "span", "ui-sidenav__ico");
  if (name && /^[a-z0-9-]+$/.test(name))
    s.innerHTML = icon(name, { size });
  return s;
}
function link(doc, it, cls, iconSize, text, titled) {
  const a = el4(doc, "a", cls + (it.active ? " is-active" : ""));
  a.setAttribute("href", it.href || "#");
  a.setAttribute("data-href", it.href || "");
  if (it.active)
    a.setAttribute("aria-current", "page");
  a.appendChild(iconNode(doc, it.icon, iconSize));
  a.appendChild(el4(doc, "span", "ui-sidenav__text", text != null ? text : it.label || ""));
  if (text != null && text !== it.label || titled)
    a.setAttribute("title", it.label || "");
  if (it.badge != null && it.badge !== "")
    a.appendChild(el4(doc, "span", "ui-sidenav__badge", String(it.badge)));
  else if (it.dot) {
    const d = el4(doc, "span", "ui-sidenav__dot");
    d.setAttribute("aria-label", typeof it.dot === "string" ? it.dot : "есть новое");
    a.appendChild(d);
  }
  return a;
}
function actionButton(doc, act, cls, iconSize, titled) {
  const b = el4(doc, "button", cls);
  b.type = "button";
  b.setAttribute("aria-label", act.label);
  if (titled)
    b.setAttribute("title", act.label);
  b.appendChild(iconNode(doc, act.icon, iconSize));
  if (act.caption)
    b.appendChild(el4(doc, "span", "ui-sidenav__text", act.caption));
  b.addEventListener("click", (e) => act.onClick && act.onClick(e));
  return b;
}
function mount8(host, cfg = {}) {
  const doc = host.ownerDocument;
  let groups = markActive(cfg.groups || [], cfg.path);
  let action = normalizeAction(cfg.action);
  const mobile = cfg.mobile !== false;
  let collapsed = !!cfg.collapsed;
  let bodyMode = normalizeBodyMode(cfg.bodyCollapsed);
  let bodyNode = cfg.body || null;
  const nav = el4(doc, "nav", "ui-sidenav");
  nav.setAttribute("aria-label", cfg.label || "Разделы");
  if (collapsed)
    nav.classList.add("ui-sidenav--collapsed");
  const brand = el4(doc, cfg.brandHref ? "a" : "div", "ui-sidenav__brand");
  if (cfg.brandHref)
    brand.setAttribute("href", cfg.brandHref);
  if (cfg.brand)
    brand.appendChild(cfg.brand);
  else if (cfg.brandHtml)
    brand.innerHTML = cfg.brandHtml;
  nav.appendChild(brand);
  let collapseBtn = null;
  function renderCollapse() {
    collapseBtn.textContent = "";
    collapseBtn.appendChild(iconNode(doc, collapsed ? "panel-left-open" : "panel-left-close", 16));
    const t = collapsed ? "Развернуть панель" : "Свернуть панель";
    collapseBtn.setAttribute("aria-label", t);
    collapseBtn.setAttribute("title", t);
    collapseBtn.setAttribute("aria-expanded", String(!collapsed));
  }
  if (cfg.collapsible) {
    collapseBtn = el4(doc, "button", "ui-sidenav__collapse");
    collapseBtn.type = "button";
    collapseBtn.addEventListener("click", () => setCollapsed(!collapsed));
    renderCollapse();
    nav.appendChild(collapseBtn);
  }
  let sideAction = null;
  function renderSideAction() {
    if (sideAction) {
      nav.removeChild(sideAction);
      sideAction = null;
    }
    if (!action)
      return;
    sideAction = actionButton(doc, action, "ui-sidenav__action", 16, collapsed);
    nav.insertBefore(sideAction, (collapseBtn || brand).nextSibling);
  }
  let searchBtn = null;
  if (cfg.search) {
    const b = searchBtn = el4(doc, "button", "ui-sidenav__search");
    b.type = "button";
    b.appendChild(iconNode(doc, "search", 14));
    b.appendChild(el4(doc, "span", "ui-sidenav__text", cfg.search.label || "Поиск"));
    if (cfg.search.hint)
      b.appendChild(el4(doc, "kbd", "ui-sidenav__kbd", cfg.search.hint));
    b.addEventListener("click", (e) => cfg.search.onOpen && cfg.search.onOpen(e));
    nav.appendChild(b);
  }
  const groupsEl = el4(doc, "div", "ui-sidenav__groups");
  nav.appendChild(groupsEl);
  let foot = null;
  if (cfg.footer) {
    foot = el4(doc, "div", "ui-sidenav__footer");
    foot.appendChild(cfg.footer);
    nav.appendChild(foot);
  }
  let bottom = null, more = null;
  if (mobile) {
    bottom = el4(doc, "nav", "ui-sidenav-bottom");
    bottom.setAttribute("aria-label", cfg.label || "Разделы");
    more = el4(doc, "div", "ui-sidenav-more");
    more.setAttribute("hidden", "");
  }
  function renderGroups() {
    groupsEl.textContent = "";
    for (const g of sideGroups(groups)) {
      const box = el4(doc, "div", "ui-sidenav__group");
      if (g.title)
        box.appendChild(el4(doc, "div", "ui-sidenav__title", g.title));
      for (const it of g.items || [])
        box.appendChild(link(doc, it, "ui-sidenav__item", 16, null, collapsed));
      groupsEl.appendChild(box);
    }
    if (bottom) {
      for (const c of Array.from(bottom.children))
        if (!(c.classList && c.classList.contains("ui-lglass__spec")) && String(c.tagName || c.tag).toLowerCase() !== "svg")
          bottom.removeChild(c);
      more.textContent = "";
      const { primary, more: rest } = splitMobile(groups, cfg.mobileMax || 4);
      const slots = [];
      for (const it of primary)
        slots.push(link(doc, it, "ui-sidenav-bottom__item", 20, it.short || it.label));
      if (rest.length) {
        const b = el4(doc, "button", "ui-sidenav-bottom__item ui-sidenav-bottom__more");
        b.type = "button";
        b.setAttribute("aria-expanded", "false");
        b.appendChild(iconNode(doc, "ellipsis", 20));
        b.appendChild(el4(doc, "span", "ui-sidenav__text", cfg.moreLabel || "Ещё"));
        b.addEventListener("click", () => toggleMore());
        if (rest.some((it) => it.active))
          b.classList.add("is-active");
        if (moreHasNew(rest)) {
          const d = el4(doc, "span", "ui-sidenav__dot");
          d.setAttribute("aria-label", "есть новое");
          b.appendChild(d);
        }
        slots.push(b);
        const sheet = el4(doc, "div", "ui-sidenav-more__sheet");
        for (const it of rest)
          sheet.appendChild(link(doc, it, "ui-sidenav__item", 16));
        const back = el4(doc, "div", "ui-sidenav-more__backdrop");
        back.addEventListener("click", () => toggleMore(false));
        more.append(back, sheet);
      }
      if (action)
        slots.splice(actionIndex(slots.length), 0, actionButton(doc, action, "ui-sidenav-bottom__item ui-sidenav-bottom__action", 22));
      for (const n of slots)
        bottom.appendChild(n);
    }
  }
  function toggleMore(force) {
    const btn = bottom && bottom.querySelector ? bottom.querySelector(".ui-sidenav-bottom__more") : null;
    const open = force != null ? force : more.hasAttribute("hidden");
    if (open)
      more.removeAttribute("hidden");
    else
      more.setAttribute("hidden", "");
    if (btn)
      btn.setAttribute("aria-expanded", String(open));
  }
  let bodyWrap = null, panel = null, panelIn = false;
  function dropPanel() {
    if (panelIn) {
      host.removeChild(panel);
      panelIn = false;
    }
    host.classList.remove("ui-sidenav-host--split");
  }
  function syncBody() {
    nav.classList[bodyNode ? "add" : "remove"]("ui-sidenav--has-body");
    if (!bodyNode) {
      if (bodyWrap && bodyWrap.parentNode)
        bodyWrap.parentNode.removeChild(bodyWrap);
      dropPanel();
      return;
    }
    if (!bodyWrap)
      bodyWrap = el4(doc, "div", "ui-sidenav__body");
    if (bodyWrap.children[0] !== bodyNode || bodyWrap.children.length !== 1) {
      bodyWrap.textContent = "";
      bodyWrap.appendChild(bodyNode);
    }
    if (collapsed && bodyMode === "side") {
      if (!panel) {
        panel = el4(doc, "aside", "ui-sidenav-panel");
        panel.setAttribute("aria-label", cfg.bodyLabel || "Содержимое панели");
      }
      panel.appendChild(bodyWrap);
      if (!panelIn) {
        host.insertBefore(panel, nav.nextSibling);
        panelIn = true;
      }
      host.classList.add("ui-sidenav-host--split");
    } else {
      dropPanel();
      nav.insertBefore(bodyWrap, groupsEl.nextSibling);
    }
  }
  function setCollapsed(v) {
    v = !!v;
    if (v === collapsed)
      return;
    collapsed = v;
    nav.classList[collapsed ? "add" : "remove"]("ui-sidenav--collapsed");
    if (collapseBtn)
      renderCollapse();
    if (searchBtn) {
      if (collapsed)
        searchBtn.setAttribute("title", (cfg.search.label || "Поиск") + (cfg.search.hint ? " (" + cfg.search.hint + ")" : ""));
      else
        searchBtn.removeAttribute("title");
    }
    renderGroups();
    renderSideAction();
    syncBody();
    if (typeof cfg.onCollapse === "function")
      cfg.onCollapse(collapsed);
  }
  renderGroups();
  renderSideAction();
  if (collapsed && searchBtn)
    searchBtn.setAttribute("title", (cfg.search.label || "Поиск") + (cfg.search.hint ? " (" + cfg.search.hint + ")" : ""));
  host.appendChild(nav);
  syncBody();
  if (cfg.glass)
    glassMode(nav, cfg.glass === true ? {} : cfg.glass);
  if (bottom) {
    if (cfg.floating)
      bottom.classList.add("ui-sidenav-bottom--floating");
    host.appendChild(bottom);
    host.appendChild(more);
    if (cfg.glass) {
      const g = cfg.glass === true ? {} : cfg.glass;
      bottom.classList.add("ui-sidenav-bottom--glass");
      mount7(bottom, { bezel: g.bezel != null ? g.bezel : 20, strength: g.strength != null ? g.strength : 36, light: g.light });
    }
  }
  return {
    el: nav,
    bottom,
    setActive(path) {
      groups = markActive(groups, path);
      renderGroups();
    },
    setBadge(href, text) {
      groups = groups.map((g) => ({ ...g, items: g.items.map((it) => it.href === href ? { ...it, badge: text == null ? undefined : text } : it) }));
      renderGroups();
    },
    toggleMore,
    setAction(a) {
      action = normalizeAction(a);
      renderSideAction();
      renderGroups();
    },
    setBody(node) {
      bodyNode = node || null;
      syncBody();
    },
    setCollapsed,
    isCollapsed() {
      return collapsed;
    },
    setBodyCollapsed(mode) {
      bodyMode = normalizeBodyMode(mode);
      syncBody();
    }
  };
}
function glassMode(nav, opts) {
  nav.classList.add("ui-sidenav--glass");
  mount7(nav, { bezel: opts.bezel != null ? opts.bezel : 18, strength: opts.strength != null ? opts.strength : 44, light: opts.light });
  const lifted = new WeakMap;
  const itemOf = (e) => e.target && e.target.closest ? e.target.closest(".ui-sidenav__item, .ui-sidenav__search") : null;
  nav.addEventListener("pointermove", (e) => {
    const it = itemOf(e);
    if (!it || !it.getBoundingClientRect)
      return;
    const r = it.getBoundingClientRect();
    it.style.setProperty("--ui-px", Math.round(e.clientX - r.left) + "px");
  });
  const drop = () => {
    for (const n of nav.querySelectorAll(".is-press"))
      n.classList.remove("is-press");
  };
  nav.addEventListener("pointerdown", (e) => {
    const it = itemOf(e);
    if (!it)
      return;
    if (!lifted.has(it))
      lifted.set(it, mount7(it, { lens: false, bezel: 8, light: opts.light }));
    it.classList.add("is-press");
  });
  nav.addEventListener("pointerup", drop);
  nav.addEventListener("pointerleave", drop);
  nav.addEventListener("pointercancel", drop);
}

// src/keys/keys.core.js
var exports_keys_core = {};
__export(exports_keys_core, {
  strokeMatches: () => strokeMatches,
  parseStroke: () => parseStroke,
  label: () => label,
  keyMatches: () => keyMatches,
  inField: () => inField,
  createRegistry: () => createRegistry
});
var SYMBOL_CODE = {
  "/": "Slash",
  "?": "Slash",
  ".": "Period",
  ",": "Comma",
  "[": "BracketLeft",
  "]": "BracketRight",
  ";": "Semicolon",
  "'": "Quote",
  "-": "Minus",
  "=": "Equal",
  "`": "Backquote",
  "\\": "Backslash"
};
var NAMES = {
  escape: "Escape",
  esc: "Escape",
  enter: "Enter",
  space: " ",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  f2: "F2",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown"
};
var NON_TEXT_INPUTS = ["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"];
var LABELS = { Escape: "Esc", Enter: "↵", " ": "Пробел", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Backspace: "⌫", Delete: "Del", Tab: "Tab" };
function parseStroke(s) {
  const parts = s.split("+");
  let key = parts.pop();
  if (key === "" && parts.length) {
    parts.pop();
    key = "+";
  }
  const st = { mod: false, shift: false, alt: false, key: NAMES[key.toLowerCase()] || (key.length === 1 ? key.toLowerCase() : key) };
  for (const p of parts) {
    if (p === "mod")
      st.mod = true;
    else if (p === "shift")
      st.shift = true;
    else if (p === "alt")
      st.alt = true;
  }
  if (st.key === "?")
    st.shift = true;
  return st;
}
function keyMatches(st, e) {
  const k = st.key;
  if (/^[a-z]$/.test(k))
    return e.code === "Key" + k.toUpperCase();
  if (/^[0-9]$/.test(k))
    return e.code === "Digit" + k || e.code === "Numpad" + k;
  if (SYMBOL_CODE[k])
    return e.code === SYMBOL_CODE[k] || e.key === k;
  return e.key === k;
}
function strokeMatches(st, e, isMac) {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const anyMod = e.metaKey || e.ctrlKey;
  if (st.mod ? !mod : anyMod)
    return false;
  if (st.alt !== e.altKey)
    return false;
  if (st.key !== "?" && st.shift !== e.shiftKey)
    return false;
  return keyMatches(st, e);
}
function inField(el5, body) {
  if (!el5 || el5 === body)
    return false;
  if (el5.isContentEditable)
    return true;
  const tag = el5.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT")
    return true;
  if (tag !== "INPUT")
    return false;
  return !NON_TEXT_INPUTS.includes((el5.type || "").toLowerCase());
}
function label(keys, isMac) {
  return String(keys).split(" ").map((s) => {
    const st = parseStroke(s);
    const k = LABELS[st.key] || (st.key.length === 1 ? st.key.toUpperCase() : st.key);
    const shift = st.shift && st.key !== "?";
    if (isMac)
      return (st.mod ? "⌘" : "") + (st.alt ? "⌥" : "") + (shift ? "⇧" : "") + k;
    return [st.mod && "Ctrl", st.alt && "Alt", shift && "Shift", k].filter(Boolean).join("+");
  }).join(" ");
}
var sig = (s) => [s.key, s.mod, s.shift, s.alt].join("|");
function createRegistry(env = {}) {
  const isMac = !!env.isMac;
  const setTimer = env.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = env.clearTimer || ((id) => clearTimeout(id));
  const bindings = [];
  let pending = null;
  let pendingTimer = null;
  const usable = (b, e) => {
    if (inField(e.target, env.body) && !b.input)
      return false;
    try {
      return !b.when || !!b.when();
    } catch {
      return false;
    }
  };
  const clearPending = () => {
    pending = null;
    clearTimer(pendingTimer);
  };
  function handle(e) {
    if (e.defaultPrevented || e.isComposing)
      return false;
    if (env.blocked && env.blocked()) {
      clearPending();
      const over = bindings.find((b) => b.overDialog && b.strokes.length === 1 && strokeMatches(b.strokes[0], e, isMac) && usable(b, e));
      if (over) {
        e.preventDefault();
        over.run(e);
        return true;
      }
      return false;
    }
    if (pending) {
      const first = pending;
      clearPending();
      const hit = bindings.find((b) => b.strokes.length === 2 && b.strokes[0] === first && strokeMatches(b.strokes[1], e, isMac) && usable(b, e));
      if (hit) {
        e.preventDefault();
        hit.run(e);
        return true;
      }
    }
    const single = bindings.find((b) => b.strokes.length === 1 && strokeMatches(b.strokes[0], e, isMac) && usable(b, e));
    if (single) {
      e.preventDefault();
      single.run(e);
      return true;
    }
    const starts = bindings.find((b) => b.strokes.length === 2 && strokeMatches(b.strokes[0], e, isMac) && usable(b, e));
    if (starts) {
      e.preventDefault();
      pending = starts.strokes[0];
      pendingTimer = setTimer(clearPending, 1000);
      return true;
    }
    return false;
  }
  return {
    add(spec) {
      if (!spec || !spec.keys || typeof spec.run !== "function")
        return null;
      const strokes = String(spec.keys).trim().split(/\s+/).map(parseStroke);
      if (strokes.length === 2) {
        const same = bindings.find((x) => x.strokes.length === 2 && sig(x.strokes[0]) === sig(strokes[0]));
        if (same)
          strokes[0] = same.strokes[0];
      }
      const b = { ...spec, strokes };
      bindings.push(b);
      return b;
    },
    remove(b) {
      const i = bindings.indexOf(b);
      if (i >= 0)
        bindings.splice(i, 1);
    },
    list() {
      return bindings.filter((b) => b.title).map((b) => ({ keys: b.keys, title: b.title, group: b.group || "Общее", label: label(b.keys, isMac) }));
    },
    label: (keys) => label(keys, isMac),
    handle,
    isMac
  };
}

// src/keys/keys.mount.js
function create2(opts = {}) {
  const doc = opts.document || (typeof document !== "undefined" ? document : null);
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const isMac = opts.isMac != null ? !!opts.isMac : /Mac|iPhone|iPad|iPod/.test(nav.platform || nav.userAgent || "");
  const blocked = opts.blocked || (() => !!(doc && doc.querySelector && doc.querySelector("dialog.ui-dialog[open]")));
  const reg = createRegistry({ isMac, get body() {
    return doc && doc.body;
  }, blocked });
  let on = false;
  const onKey = (e) => {
    reg.handle(e);
  };
  const api = {
    ...reg,
    add(spec) {
      const b = reg.add(spec);
      if (b)
        api.attach();
      return b;
    },
    attach() {
      if (!on && doc && typeof doc.addEventListener === "function") {
        doc.addEventListener("keydown", onKey);
        on = true;
      }
      return api;
    },
    detach() {
      if (on && doc) {
        doc.removeEventListener("keydown", onKey);
        on = false;
      }
      return api;
    }
  };
  return api;
}

// src/palette/palette.core.js
var exports_palette_core = {};
__export(exports_palette_core, {
  variants: () => variants,
  toRu: () => toRu,
  toEn: () => toEn,
  sortResults: () => sortResults,
  rowHtml: () => rowHtml,
  rank: () => rank,
  norm: () => norm,
  mergeTypes: () => mergeTypes,
  matchItem: () => matchItem,
  hlHtml: () => hlHtml,
  highlightRanges: () => highlightRanges,
  esc: () => esc3,
  dl: () => dl,
  digits: () => digits,
  bind: () => bind,
  DEFAULT_TYPES: () => DEFAULT_TYPES
});
var EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`{}:\"<>~";
var RU = "йцукенгшщзхъфывапролджэячсмитьбюёхъжэбюё";
var EN_RU = {};
var RU_EN = {};
for (let i = 0;i < EN.length; i++) {
  EN_RU[EN[i]] = RU[i];
  if (!(RU[i] in RU_EN))
    RU_EN[RU[i]] = EN[i];
}
RU_EN["е"] = "t";
function norm(s) {
  return String(s ?? "").toLowerCase().replace(/ё/g, "е");
}
function digits(s) {
  return String(s ?? "").replace(/\D/g, "");
}
function esc3(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
var conv = (map) => (s) => norm(s).split("").map((c) => map[c] || c).join("");
var toRu = conv(EN_RU);
var toEn = conv(RU_EN);
function variants(q) {
  const base3 = norm(q).trim();
  if (!base3)
    return [];
  const out = [base3];
  if (/[a-z[\];',.`{}:"<>~]/.test(base3) && !/[а-я]/.test(base3))
    out.push(toRu(base3).replace(/ё/g, "е"));
  if (/[а-я]/.test(base3) && !/[a-z]/.test(base3))
    out.push(toEn(base3));
  return [...new Set(out)];
}
function tokens(q) {
  return norm(q).split(/\s+/).map((t) => t.replace(/^@+/, "")).filter(Boolean);
}
function words(text) {
  return norm(text).split(/[^0-9a-zа-я@_]+/).map((w) => w.replace(/^@+/, "")).filter(Boolean);
}
function dl(a, b, limit = 2) {
  if (a === b)
    return 0;
  if (Math.abs(a.length - b.length) > limit)
    return limit + 1;
  const n = a.length, m = b.length;
  let prev2 = null, prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1;i <= n; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1;j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin)
        rowMin = v;
    }
    if (rowMin > limit)
      return limit + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}
var TIER = { prefix: 3, contains: 2, typo: 1 };
function phoneCandidates(t) {
  const d = digits(t);
  if (d.length < 3)
    return [];
  const out = [d];
  if (d[0] === "8")
    out.push("7" + d.slice(1));
  if (d[0] === "8" || d[0] === "7")
    out.push(d.slice(1));
  return out;
}
function tokenTier(t, ws, text, phone) {
  let best = 0;
  if (ws.some((w) => w.startsWith(t)))
    return TIER.prefix;
  if (ws.some((w) => w.includes(t)) || text.includes(t))
    best = TIER.contains;
  if (/^[\d\s()+-]+$/.test(t) && phone) {
    const pd = digits(phone);
    for (const c of phoneCandidates(t)) {
      if (pd.startsWith(c) || pd.slice(1).startsWith(c))
        return TIER.prefix;
      if (pd.includes(c))
        best = Math.max(best, TIER.contains);
    }
  }
  if (best)
    return best;
  if (t.length >= 4 && !/^\d+$/.test(t)) {
    for (const w of ws) {
      if (w.length < 4)
        continue;
      if (dl(t, w, 1) <= 1 || dl(t, w.slice(0, t.length), 1) <= 1 || dl(t, w.slice(0, t.length + 1), 1) <= 1 || t.length > 4 && dl(t, w.slice(0, t.length - 1), 1) <= 1)
        return TIER.typo;
    }
  }
  return 0;
}
function matchItem(item, q) {
  let best = null;
  const vs = variants(q);
  const titleN = norm(item.title);
  const titleWs = words(item.title);
  const allText = norm([item.title, ...item.extra || []].filter(Boolean).join(" · "));
  const allWs = words(allText);
  vs.forEach((v, vi) => {
    const ts = /^[\d\s()+-]+$/.test(v) && digits(v).length >= 3 ? [digits(v)] : tokens(v);
    if (!ts.length)
      return;
    let tier = 3, inTitle = true, viaPhone = false;
    for (const t of ts) {
      const tt = tokenTier(t, titleWs, titleN, null);
      if (tt === TIER.prefix)
        continue;
      const ta = tokenTier(t, allWs, allText, item.phone);
      const got = Math.max(tt, ta);
      if (!got) {
        tier = 0;
        break;
      }
      if (ta > tt) {
        inTitle = false;
        if (/\d/.test(t) && item.phone && !allText.includes(t))
          viaPhone = true;
      }
      tier = Math.min(tier, got);
    }
    if (!tier)
      return;
    const cand = { tier, inTitle, viaPhone, direct: vi === 0, ranges: highlightRanges(item.title, ts) };
    if (!best || cand.tier > best.tier || cand.tier === best.tier && cand.inTitle && !best.inTitle || cand.tier === best.tier && cand.inTitle === best.inTitle && cand.direct && !best.direct)
      best = cand;
  });
  return best;
}
function highlightRanges(title, ts) {
  const n = norm(title);
  const out = [];
  for (const t of ts) {
    if (!t)
      continue;
    let at = -1;
    for (let i = n.indexOf(t);i >= 0; i = n.indexOf(t, i + 1)) {
      if (i === 0 || /[^0-9a-zа-я]/.test(n[i - 1])) {
        at = i;
        break;
      }
      if (at < 0)
        at = i;
    }
    if (at >= 0)
      out.push([at, at + t.length]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1])
      last[1] = Math.max(last[1], r[1]);
    else
      merged.push([...r]);
  }
  return merged;
}
function hlHtml(title, ranges) {
  const s = String(title ?? "");
  let html2 = "", pos = 0;
  for (const [a, b] of ranges || []) {
    if (a < pos || b > s.length)
      continue;
    html2 += esc3(s.slice(pos, a)) + "<mark>" + esc3(s.slice(a, b)) + "</mark>";
    pos = b;
  }
  return html2 + esc3(s.slice(pos));
}
var DEFAULT_TYPES = { command: { order: 4, label: "Команда", icon: "chevron-right" } };
function mergeTypes(types) {
  const out = { ...DEFAULT_TYPES };
  for (const [k, v] of Object.entries(types || {}))
    out[k] = { ...out[k] || {}, ...v };
  return out;
}
var typeRank = (types, t) => (t in types) && typeof types[t].order === "number" ? types[t].order : 3.5;
function sortResults(list, types = DEFAULT_TYPES) {
  return list.sort((a, b) => b.tier - a.tier || (b.inTitle ? 1 : 0) - (a.inTitle ? 1 : 0) || typeRank(types, a.type) - typeRank(types, b.type) || (b.recentAt || 0) - (a.recentAt || 0) || String(a.title).localeCompare(String(b.title), "ru"));
}
function rank(items, q, recent = {}, types = DEFAULT_TYPES) {
  const out = [];
  for (const it of items || []) {
    const m = matchItem(it, q);
    if (m)
      out.push({ ...it, ...m, recentAt: recent[it.type + ":" + it.id] || 0 });
  }
  return sortResults(out, types);
}
function rowHtml(r, idx, { active = false, iconFn = null, keyLabel = "", types = DEFAULT_TYPES } = {}) {
  const t = types[r.type] || {};
  const ic = iconFn ? iconFn(r.icon || t.icon || "chevron-right", 16) : "";
  const hint = r.viaPhone && r.phone ? [r.phone, r.hint].filter(Boolean).join(" · ") : r.hint;
  const side = keyLabel ? String(keyLabel).split(" ").map((k) => `<kbd>${esc3(k)}</kbd>`).join("") : esc3(r.side || t.label || "");
  const n = Number(idx) || 0;
  return `<div class="ui-pal__row${active ? " is-active" : ""}" role="option" id="ui-pal-opt-${n}" data-i="${n}" aria-selected="${active}">` + `<span class="ui-pal__ic ui-pal__ic--${esc3(r.type || "command")}">${ic}</span>` + `<span class="ui-pal__main"><span class="ui-pal__title">${hlHtml(r.title, r.ranges)}</span>${hint ? `<span class="ui-pal__hint">${esc3(hint)}</span>` : ""}</span>` + `<span class="ui-pal__side">${side}</span></div>`;
}
function bind(types) {
  const T = mergeTypes(types);
  return {
    norm,
    toRu,
    toEn,
    variants,
    dl,
    matchItem,
    highlightRanges,
    hlHtml,
    esc: esc3,
    digits,
    types: T,
    rank: (items, q, recent) => rank(items, q, recent, T),
    sortResults: (list) => sortResults(list, T),
    rowHtml: (r, idx, o = {}) => rowHtml(r, idx, { ...o, types: T })
  };
}

// src/palette/palette.mount.js
var TEXT = {
  dialog: "Поиск и команды",
  placeholder: "Поиск и команды",
  search: "Поиск",
  results: "Результаты",
  esc: "Esc",
  cancel: "Закрыть",
  pick: "выбрать",
  openRow: "открыть",
  closeRow: "закрыть",
  allKeys: "все клавиши",
  openAnywhere: "открыть отовсюду",
  recent: "Недавние",
  actions: "Действия",
  nav: "Перейти",
  empty: "Ничего не нашлось",
  loading: "Загружаю…",
  keysTitle: "Быстрые клавиши",
  keysSearch: "Найти клавишу или действие",
  keysSearchLabel: "Найти клавишу",
  keysNone: "Такой клавиши нет",
  keysClose: "Закрыть",
  keysCloseTitle: "Закрыть (Esc)",
  keysGroupPalette: "В палитре",
  keysPick: "Выбрать строку",
  keysOpen: "Открыть выбранное",
  keysCloseKey: "Закрыть",
  triggerText: "Найти…",
  triggerTitle: "Поиск и команды",
  triggerLabel: "Поиск",
  failed: "Не получилось открыть: ",
  network: "ошибка связи"
};
function create3(opts = {}) {
  const doc = opts.document || (typeof document !== "undefined" ? document : null);
  const win = opts.window || (typeof window !== "undefined" ? window : globalThis);
  const getKeys = () => opts.keys;
  const P = {
    commands: [],
    sources: [],
    register(cmd) {
      if (!cmd || !cmd.id || typeof cmd.run !== "function")
        return null;
      P.commands = P.commands.filter((c) => c.id !== cmd.id).concat(cmd);
      return cmd;
    },
    addSource(src) {
      if (!src || !src.id || typeof src.search !== "function")
        return null;
      P.sources = P.sources.filter((s) => s.id !== src.id).concat(src);
      return src;
    },
    open() {},
    close() {},
    openKeys() {},
    closeKeys() {},
    isOpen: () => false,
    keysOpen: () => false,
    mounted: false,
    mount: mount9
  };
  function mount9(cfg = {}) {
    if (P.mounted)
      return P;
    if (!doc || typeof doc.createElement !== "function" || typeof doc.querySelector !== "function")
      return P;
    P.mounted = true;
    const T = { ...TEXT, ...cfg.text || {} };
    const logic = bind(cfg.types);
    const types = logic.types;
    const Keys = getKeys();
    const $ = (s, r = doc) => r.querySelector(s);
    const loggedIn = () => cfg.loggedIn ? !!cfg.loggedIn() : true;
    const blocked = () => cfg.blocked ? !!cfg.blocked() : false;
    const ic = (name, size = 16) => {
      if (typeof cfg.icon === "function")
        return cfg.icon(name, size);
      return icon(name === "close" ? "x" : name, { size });
    };
    const RECENT_KEY = cfg.recentKey || "ui.palette.recent";
    function readRecent() {
      try {
        const v = JSON.parse(win.localStorage.getItem(RECENT_KEY) || "[]");
        return Array.isArray(v) ? v.filter((x) => x && x.k) : [];
      } catch {
        return [];
      }
    }
    function pushRecent(type, id) {
      const k = type + ":" + id;
      const list2 = [{ k, t: Date.now() }, ...readRecent().filter((x) => x.k !== k)].slice(0, 8);
      try {
        win.localStorage.setItem(RECENT_KEY, JSON.stringify(list2));
      } catch {}
    }
    const recentMap = () => Object.fromEntries(readRecent().map((x) => [x.k, x.t]));
    const own = (cfg.sources || []).filter((s) => s && s.id && typeof s.items === "function");
    const itemCache = {};
    async function itemsOf(id) {
      const src = own.find((s) => s.id === id);
      const list2 = await src.items().catch(() => itemCache[id] || []);
      itemCache[id] = list2;
      return list2;
    }
    own.forEach((s) => {
      const added = P.addSource({ id: s.id, title: s.title, search: async (q) => logic.rank(await itemsOf(s.id), q, recentMap()) });
      if (added)
        added._own = true;
    });
    const openers = cfg.openers || {};
    const modal = (el5) => typeof el5.showModal === "function";
    function layer(className, aria, onClose) {
      const el5 = doc.createElement("dialog");
      el5.className = className;
      el5.setAttribute("role", "dialog");
      el5.setAttribute("aria-modal", "true");
      if (aria.label)
        el5.setAttribute("aria-label", aria.label);
      if (aria.labelledby)
        el5.setAttribute("aria-labelledby", aria.labelledby);
      if (modal(el5))
        el5.dataset.shut = "1";
      else
        el5.hidden = true;
      el5.addEventListener("cancel", (e) => {
        e.preventDefault();
        onClose();
      });
      el5.addEventListener("close", () => {
        if (el5.dataset.shut !== "1")
          onClose();
      });
      doc.body.appendChild(el5);
      return el5;
    }
    function show2(el5) {
      if (!modal(el5)) {
        el5.hidden = false;
        return;
      }
      if (!el5.open) {
        el5.dataset.shut = "";
        el5.showModal();
      }
    }
    function hide(el5) {
      if (!modal(el5)) {
        el5.hidden = true;
        return;
      }
      el5.dataset.shut = "1";
      if (el5.open)
        el5.close();
    }
    const shown = (el5) => !!el5 && (modal(el5) ? el5.dataset.shut !== "1" : !el5.hidden);
    const isOpen = () => shown(ov);
    const keysOpen = () => shown(kov);
    const idle = () => loggedIn() && !isOpen() && !keysOpen() && !blocked();
    let ov = null, input = null, list = null, results = [], active = 0, seq2 = 0, returnFocus = null;
    function build() {
      if (ov)
        return;
      ov = layer("ui-pal", { label: T.dialog }, () => close());
      const hint = Keys ? Keys.label("mod+k") : "";
      ov.innerHTML = `
      <div class="ui-pal__box">
        <div class="ui-pal__search">
          <span class="ui-pal__search-ic">${ic("search", 18)}</span>
          <input class="ui-pal__input" type="text" role="combobox" aria-expanded="true" aria-controls="ui-pal-list"
            aria-autocomplete="list" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go"
            placeholder="${esc3(T.placeholder)}" aria-label="${esc3(T.search)}">
          <kbd class="ui-pal__esc">${esc3(T.esc)}</kbd>
          <button type="button" class="ui-pal__cancel">${esc3(T.cancel)}</button>
        </div>
        <div class="ui-pal__list" id="ui-pal-list" role="listbox" aria-label="${esc3(T.results)}"></div>
        <div class="ui-pal__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> ${esc3(T.pick)}</span><span><kbd>↵</kbd> ${esc3(T.openRow)}</span><span><kbd>${esc3(T.esc)}</kbd> ${esc3(T.closeRow)}</span>
          <button type="button" class="ui-pal__foot-keys"><kbd>?</kbd> ${esc3(T.allKeys)}</button>
          <span class="ui-pal__foot-open">${hint ? `<kbd>${esc3(hint)}</kbd> ${esc3(T.openAnywhere)}` : ""}</span>
        </div>
      </div>`;
      input = $(".ui-pal__input", ov);
      list = $(".ui-pal__list", ov);
      ov.addEventListener("mousedown", (e) => {
        if (e.target === ov) {
          e.preventDefault();
          close();
        }
      });
      $(".ui-pal__cancel", ov).onclick = () => close();
      $(".ui-pal__foot-keys", ov).onclick = () => {
        close({ keepFocus: true });
        openKeys();
      };
      input.addEventListener("input", () => search());
      input.addEventListener("keydown", onKey);
      list.addEventListener("mousemove", (e) => {
        const row = e.target.closest(".ui-pal__row");
        if (row && +row.dataset.i !== active)
          setActive(+row.dataset.i, false);
      });
      list.addEventListener("click", (e) => {
        const row = e.target.closest(".ui-pal__row");
        if (row)
          choose(+row.dataset.i);
      });
    }
    function onKey(e) {
      if (e.isComposing)
        return;
      if (e.key === "ArrowDown" || e.ctrlKey && e.code === "KeyN") {
        e.preventDefault();
        setActive(active + 1);
      } else if (e.key === "ArrowUp" || e.ctrlKey && e.code === "KeyP") {
        e.preventDefault();
        setActive(active - 1);
      } else if (e.key === "Home" && e.ctrlKey) {
        e.preventDefault();
        setActive(0);
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(active);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Tab") {
        e.preventDefault();
        setActive(active + (e.shiftKey ? -1 : 1));
      }
    }
    function setActive(i, scroll = true) {
      if (!results.length)
        return;
      active = (i + results.length) % results.length;
      list.querySelectorAll(".ui-pal__row").forEach((r) => {
        const on = +r.dataset.i === active;
        r.classList.toggle("is-active", on);
        r.setAttribute("aria-selected", String(on));
        if (on && scroll)
          r.scrollIntoView({ block: "nearest" });
      });
      input.setAttribute("aria-activedescendant", "ui-pal-opt-" + active);
    }
    function commandItems() {
      return (P.commands || []).filter((c) => {
        try {
          return !c.when || c.when();
        } catch {
          return false;
        }
      }).map((c) => ({
        type: "command",
        id: c.id,
        title: c.title,
        hint: c.hint || "",
        icon: c.icon,
        keys: c.keys,
        extra: [c.group, ...Array.isArray(c.keywords) ? c.keywords : []].filter(Boolean),
        group: c.group,
        run: c.run
      }));
    }
    function render2(sections, emptyText) {
      results = [];
      let html2 = "";
      for (const s of sections) {
        if (!s.items.length)
          continue;
        if (s.title)
          html2 += `<div class="ui-pal__sec" role="presentation">${esc3(s.title)}</div>`;
        for (const r of s.items) {
          const i = results.length;
          results.push(r);
          html2 += logic.rowHtml(r, i, { active: i === 0, iconFn: ic, keyLabel: r.keys && Keys ? Keys.label(r.keys) : "" });
        }
      }
      list.innerHTML = html2 || `<div class="ui-pal__empty">${esc3(emptyText || T.empty)}</div>`;
      active = 0;
      list.scrollTop = 0;
      if (results.length)
        input.setAttribute("aria-activedescendant", "ui-pal-opt-0");
      else
        input.removeAttribute("aria-activedescendant");
    }
    const navGroup = cfg.navGroup || T.nav;
    function emptyView() {
      const cmds = commandItems();
      const rec = readRecent();
      const recent = [];
      for (const { k } of rec) {
        const i = k.indexOf(":");
        const type = k.slice(0, i), id = k.slice(i + 1);
        const found = type === "command" ? cmds.find((c) => c.id === id) : (itemCache[type] || []).find((x) => x.id === id);
        if (found)
          recent.push(found);
      }
      const nav = cmds.filter((c) => c.group === navGroup);
      const actions = cmds.filter((c) => c.group !== navGroup && !recent.some((r) => r.type === "command" && r.id === c.id));
      render2([
        { title: T.recent, items: recent },
        { title: T.actions, items: actions },
        { title: T.nav, items: nav }
      ]);
    }
    async function search() {
      const q = input.value;
      const my = ++seq2;
      if (!q.trim()) {
        emptyView();
        return;
      }
      const recent = recentMap();
      const cmds = logic.rank(commandItems(), q, recent);
      const anyCached = own.some((s) => itemCache[s.id]);
      if (!anyCached)
        render2([{ items: cmds }], T.loading);
      const mine = await Promise.all(own.map((s) => itemsOf(s.id).then((items) => logic.rank(items, q, recent))));
      const ext = await Promise.all((P.sources || []).filter((s) => !s._own).map(async (s) => {
        try {
          const got = await s.search(q);
          return (Array.isArray(got) ? got : []).map((r) => {
            const it = { type: r.type || s.id, id: String(r.id ?? ""), title: r.title, hint: r.hint, icon: r.icon, run: r.run, extra: [r.hint, r.group].filter(Boolean) };
            return { ...it, ...matchItem(it, q) || { tier: 2, inTitle: false, ranges: [] }, recentAt: recent[it.type + ":" + it.id] || 0 };
          });
        } catch {
          return [];
        }
      }));
      if (my !== seq2 || !isOpen())
        return;
      const all = logic.sortResults([].concat(...mine, ...ext, cmds)).slice(0, 50);
      render2([{ items: all }]);
    }
    function choose(i) {
      const r = results[i];
      if (!r)
        return;
      close({ keepFocus: true });
      pushRecent(r.type, r.id);
      try {
        const out = r.type === "command" || !openers[r.type] ? r.run && r.run() : openers[r.type](r);
        if (out && typeof out.catch === "function")
          out.catch((err) => notify(err));
      } catch (err) {
        notify(err);
      }
    }
    function notify(err) {
      const msg = T.failed + (err && err.message ? err.message : T.network);
      if (typeof cfg.notify === "function")
        cfg.notify(msg);
      else if (win.UI && win.UI.toast)
        win.UI.toast.show({ text: msg, kind: "error" });
    }
    function open(q = "") {
      if (!loggedIn())
        return;
      if (keysOpen())
        closeKeys({ keepFocus: true });
      build();
      if (!isOpen())
        returnFocus = doc.activeElement;
      show2(ov);
      doc.documentElement.classList.add("ui-pal-lock");
      input.value = q || "";
      input.focus();
      if (q)
        search();
      else
        emptyView();
      preload();
    }
    function close({ keepFocus = false } = {}) {
      if (!isOpen())
        return;
      hide(ov);
      seq2++;
      doc.documentElement.classList.remove("ui-pal-lock");
      const back = returnFocus;
      returnFocus = null;
      if (!keepFocus && back && back.isConnected && typeof back.focus === "function")
        back.focus({ preventScroll: true });
    }
    let kov = null, kreturn = null;
    function buildKeys() {
      if (kov)
        return;
      kov = layer("ui-pal ui-pal--keys", { labelledby: "ui-palk-title" }, () => closeKeys());
      kov.innerHTML = `
      <div class="ui-pal__box ui-pal__box--keys">
        <div class="ui-pal__khead"><h2 id="ui-palk-title">${esc3(T.keysTitle)}</h2>
          <button type="button" class="ui-pal__kx" aria-label="${esc3(T.keysClose)}" title="${esc3(T.keysCloseTitle)}">${ic("close", 18)}</button></div>
        <div class="ui-pal__search ui-pal__ksearch"><span class="ui-pal__search-ic">${ic("search", 16)}</span>
          <input class="ui-pal__input ui-pal__kinput" type="text" autocomplete="off" spellcheck="false" placeholder="${esc3(T.keysSearch)}" aria-label="${esc3(T.keysSearchLabel)}"></div>
        <div class="ui-pal__kbody"></div>
      </div>`;
      kov.addEventListener("mousedown", (e) => {
        if (e.target === kov) {
          e.preventDefault();
          closeKeys();
        }
      });
      $(".ui-pal__kx", kov).onclick = () => closeKeys();
      const inp = $(".ui-pal__kinput", kov);
      inp.addEventListener("input", () => renderKeys(inp.value));
      kov.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeKeys();
        } else if (e.key === "Tab") {
          e.preventDefault();
          (doc.activeElement === inp ? $(".ui-pal__kx", kov) : inp).focus();
        }
      });
    }
    function renderKeys(q) {
      const all = (Keys ? Keys.list() : []).concat([
        { group: T.keysGroupPalette, title: T.keysPick, label: "↑ ↓" },
        { group: T.keysGroupPalette, title: T.keysOpen, label: "↵" },
        { group: T.keysGroupPalette, title: T.keysCloseKey, label: "Esc" }
      ]);
      const seen = new Set;
      const rows = all.filter((k) => {
        const s = k.group + "|" + k.title + "|" + k.label;
        if (seen.has(s))
          return false;
        seen.add(s);
        return true;
      }).filter((k) => !String(q || "").trim() || matchItem({ title: k.title, extra: [k.group, k.label] }, q));
      const groups = new Map;
      rows.forEach((k) => {
        if (!groups.has(k.group))
          groups.set(k.group, []);
        groups.get(k.group).push(k);
      });
      const body = $(".ui-pal__kbody", kov);
      body.innerHTML = groups.size ? [...groups].map(([g, ks]) => `
      <section class="ui-pal__kgroup"><h3>${esc3(g)}</h3>${ks.map((k) => `
        <div class="ui-pal__krow"><span>${esc3(k.title)}</span><span class="ui-pal__kkeys">${String(k.label).split(" ").map((s) => `<kbd>${esc3(s)}</kbd>`).join("")}</span></div>`).join("")}
      </section>`).join("") : `<div class="ui-pal__empty">${esc3(T.keysNone)}</div>`;
    }
    function openKeys() {
      if (!loggedIn())
        return;
      if (isOpen())
        close({ keepFocus: true });
      buildKeys();
      if (!keysOpen())
        kreturn = doc.activeElement;
      show2(kov);
      doc.documentElement.classList.add("ui-pal-lock");
      const inp = $(".ui-pal__kinput", kov);
      inp.value = "";
      renderKeys("");
      inp.focus();
    }
    function closeKeys({ keepFocus = false } = {}) {
      if (!keysOpen())
        return;
      hide(kov);
      doc.documentElement.classList.remove("ui-pal-lock");
      const back = kreturn;
      kreturn = null;
      if (!keepFocus && back && back.isConnected && typeof back.focus === "function")
        back.focus({ preventScroll: true });
    }
    let preloaded = false;
    function preload() {
      if (preloaded || !loggedIn())
        return;
      preloaded = true;
      own.forEach((s) => itemsOf(s.id));
    }
    const ready = () => cfg.preloadWhen ? !!cfg.preloadWhen() : loggedIn();
    function schedulePreload(tries = 0) {
      if (preloaded || tries > 120)
        return;
      if (ready()) {
        const idleCb = win.requestIdleCallback || ((f) => setTimeout(f, 300));
        idleCb(() => preload(), { timeout: 2000 });
        return;
      }
      setTimeout(() => schedulePreload(tries + 1), 1000);
    }
    function registerKeys() {
      if (!Keys)
        return;
      Keys.add({ keys: "mod+k", input: true, overDialog: true, title: T.dialog, group: "Общее", when: loggedIn, run: () => isOpen() ? close() : open() });
      Keys.add({ keys: "/", title: T.search, group: "Общее", when: idle, run: () => open() });
      Keys.add({ keys: "?", title: T.keysTitle, group: "Общее", when: idle, run: () => openKeys() });
    }
    function mountTrigger() {
      const tr = cfg.trigger;
      if (tr === false || !tr || !tr.host)
        return;
      const label2 = Keys ? Keys.label("mod+k") : "";
      doc.querySelectorAll(tr.host).forEach((hdr) => {
        let b = $(".ui-pal-trigger", hdr);
        if (!b) {
          b = doc.createElement("button");
          b.type = "button";
          b.className = "ui-pal-trigger";
          hdr.appendChild(b);
        }
        b.innerHTML = `${ic("search", 16)}<span class="ui-pal-trigger__text">${esc3(T.triggerText)}</span>${label2 ? `<kbd>${esc3(label2)}</kbd>` : ""}`;
        b.title = (tr.title || T.triggerTitle) + (label2 ? ` (${label2})` : "");
        b.setAttribute("aria-label", T.triggerLabel);
        b.setAttribute("aria-keyshortcuts", Keys && Keys.isMac ? "Meta+K" : "Control+K");
        b.onclick = () => open();
      });
    }
    P.open = open;
    P.close = close;
    P.isOpen = isOpen;
    P.openKeys = openKeys;
    P.closeKeys = closeKeys;
    P.keysOpen = keysOpen;
    P.idle = idle;
    P.logic = logic;
    registerKeys();
    mountTrigger();
    schedulePreload();
    return P;
  }
  return P;
}

// src/controls/controls.mount.js
function seg(host, cfg = {}) {
  const doc = host.ownerDocument;
  const items = (cfg.items || []).map((it) => typeof it === "string" ? { value: it, label: it } : it);
  let value = cfg.value != null ? cfg.value : items[0] ? items[0].value : null;
  const el5 = doc.createElement("div");
  el5.className = "ui-seg";
  el5.setAttribute("role", "group");
  if (cfg.label)
    el5.setAttribute("aria-label", cfg.label);
  const buttons = new Map;
  for (const it of items) {
    const b = doc.createElement("button");
    b.type = "button";
    b.setAttribute("data-value", String(it.value));
    if (it.icon && /^[a-z0-9-]+$/.test(it.icon)) {
      const s = doc.createElement("span");
      s.innerHTML = icon(it.icon, { size: 14 });
      b.appendChild(s);
    }
    if (it.label != null && it.label !== "") {
      const t = doc.createElement("span");
      t.textContent = String(it.label);
      b.appendChild(t);
    }
    if (it.title || it.icon && !it.label) {
      b.title = it.title || String(it.value);
      b.setAttribute("aria-label", it.title || String(it.value));
    }
    b.addEventListener("click", () => set2(it.value, true));
    buttons.set(it.value, b);
    el5.appendChild(b);
  }
  function paint() {
    for (const [v, b] of buttons)
      b.setAttribute("aria-pressed", String(v === value));
  }
  function set2(v, fire = false) {
    if (!buttons.has(v))
      return;
    const changed = v !== value;
    value = v;
    paint();
    if (fire && changed && cfg.onChange)
      cfg.onChange(v);
  }
  paint();
  host.appendChild(el5);
  return { get: () => value, set: (v) => set2(v, false), el: el5 };
}

// src/controls/crumbs.core.js
var exports_crumbs_core = {};
__export(exports_crumbs_core, {
  partsFromPath: () => partsFromPath,
  hiddenParts: () => hiddenParts
});
function hiddenParts(widths, available, more = 0) {
  const n = widths.length;
  const w = widths.map((x) => Number.isFinite(x) && x > 0 ? x : 0);
  const total = w.reduce((a, b) => a + b, 0);
  if (n <= 3 || !Number.isFinite(available) || available <= 0 || total <= available)
    return [];
  const maxHide = n - 3;
  let sum = total;
  const hidden = [];
  for (let k = 1;k <= maxHide; k++) {
    sum -= w[k];
    hidden.push(k);
    if (sum + more <= available)
      return hidden;
  }
  return hidden;
}
function partsFromPath(path, hrefOf) {
  const segs = String(path == null ? "" : path).split("/").filter(Boolean);
  return segs.map((label2, i) => {
    const part = { label: label2 };
    if (hrefOf && i < segs.length - 1)
      part.href = hrefOf(segs.slice(0, i + 1).join("/"));
    return part;
  });
}

// src/controls/crumbs.mount.js
var modified = (e) => !!(e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button && e.button !== 0));
function crumbs(host, cfg = {}) {
  const doc = host.ownerDocument;
  const win = doc.defaultView || null;
  const mk = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls)
      n.className = cls;
    if (text != null)
      n.textContent = text;
    return n;
  };
  let parts = [];
  let hidden = [];
  let menuOpen = false;
  let destroyed = false;
  host.classList.add("ui-crumbs");
  host.setAttribute("aria-label", cfg.label || "Путь");
  if (host.tagName !== "NAV")
    host.setAttribute("role", "navigation");
  const list = mk("ol", "ui-crumbs__list");
  const menu = mk("div", "ui-panel ui-crumbs__menu");
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  host.append(list, menu);
  function nav(part, e) {
    if (cfg.onNav && part.href && modified(e))
      return;
    if (cfg.onNav) {
      if (part.href && e.preventDefault)
        e.preventDefault();
      cfg.onNav(part, e);
    }
  }
  function item(part, last) {
    const li = mk("li", "ui-crumbs__item");
    let node;
    if (last) {
      node = mk("span", "ui-crumbs__cur", part.label);
      node.setAttribute("aria-current", "page");
      node.title = part.label;
    } else if (part.href) {
      node = mk("a", "ui-crumbs__link", part.label);
      node.setAttribute("href", part.href);
      node.addEventListener("click", (e) => nav(part, e));
    } else
      node = mk("span", "ui-crumbs__text", part.label);
    li.appendChild(node);
    return li;
  }
  function closeMenu(focus) {
    if (!menuOpen)
      return;
    menuOpen = false;
    menu.hidden = true;
    const b = list.querySelector(".ui-crumbs__more");
    if (b) {
      b.setAttribute("aria-expanded", "false");
      if (focus && b.focus)
        b.focus();
    }
  }
  function openMenu() {
    const b = list.querySelector(".ui-crumbs__more");
    if (!b)
      return;
    while (menu.firstChild)
      menu.removeChild(menu.firstChild);
    for (const i of hidden) {
      const p = parts[i];
      const a = mk(p.href ? "a" : "span", "ui-crumbs__menu-item", p.label);
      a.setAttribute("role", "menuitem");
      if (p.href)
        a.setAttribute("href", p.href);
      a.setAttribute("tabindex", "-1");
      a.addEventListener("click", (e) => {
        closeMenu(false);
        nav(p, e);
      });
      menu.appendChild(a);
    }
    menuOpen = true;
    menu.hidden = false;
    b.setAttribute("aria-expanded", "true");
    menu.style.left = (b.offsetLeft || 0) + "px";
    const first = menu.children[0];
    if (first && first.focus)
      first.focus();
  }
  function paint() {
    while (list.firstChild)
      list.removeChild(list.firstChild);
    parts.forEach((p, i) => {
      if (hidden.includes(i)) {
        if (i === hidden[0]) {
          const li = mk("li", "ui-crumbs__item ui-crumbs__item--more");
          const b = mk("button", "ui-crumbs__more", "…");
          b.type = "button";
          b.setAttribute("aria-label", cfg.moreLabel || "Скрытые части пути");
          b.setAttribute("aria-haspopup", "menu");
          b.setAttribute("aria-expanded", "false");
          b.addEventListener("click", () => menuOpen ? closeMenu(false) : openMenu());
          li.appendChild(b);
          list.appendChild(li);
        }
        return;
      }
      list.appendChild(item(p, i === parts.length - 1));
    });
  }
  function layout() {
    closeMenu(false);
    hidden = [];
    paint();
    const avail = host.clientWidth || 0;
    if (!avail || parts.length <= 3)
      return;
    const items = list.children;
    const widths = [...items].map((li) => li.getBoundingClientRect().width);
    const probe = mk("li", "ui-crumbs__item ui-crumbs__item--more");
    probe.appendChild(mk("button", "ui-crumbs__more", "…"));
    list.appendChild(probe);
    const more = probe.getBoundingClientRect().width;
    list.removeChild(probe);
    hidden = hiddenParts(widths, avail, more);
    if (hidden.length)
      paint();
  }
  const onDocClick = (e) => {
    if (menuOpen && !host.contains(e.target))
      closeMenu(false);
  };
  const onKey = (e) => {
    if (!menuOpen)
      return;
    if (e.key === "Escape" || e.key === "Esc") {
      closeMenu(true);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const its = [...menu.children];
      const i = its.indexOf(doc.activeElement);
      const next = its[(i + (e.key === "ArrowDown" ? 1 : -1) + its.length) % its.length];
      if (next && next.focus) {
        if (e.preventDefault)
          e.preventDefault();
        next.focus();
      }
    }
  };
  if (doc.addEventListener) {
    doc.addEventListener("click", onDocClick);
    doc.addEventListener("keydown", onKey);
  }
  let ro = null;
  if (win && win.ResizeObserver) {
    ro = new win.ResizeObserver(() => {
      if (!destroyed)
        layout();
    });
    ro.observe(host);
  }
  function set2(next) {
    parts = (next || []).filter((p) => p && p.label != null).map((p) => ({ ...p, label: String(p.label) }));
    layout();
  }
  function destroy() {
    destroyed = true;
    if (ro)
      ro.disconnect();
    if (doc.removeEventListener) {
      doc.removeEventListener("click", onDocClick);
      doc.removeEventListener("keydown", onKey);
    }
    host.removeChild(list);
    host.removeChild(menu);
    host.classList.remove("ui-crumbs");
    host.removeAttribute("aria-label");
  }
  set2(cfg.parts);
  return { set: set2, destroy, el: host };
}

// src/tree/tree.core.js
var exports_tree_core = {};
__export(exports_tree_core, {
  visibleNodes: () => visibleNodes,
  toggleExpanded: () => toggleExpanded,
  stepFrom: () => stepFrom,
  serializeExpanded: () => serializeExpanded,
  parseExpanded: () => parseExpanded,
  parentOf: () => parentOf,
  keyAction: () => keyAction,
  ancestors: () => ancestors,
  MAX_EXPANDED: () => MAX_EXPANDED
});
var MAX_EXPANDED = 500;
var MAX_PATH = 1024;
var segments = (path) => String(path == null ? "" : path).split("/").filter(Boolean);
function parentOf(path) {
  const s = segments(path);
  s.pop();
  return s.join("/");
}
function ancestors(path) {
  const s = segments(path);
  const out = [];
  for (let i = 1;i < s.length; i++)
    out.push(s.slice(0, i).join("/"));
  return out;
}
function parseExpanded(raw) {
  let v = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
  }
  if (!Array.isArray(v))
    return [];
  const seen = new Set;
  for (const p of v) {
    if (typeof p !== "string" || !p || p.length > MAX_PATH)
      continue;
    seen.delete(p);
    seen.add(p);
  }
  return [...seen].slice(-MAX_EXPANDED);
}
function serializeExpanded(list) {
  return JSON.stringify(parseExpanded([...list || []]));
}
function toggleExpanded(list, path, on) {
  const rest = parseExpanded([...list || []]).filter((p) => p !== path);
  if (on && path)
    rest.push(path);
  return rest.slice(-MAX_EXPANDED);
}
function visibleNodes(state2, root = "") {
  const kids2 = state2.kids instanceof Map ? state2.kids : new Map;
  const open = state2.expanded instanceof Set ? state2.expanded : new Set(state2.expanded || []);
  const out = [];
  const walk = (dir, depth) => {
    for (const node of kids2.get(dir) || []) {
      const isDir = node.kind === "dir";
      const isOpen = isDir && open.has(node.path);
      out.push({ path: node.path, node, depth, parent: dir, isDir, expanded: isOpen, loaded: isDir && kids2.has(node.path) });
      if (isOpen)
        walk(node.path, depth + 1);
    }
  };
  walk(root, 1);
  return out;
}
function stepFrom(list, path, delta) {
  const i = list.findIndex((n) => n.path === path);
  if (i < 0)
    return null;
  return list[Math.max(0, Math.min(list.length - 1, i + delta))].path;
}
function keyAction(list, path, key) {
  const i = list.findIndex((n) => n.path === path);
  if (i < 0)
    return null;
  const cur = list[i];
  switch (key) {
    case "ArrowDown":
      return { action: "focus", path: list[Math.min(list.length - 1, i + 1)].path };
    case "ArrowUp":
      return { action: "focus", path: list[Math.max(0, i - 1)].path };
    case "Home":
      return { action: "focus", path: list[0].path };
    case "End":
      return { action: "focus", path: list[list.length - 1].path };
    case "ArrowRight":
      if (!cur.isDir)
        return { action: "focus", path };
      if (!cur.expanded)
        return { action: "expand", path };
      return list[i + 1] && list[i + 1].parent === cur.path ? { action: "focus", path: list[i + 1].path } : { action: "focus", path };
    case "ArrowLeft":
      if (cur.isDir && cur.expanded)
        return { action: "collapse", path };
      return cur.parent && list.some((n) => n.path === cur.parent) ? { action: "focus", path: cur.parent } : { action: "focus", path };
    case "Enter":
    case " ":
      return { action: "open", path };
    default:
      return null;
  }
}

// src/tree/tree.mount.js
var LABELS2 = { tree: "Дерево документов", loading: "Загрузка…", error: "Не удалось загрузить", retry: "Повторить", empty: "Пусто" };
function el5(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls)
    n.className = cls;
  if (text != null)
    n.textContent = text;
  return n;
}
function icon2(doc, cls, name) {
  const s = el5(doc, "span", cls);
  s.setAttribute("aria-hidden", "true");
  if (name)
    s.innerHTML = icon(name, { size: 16 });
  return s;
}
function safeStorage(given, kind) {
  if (given !== undefined)
    return given;
  try {
    return typeof window !== "undefined" ? window[kind] : null;
  } catch {
    return null;
  }
}
function setLevel(node, level) {
  if (node.style && node.style.setProperty)
    node.style.setProperty("--ui-tree-level", String(level));
  else if (node.style)
    node.style["--ui-tree-level"] = String(level);
}
function scrollParent(node, win) {
  for (let p = node;p && p.nodeType === 1; p = p.parentNode) {
    const oy = win && win.getComputedStyle ? win.getComputedStyle(p).overflowY : "";
    if (oy === "auto" || oy === "scroll" || oy === "overlay")
      return p;
  }
  return null;
}
var modified2 = (e) => !!(e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button && e.button !== 0));
function mount9(root, cfg = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView || null;
  const labels = { ...LABELS2, ...cfg.labels || {} };
  const storageKey = cfg.storageKey || "ui-tree";
  const local = safeStorage(cfg.storage, "localStorage");
  const session = safeStorage(cfg.session, "sessionStorage");
  const load2 = cfg.load;
  if (typeof load2 !== "function")
    throw new Error("UI.tree.mount: нужен cfg.load(path) → Promise<узлы>");
  let expanded = new Set(parseExpanded(readItem(local, storageKey)));
  let currentPath = cfg.current ? String(cfg.current) : "";
  let focusPath = null;
  let gen = 0;
  let destroyed = false;
  const kids2 = new Map;
  const status = new Map;
  const groups = new Map;
  const levels = new Map;
  const rendered = new Set;
  const pending = new Map;
  const rows = new Map;
  function readItem(store2, key) {
    try {
      return store2 ? store2.getItem(key) : null;
    } catch {
      return null;
    }
  }
  function writeItem(store2, key, value) {
    try {
      if (store2)
        store2.setItem(key, value);
    } catch {}
  }
  const persist = () => writeItem(local, storageKey, serializeExpanded(expanded));
  root.classList.add("ui-tree");
  root.setAttribute("role", "tree");
  root.setAttribute("aria-label", labels.tree);
  const rootUl = el5(doc, "ul");
  rootUl.setAttribute("role", "none");
  root.appendChild(rootUl);
  groups.set("", rootUl);
  levels.set("", 0);
  function clear2(node) {
    while (node.firstChild)
      node.removeChild(node.firstChild);
  }
  function forget(dir) {
    for (const node of kids2.get(dir) || []) {
      rows.delete(node.path);
      if (node.kind === "dir") {
        forget(node.path);
        groups.delete(node.path);
        levels.delete(node.path);
        rendered.delete(node.path);
      }
    }
  }
  function message(level, text, cls, retryFor) {
    const li = el5(doc, "li");
    li.setAttribute("role", "none");
    const m = el5(doc, "div", "ui-tree__msg" + (cls ? " " + cls : ""));
    setLevel(m, level);
    m.appendChild(el5(doc, "span", null, text));
    if (retryFor != null) {
      const b = el5(doc, "button", "ui-tree__retry", labels.retry);
      b.type = "button";
      b.addEventListener("click", () => {
        status.delete(retryFor);
        kids2.delete(retryFor);
        rendered.delete(retryFor);
        ensure(retryFor);
      });
      m.appendChild(b);
    } else
      m.setAttribute("role", "status");
    li.appendChild(m);
    return li;
  }
  function paintCurrent() {
    for (const [p, info] of rows) {
      if (p === currentPath && currentPath) {
        info.row.classList.add("is-current");
        info.row.setAttribute("aria-current", "page");
      } else {
        info.row.classList.remove("is-current");
        info.row.removeAttribute("aria-current");
      }
    }
  }
  function setStop(path) {
    const prev = rows.get(focusPath);
    if (prev)
      prev.row.setAttribute("tabindex", "-1");
    focusPath = path;
    const next = rows.get(path);
    if (next)
      next.row.setAttribute("tabindex", "0");
  }
  function ensureStop() {
    if (focusPath && rows.has(focusPath)) {
      rows.get(focusPath).row.setAttribute("tabindex", "0");
      return;
    }
    const first = rows.has(currentPath) ? currentPath : (visibleNodes({ kids: kids2, expanded })[0] || {}).path;
    focusPath = null;
    if (first != null)
      setStop(first);
  }
  function focusRow(path) {
    const info = rows.get(path);
    if (!info)
      return;
    setStop(path);
    if (info.row.focus)
      info.row.focus();
  }
  function buildItem(node, level) {
    const isDir = node.kind === "dir";
    const href = cfg.href ? cfg.href(node) : null;
    const li = el5(doc, "li");
    li.setAttribute("role", "none");
    const row = el5(doc, href ? "a" : "div", "ui-tree__row");
    if (href)
      row.setAttribute("href", href);
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(level));
    row.setAttribute("tabindex", node.path === focusPath ? "0" : "-1");
    row.setAttribute("title", node.name);
    setLevel(row, level);
    const chev = icon2(doc, "ui-tree__chev", isDir ? "chevron-right" : null);
    const open = isDir && expanded.has(node.path);
    const ico = icon2(doc, "ui-tree__ico", isDir ? open ? "folder-open" : "folder" : "file-text");
    row.append(chev, ico, el5(doc, "span", "ui-tree__name", node.name));
    if (typeof node.count === "number")
      row.appendChild(el5(doc, "span", "ui-tree__count", String(node.count)));
    if (isDir)
      row.setAttribute("aria-expanded", String(open));
    li.appendChild(row);
    if (isDir) {
      const g = el5(doc, "ul");
      g.setAttribute("role", "group");
      g.hidden = !open;
      li.appendChild(g);
      groups.set(node.path, g);
      levels.set(node.path, level);
    }
    rows.set(node.path, { row, ico, node, isDir });
    const activate = (e) => {
      if (isDir) {
        if (!cfg.onOpenDir) {
          setExpanded(node.path, !expanded.has(node.path));
          return;
        }
        if (!expanded.has(node.path))
          setExpanded(node.path, true);
        cfg.onOpenDir(node, e);
      } else if (cfg.onOpen)
        cfg.onOpen(node, e);
    };
    row.addEventListener("click", (e) => {
      setStop(node.path);
      if (href && modified2(e))
        return;
      if (href && (isDir ? true : cfg.onOpen)) {
        if (e.preventDefault)
          e.preventDefault();
      }
      activate(e);
    });
    row.addEventListener("focus", () => {
      if (focusPath !== node.path)
        setStop(node.path);
    });
    row.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey)
        return;
      const act = keyAction(visibleNodes({ kids: kids2, expanded }), node.path, e.key);
      if (!act)
        return;
      if (act.action === "open" && href) {
        if (e.key === " ") {
          if (e.preventDefault)
            e.preventDefault();
          if (row.click)
            row.click();
        }
        return;
      }
      if (e.preventDefault)
        e.preventDefault();
      if (act.action === "focus")
        focusRow(act.path);
      else if (act.action === "expand")
        setExpanded(act.path, true);
      else if (act.action === "collapse")
        setExpanded(act.path, false);
      else if (act.action === "open")
        activate(e);
    });
    if (isDir) {
      const c = rows.get(node.path);
      const chevEl = row.children[0];
      chevEl.addEventListener("click", (e) => {
        if (e.preventDefault)
          e.preventDefault();
        if (e.stopPropagation)
          e.stopPropagation();
        setStop(node.path);
        setExpanded(node.path, !expanded.has(node.path));
      });
      c.chev = chevEl;
    }
    if (node.path === currentPath && currentPath) {
      row.classList.add("is-current");
      row.setAttribute("aria-current", "page");
    }
    return li;
  }
  function renderGroup(dir) {
    const ul = groups.get(dir);
    if (!ul)
      return;
    forget(dir);
    clear2(ul);
    rendered.delete(dir);
    const level = (levels.get(dir) || 0) + 1;
    const st = status.get(dir);
    if (st === "loading")
      ul.appendChild(message(level, labels.loading, "is-loading"));
    else if (st === "error")
      ul.appendChild(message(level, labels.error, "is-error", dir));
    else {
      const list = kids2.get(dir) || [];
      if (!list.length)
        ul.appendChild(message(level, labels.empty, "is-empty"));
      for (const node of list)
        ul.appendChild(buildItem(node, level));
      rendered.add(dir);
    }
    ensureStop();
  }
  function renderTree(dir) {
    renderGroup(dir);
    const jobs = [];
    for (const node of kids2.get(dir) || []) {
      if (node.kind === "dir" && expanded.has(node.path))
        jobs.push(kids2.has(node.path) ? renderTree(node.path) : ensure(node.path));
    }
    return Promise.all(jobs);
  }
  const normalize = (list) => Array.isArray(list) ? list.filter((n) => n && typeof n.path === "string" && typeof n.name === "string") : [];
  function ensure(dir) {
    if (destroyed)
      return Promise.resolve();
    if (rendered.has(dir))
      return Promise.resolve();
    if (pending.has(dir))
      return pending.get(dir);
    const g = gen;
    const job = (async () => {
      if (!kids2.has(dir)) {
        status.set(dir, "loading");
        if (dir === "")
          root.setAttribute("aria-busy", "true");
        renderGroup(dir);
        let list;
        try {
          list = normalize(await load2(dir));
        } catch {
          list = null;
        }
        if (destroyed || g !== gen)
          return;
        if (dir === "")
          root.removeAttribute("aria-busy");
        if (list == null) {
          status.set(dir, "error");
          renderGroup(dir);
          return;
        }
        status.delete(dir);
        kids2.set(dir, list);
      }
      await renderTree(dir);
    })().finally(() => {
      if (pending.get(dir) === job)
        pending.delete(dir);
    });
    pending.set(dir, job);
    return job;
  }
  function setExpanded(path, on) {
    const info = rows.get(path);
    if (!info || !info.isDir || on === expanded.has(path))
      return Promise.resolve();
    expanded = new Set(toggleExpanded([...expanded], path, on));
    persist();
    info.row.setAttribute("aria-expanded", String(on));
    info.ico.innerHTML = icon(on ? "folder-open" : "folder", { size: 16 });
    const g = groups.get(path);
    if (g)
      g.hidden = !on;
    return on ? ensure(path) : Promise.resolve();
  }
  const scrollKey = storageKey + ":scroll";
  let scroller = null;
  let saveTimer = null;
  const onScroll = () => {
    if (saveTimer)
      return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (scroller)
        writeItem(session, scrollKey, String(Math.round(scroller.scrollTop)));
    }, 150);
  };
  function attachScroll() {
    scroller = scrollParent(root, win);
    if (scroller)
      scroller.addEventListener("scroll", onScroll, { passive: true });
  }
  function restoreScroll() {
    if (!scroller)
      return;
    const y = parseInt(readItem(session, scrollKey), 10);
    if (Number.isFinite(y) && y > 0)
      scroller.scrollTop = y;
  }
  function showRow(path) {
    const info = rows.get(path);
    if (!info)
      return;
    if (scroller) {
      const r = info.row.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      if (r.top < s.top || r.bottom > s.bottom)
        scroller.scrollTop += r.top - s.top - (s.height - r.height) / 2;
    } else if (info.row.scrollIntoView)
      info.row.scrollIntoView({ block: "nearest" });
  }
  async function reveal(path) {
    const p = String(path || "").split("/").filter(Boolean).join("/");
    if (!p)
      return false;
    await ensure("");
    for (const a of ancestors(p)) {
      if (destroyed)
        return false;
      const info = rows.get(a);
      if (!info || !info.isDir)
        return false;
      if (!expanded.has(a))
        await setExpanded(a, true);
      else
        await ensure(a);
    }
    if (destroyed || !rows.has(p))
      return false;
    showRow(p);
    return true;
  }
  function setCurrent(path) {
    currentPath = path ? String(path) : "";
    paintCurrent();
    return currentPath ? reveal(currentPath) : Promise.resolve(false);
  }
  async function refresh() {
    if (destroyed)
      return;
    const g = ++gen;
    const dirs = ["", ...[...kids2.keys()].filter((d) => d !== "" && expanded.has(d))];
    const results = await Promise.all(dirs.map((d) => Promise.resolve().then(() => load2(d)).then((v) => [d, normalize(v)], () => [d, null])));
    if (destroyed || g !== gen)
      return;
    const top = scroller ? scroller.scrollTop : 0;
    const keep = focusPath;
    const fresh = new Map(results.filter(([, v]) => v));
    for (const d of [...kids2.keys()])
      if (!dirs.includes(d))
        kids2.delete(d);
    for (const [d, v] of fresh)
      kids2.set(d, v);
    pending.clear();
    status.clear();
    rendered.clear();
    focusPath = keep;
    await renderTree("");
    if (scroller)
      scroller.scrollTop = top;
  }
  function destroy() {
    destroyed = true;
    gen++;
    if (saveTimer)
      clearTimeout(saveTimer);
    if (scroller && scroller.removeEventListener)
      scroller.removeEventListener("scroll", onScroll);
    clear2(root);
    root.classList.remove("ui-tree");
    for (const a of ["role", "aria-label", "aria-busy"])
      root.removeAttribute(a);
    kids2.clear();
    rows.clear();
    groups.clear();
    pending.clear();
    rendered.clear();
  }
  const ready = ensure("").then(async () => {
    if (destroyed)
      return;
    attachScroll();
    restoreScroll();
    if (currentPath)
      await reveal(currentPath);
  });
  return { reveal, refresh, setCurrent, destroy, ready, el: root };
}

// src/reveal/reveal.mount.js
var READY = "ui-reveal-ready";
function reduced2(win) {
  try {
    return !!(win && win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}
function list(root, selector) {
  return root && typeof root.querySelectorAll === "function" ? [...root.querySelectorAll(selector)] : [];
}
function show2(el6) {
  el6.classList.add("is-visible");
}
function delays(count, { stagger = 60, maxDelay = 360 } = {}) {
  const out = [];
  for (let i = 0;i < count; i++)
    out.push(Math.min(i * stagger, maxDelay));
  return out;
}
function reveal(root = globalThis.document, opts = {}) {
  const {
    selector = ".ui-reveal",
    stagger = 60,
    maxDelay = 360,
    threshold = 0.12,
    rootMargin = "0px 0px -40px 0px",
    win = globalThis.window,
    Observer = globalThis.IntersectionObserver
  } = opts;
  const doc = root && root.ownerDocument || root || globalThis.document;
  const els = list(root, selector).filter((el6) => !el6.classList.contains("is-visible"));
  if (!Observer || reduced2(win)) {
    els.forEach(show2);
    return { observer: null, count: els.length };
  }
  const html2 = doc && doc.documentElement;
  if (html2 && html2.classList)
    html2.classList.add(READY);
  const cascade = (list2) => {
    const d = delays(list2.length, { stagger, maxDelay });
    list2.forEach((el6, i) => {
      if (el6.style && typeof el6.style.setProperty === "function")
        el6.style.setProperty("--ui-reveal-delay", d[i] + "ms");
      show2(el6);
    });
  };
  const observer = new Observer((entries) => {
    const entering = entries.filter((e) => e.isIntersecting).map((e) => e.target);
    entering.forEach((el6) => observer.unobserve(el6));
    cascade(entering);
  }, { threshold, rootMargin });
  const vh = win && win.innerHeight || 0;
  const onScreen = vh ? els.filter((el6) => {
    if (typeof el6.getBoundingClientRect !== "function")
      return false;
    const r = el6.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh;
  }) : [];
  if (onScreen.length) {
    html2 && html2.offsetHeight;
    cascade(onScreen);
  }
  els.filter((el6) => !onScreen.includes(el6)).forEach((el6) => observer.observe(el6));
  return { observer, count: els.length, immediate: onScreen.length };
}
function images(root = globalThis.document, { selector = "img.ui-img", win = globalThis.window } = {}) {
  const doc = root && root.ownerDocument || root || globalThis.document;
  const html2 = doc && doc.documentElement;
  if (html2 && html2.classList && !reduced2(win))
    html2.classList.add(READY);
  let pending = 0;
  for (const img of list(root, selector)) {
    if (img.classList.contains("is-loaded"))
      continue;
    const box = img.parentNode;
    const done = () => {
      img.classList.add("is-loaded");
      if (box && box.classList)
        box.classList.remove("ui-skel");
    };
    if (img.complete && img.naturalWidth > 0) {
      done();
      continue;
    }
    pending++;
    if (box && box.classList)
      box.classList.add("ui-skel");
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  }
  return { pending };
}
function parallax(el6, { speed = 0.12, max = Infinity, win = globalThis.window } = {}) {
  const noop = { update() {}, destroy() {} };
  if (!el6 || !win || reduced2(win))
    return noop;
  const raf = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : (f) => setTimeout(f, 16);
  let queued = false;
  const update = () => {
    queued = false;
    const y = Math.min((win.scrollY || 0) * speed, max);
    el6.style.transform = `translate3d(0, ${-Math.round(y * 10) / 10}px, 0)`;
  };
  const onScroll = () => {
    if (!queued) {
      queued = true;
      raf(update);
    }
  };
  win.addEventListener("scroll", onScroll, { passive: true });
  update();
  return { update, destroy: () => win.removeEventListener("scroll", onScroll) };
}

// src/ring/ring.core.js
var exports_ring_core = {};
__export(exports_ring_core, {
  ringSvg: () => ringSvg,
  ringModel: () => ringModel,
  ringArcs: () => ringArcs,
  TONES: () => TONES2
});
var TONES2 = ["accent", "success", "warning", "danger", "info", "violet", "muted"];
var ORDER = ["accent", "info", "violet", "success", "warning", "danger"];
var r22 = (x) => +x.toFixed(2);
function ringArcs(segments2, total, { r = 60, gap = 4, stroke = 12 } = {}) {
  const C = 2 * Math.PI * r;
  const list2 = (segments2 || []).map((s) => ({ ...s, value: Number.isFinite(+s.value) && +s.value > 0 ? +s.value : 0 }));
  const sum = list2.reduce((a, s) => a + s.value, 0);
  const t = Number.isFinite(+total) && +total > 0 ? +total : 0;
  const max = Math.max(t, sum);
  const lone = list2.filter((s) => s.value > 0).length === 1 && t > 0 && sum >= t;
  let pos = 0;
  const arcs = [];
  for (const s of list2) {
    if (s.value <= 0 || max <= 0) {
      arcs.push({ ...s, frac: 0, start: pos, len: 0, deg: -90, show: false, C: r22(C) });
      continue;
    }
    const frac = s.value / max, span = frac * C;
    const len = lone ? r22(C) : Math.max(0, r22(span - gap - stroke));
    const start = lone ? 0 : r22(pos + (gap + stroke) / 2);
    arcs.push({ ...s, frac, start, len, deg: r22(-90 + start / C * 360), show: true, C: r22(C) });
    pos += span;
  }
  return { C: r22(C), sum, max, rest: t > sum ? t - sum : 0, pct: t > 0 ? sum / t * 100 : null, arcs };
}
function ringModel(cfg = {}, geom = {}) {
  const total = Number.isFinite(+cfg.total) && +cfg.total > 0 ? +cfg.total : 0;
  const segs = (cfg.segments || []).map((s, i) => ({ label: s.label == null ? "" : String(s.label), value: s.value, tone: TONES2.includes(s.tone) ? s.tone : ORDER[i % ORDER.length] }));
  const g = ringArcs(segs, total, geom);
  const f = (v) => fmt(v, cfg.format || "int");
  const rows = g.arcs.map((a) => ({ label: a.label, value: f(a.value), tone: a.tone, rest: false }));
  if (g.rest > 0)
    rows.push({ label: cfg.restLabel || "Не хватает", value: f(g.rest), tone: "muted", rest: true });
  const empty = total <= 0;
  const pctText = g.pct == null ? "" : Math.round(g.pct) + "%";
  const center = cfg.center ? { value: cfg.center.value == null ? pctText : String(cfg.center.value), label: cfg.center.label == null ? "" : String(cfg.center.label) } : { value: pctText, label: "" };
  const aria = empty ? cfg.empty && cfg.empty.text || "План не задан" : (center.label ? center.label + ": " : "") + center.value + " · " + rows.map((x) => `${x.label} ${x.value}`).join(", ");
  return { ...g, empty, rows, center, aria, total };
}
function ringSvg(model2, { size = 160, stroke = 12, animate = false } = {}) {
  const r = (size - stroke) / 2, c = size / 2;
  let out = `<svg class="ui-ring__svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${String(model2.aria).replace(/"/g, "&quot;")}">`;
  out += `<circle class="ui-ring__track${model2.empty ? " is-empty" : ""}" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${stroke}"/>`;
  if (!model2.empty) {
    model2.arcs.forEach((a, i) => {
      if (!a.show)
        return;
      out += `<circle class="ui-ring__arc ui-ring-t-${a.tone}${animate ? " is-draw" : ""}" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" ` + `stroke-dasharray="${a.len} ${a.C}" transform="rotate(${a.deg} ${c} ${c})" style="--ui-ring-len:${a.len}px;--ui-ring-i:${i}"/>`;
    });
  }
  return out + "</svg>";
}

// src/ring/ring.mount.js
function reduced3() {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    return false;
  }
}
function mount10(host, cfg = {}) {
  const doc = host.ownerDocument || document;
  let state2 = { ...cfg }, first = true;
  const mk = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls)
      n.className = cls;
    if (text != null)
      n.textContent = text;
    return n;
  };
  const root = mk("div", "ui-ring");
  const figure = mk("div", "ui-ring__figure");
  const svgBox = mk("div", "ui-ring__svgbox");
  const center = mk("div", "ui-ring__center");
  const cv = mk("div", "ui-ring__value"), cl = mk("div", "ui-ring__label");
  center.append(cv, cl);
  figure.append(svgBox, center);
  const side = mk("div", "ui-ring__side");
  root.append(figure, side);
  host.appendChild(root);
  function render2() {
    const size = state2.size || 160, stroke = state2.stroke || Math.max(8, Math.round(size / 13));
    const m = ringModel(state2, { r: (size - stroke) / 2, gap: 4, stroke });
    const legend = state2.legend === false ? false : state2.legend === "bottom" ? "bottom" : "right";
    root.className = "ui-ring" + (m.empty ? " is-empty" : "") + (legend === "bottom" ? " ui-ring--bottom" : "");
    figure.style.width = size + "px";
    figure.style.height = size + "px";
    svgBox.innerHTML = ringSvg(m, { size, stroke, animate: first && !reduced3() });
    first = false;
    cv.textContent = m.empty ? "" : m.center.value;
    cl.textContent = m.empty ? "" : m.center.label;
    cv.style.fontSize = Math.round(size * 0.19) + "px";
    while (side.firstChild)
      side.removeChild(side.firstChild);
    if (m.empty) {
      const e = state2.empty || {};
      side.appendChild(mk("div", "ui-ring__empty-text", e.text || "План не задан"));
      if (e.actionLabel) {
        const b = mk("button", "ui-btn ui-btn--sm ui-ring__action", e.actionLabel);
        b.type = "button";
        b.addEventListener("click", (ev) => {
          if (typeof e.onAction === "function")
            e.onAction(ev);
        });
        side.appendChild(b);
      }
      return;
    }
    if (legend === false)
      return;
    const ul = mk("ul", "ui-ring__legend");
    for (const row of m.rows) {
      const li = mk("li", "ui-ring__row" + (row.rest ? " is-rest" : ""));
      li.appendChild(mk("i", "ui-ring__dot ui-ring-t-" + row.tone));
      li.appendChild(mk("span", "ui-ring__name", row.label));
      li.appendChild(mk("b", "ui-ring__num", row.value));
      ul.appendChild(li);
    }
    side.appendChild(ul);
  }
  render2();
  return {
    el: root,
    set(patch = {}) {
      state2 = { ...state2, ...patch };
      render2();
    },
    destroy() {
      if (root.parentNode)
        root.parentNode.removeChild(root);
    }
  };
}

// src/barlist/barlist.core.js
var exports_barlist_core = {};
__export(exports_barlist_core, {
  initials: () => initials,
  barlistRows: () => barlistRows,
  TONES: () => TONES3
});
var TONES3 = ["accent", "blue", "violet", "green", "warn", "danger"];
var isNum = (v) => v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(Number(v));
var clamp01 = (v) => Math.min(1, Math.max(0, Number(v)));
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : 0;
function initials(label2) {
  const words2 = String(label2 == null ? "" : label2).match(/[\p{L}\p{N}]+/gu) || [];
  if (!words2.length)
    return "";
  const chars = (w) => Array.from(w);
  const out = words2.length === 1 ? chars(words2[0]).slice(0, 2).join("") : chars(words2[0])[0] + chars(words2[1])[0];
  return out.toUpperCase();
}
function barlistRows(items, { max = 5, sorted = true } = {}) {
  const list2 = Array.isArray(items) ? items.filter((it) => it && typeof it === "object") : [];
  const norm2 = list2.map((it, i) => {
    const value = Math.max(0, num(it.value));
    return { it, i, value };
  });
  const top = norm2.reduce((m, r) => Math.max(m, r.value), 0);
  if (sorted !== false)
    norm2.sort((a, b) => b.value - a.value || a.i - b.i);
  const rows = norm2.map(({ it, i, value }) => {
    const given = it.share != null && it.share !== "" && Number.isFinite(Number(it.share));
    const share = given ? clamp01(it.share) : top > 0 ? value / top : 0;
    const ghost = isNum(it.ghost) ? clamp01(it.ghost) : null;
    const label2 = it.label == null ? "" : String(it.label);
    return {
      id: it.id != null ? it.id : i,
      label: label2,
      sub: it.sub == null ? "" : String(it.sub),
      value,
      display: it.display != null ? String(it.display) : null,
      share,
      ghost,
      tone: TONES3.includes(it.tone) ? it.tone : "accent",
      badge: it.badge === true ? initials(label2) : it.badge != null && it.badge !== false && it.badge !== "" ? String(it.badge) : "",
      icon: typeof it.icon === "string" && /^[a-z0-9-]+$/.test(it.icon) ? it.icon : "",
      initials: initials(label2),
      item: it
    };
  });
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : rows.length;
  return { rows: rows.slice(0, limit), hidden: Math.max(0, rows.length - limit), total: rows.length };
}

// src/barlist/barlist.mount.js
function el6(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls)
    n.className = cls;
  if (text != null)
    n.textContent = text;
  return n;
}
var defaultFmt = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
function mount11(host, opts = {}) {
  const doc = host.ownerDocument;
  let state2 = { ...opts };
  let first = true;
  const root = el6(doc, "section", "ui-barlist ui-glass");
  host.appendChild(root);
  function render2() {
    const { rows, hidden, total } = barlistRows(state2.items, { max: state2.max == null ? 5 : state2.max, sorted: state2.sorted });
    root.textContent = "";
    root.className = "ui-barlist ui-glass" + (first ? " is-first" : "");
    if (state2.title || state2.sub || state2.more) {
      const head2 = el6(doc, "header", "ui-barlist__head");
      const t = el6(doc, "div", "ui-barlist__titles");
      if (state2.title)
        t.appendChild(el6(doc, "h3", "ui-barlist__title", state2.title));
      if (state2.sub)
        t.appendChild(el6(doc, "div", "ui-barlist__subtitle", state2.sub));
      head2.appendChild(t);
      if (state2.more && state2.more.label) {
        const b = el6(doc, "button", "ui-barlist__more", state2.more.label);
        b.type = "button";
        b.addEventListener("click", (e) => state2.more.onClick && state2.more.onClick(e));
        head2.appendChild(b);
      }
      root.appendChild(head2);
    }
    const list2 = el6(doc, "div", "ui-barlist__list");
    list2.setAttribute("role", "list");
    if (!rows.length) {
      list2.appendChild(el6(doc, "div", "ui-barlist__empty", state2.empty || "Нет данных"));
    }
    const fmt2 = typeof state2.fmt === "function" ? state2.fmt : defaultFmt;
    rows.forEach((r, i) => {
      const row = el6(doc, state2.onSelect ? "button" : "div", `ui-barlist__row ui-barlist--${r.tone}`);
      row.setAttribute("role", "listitem");
      if (state2.onSelect) {
        row.type = "button";
        row.addEventListener("click", () => state2.onSelect(r.item));
      }
      if (r.badge)
        row.appendChild(el6(doc, "span", "ui-barlist__badge", r.badge));
      else if (r.icon) {
        const ic = el6(doc, "span", "ui-barlist__ico");
        ic.innerHTML = icon(r.icon, { size: 16 });
        row.appendChild(ic);
      } else
        row.appendChild(el6(doc, "span", "ui-barlist__badge is-none"));
      const main = el6(doc, "span", "ui-barlist__main");
      main.appendChild(el6(doc, "span", "ui-barlist__label", r.label));
      if (r.sub)
        main.appendChild(el6(doc, "span", "ui-barlist__sub", r.sub));
      row.appendChild(main);
      row.appendChild(el6(doc, "span", "ui-barlist__value", r.display != null ? r.display : fmt2(r.value)));
      const track = el6(doc, "span", "ui-barlist__track");
      if (r.ghost != null && r.ghost > 0) {
        const ghost = el6(doc, "span", "ui-barlist__ghost");
        ghost.setAttribute("style", `width:${(r.ghost * 100).toFixed(2)}%;--ui-barlist-i:${i}`);
        track.appendChild(ghost);
      }
      const fill3 = el6(doc, "span", "ui-barlist__fill");
      fill3.setAttribute("style", `width:${(r.share * 100).toFixed(2)}%;--ui-barlist-i:${i}`);
      track.appendChild(fill3);
      row.appendChild(track);
      list2.appendChild(row);
    });
    root.appendChild(list2);
    first = false;
  }
  render2();
  return {
    el: root,
    set(patch = {}) {
      state2 = { ...state2, ...patch };
      render2();
    },
    destroy() {
      if (root.parentNode)
        root.parentNode.removeChild(root);
    }
  };
}

// src/feed/feed.core.js
var exports_feed_core = {};
__export(exports_feed_core, {
  relTime: () => relTime,
  plural: () => plural,
  normalizeStatus: () => normalizeStatus,
  normalizeOrder: () => normalizeOrder,
  normalizeActions: () => normalizeActions,
  groupTitle: () => groupTitle,
  fmtMoney: () => fmtMoney,
  feedRows: () => feedRows
});
function plural(n, forms) {
  const a = Math.abs(Math.trunc(Number(n) || 0)), m100 = a % 100, m10 = a % 10;
  if (m100 >= 11 && m100 <= 14)
    return forms[2];
  if (m10 === 1)
    return forms[0];
  if (m10 >= 2 && m10 <= 4)
    return forms[1];
  return forms[2];
}
var p2 = (n) => String(n).padStart(2, "0");
var hm = (d) => p2(d.getHours()) + ":" + p2(d.getMinutes());
var dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function relTime(at, now = Date.now()) {
  const t = new Date(at), n = new Date(now);
  if (Number.isNaN(t.getTime()) || Number.isNaN(n.getTime()))
    return "";
  const diff = n.getTime() - t.getTime();
  if (diff < 45000)
    return "только что";
  if (diff < 3600000)
    return Math.max(1, Math.round(diff / 60000)) + " мин";
  const days = Math.round((dayStart(n) - dayStart(t)) / 86400000);
  if (days === 0)
    return Math.floor(diff / 3600000) + " ч";
  if (days === 1)
    return "вчера " + hm(t);
  return p2(t.getDate()) + "." + p2(t.getMonth() + 1) + (t.getFullYear() !== n.getFullYear() ? "." + t.getFullYear() : "") + " " + hm(t);
}
var nbsp = " ";
function fmtMoney(v) {
  return String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp) + nbsp + "₽";
}
var ts = (at) => {
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : NaN;
};
var amt = (v) => v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
var normalizeOrder = (o) => o === "asc" || o === "given" ? o : "desc";
function normalizeStatus(st) {
  if (!st || typeof st !== "object" || st.text == null || st.text === "")
    return null;
  return { text: String(st.text), tone: st.tone === "success" ? "success" : "muted", icon: typeof st.icon === "string" ? st.icon : "" };
}
function normalizeActions(list2) {
  return (Array.isArray(list2) ? list2 : []).filter((a) => a && typeof a === "object" && a.label != null && a.label !== "").map((a) => ({ label: String(a.label), primary: !!a.primary, onClick: typeof a.onClick === "function" ? a.onClick : null }));
}
function groupTitle(n, type, spec = {}) {
  if (Array.isArray(spec.plural) && spec.plural.length === 3) {
    return n + " " + plural(n, spec.plural) + (Array.isArray(spec.verb) && spec.verb.length === 3 ? " " + plural(n, spec.verb) : "");
  }
  return n + " × " + (spec.label || type || "событий");
}
function feedRows(items, { now = Date.now(), limit = 8, windowSec = 60, types = {}, group = true, fmtAmount, order = "desc" } = {}) {
  const fm = typeof fmtAmount === "function" ? fmtAmount : fmtMoney;
  const list2 = (Array.isArray(items) ? items : []).filter((it) => it && typeof it === "object").map((it, i) => ({ it, i, t: ts(it.at) }));
  const ord = normalizeOrder(order);
  const dir = ord === "asc" ? -1 : 1;
  const cmp = (a, b) => Number.isNaN(a.t) - Number.isNaN(b.t) || dir * (b.t - a.t) || a.i - b.i;
  if (ord !== "given")
    list2.sort(cmp);
  const win = group && windowSec > 0 ? windowSec * 1000 : 0;
  const chains = [];
  const open = new Map;
  for (const e of list2) {
    const type = e.it.type;
    const prev = type != null && win && !Number.isNaN(e.t) ? open.get(type) : null;
    if (prev && Math.abs(prev.last - e.t) <= win) {
      prev.members.push(e);
      prev.last = e.t;
      continue;
    }
    const ch = { members: [e], last: e.t, first: e };
    chains.push(ch);
    if (type != null && win)
      open.set(type, ch);
  }
  if (ord !== "given")
    chains.sort((a, b) => cmp(a.first, b.first));
  const spec = (type) => type != null && types && types[type] || {};
  const rows = chains.map((ch) => {
    const head2 = ch.first.it, type = head2.type, sp = spec(type);
    const icon3 = (head2.icon || sp.icon || "") + "";
    const tone = head2.tone || sp.tone || "accent";
    const time = Number.isNaN(ch.first.t) ? "" : relTime(ch.first.t, now);
    if (ch.members.length === 1) {
      const shown2 = head2.timeDisplay != null && head2.timeDisplay !== "" ? String(head2.timeDisplay) : time;
      const a = amt(head2.amount);
      return {
        kind: "event",
        id: head2.id != null ? head2.id : ch.first.i,
        type: type == null ? "" : type,
        icon: icon3,
        tone,
        title: head2.title != null ? String(head2.title) : String(sp.label || ""),
        sub: head2.sub == null ? "" : String(head2.sub),
        at: head2.at,
        time: shown2,
        amount: a,
        amountDisplay: head2.amountDisplay != null ? String(head2.amountDisplay) : a != null ? fm(a) : "",
        href: typeof head2.href === "string" ? head2.href : "",
        lead: head2.lead != null && head2.lead !== "" ? head2.lead : null,
        status: normalizeStatus(head2.status),
        actions: normalizeActions(head2.actions)
      };
    }
    const evs = ch.members.map((m) => m.it), n = evs.length;
    const subs = evs.map((e) => e.sub == null ? "" : String(e.sub)).filter(Boolean);
    const shown = subs.slice(0, 3);
    const rest = n - shown.length;
    const sub = shown.join(" · ") + (shown.length && rest > 0 ? " · ещё " + rest : "");
    const amounts = evs.map((e) => amt(e.amount)).filter((v) => v != null);
    const sum = amounts.length ? amounts.reduce((s, v) => s + v, 0) : null;
    return {
      kind: "group",
      id: head2.id != null ? "g:" + head2.id : "g" + ch.first.i,
      type: type == null ? "" : type,
      count: n,
      icon: icon3,
      tone,
      title: groupTitle(n, type, sp),
      sub,
      at: head2.at,
      time,
      amount: sum,
      amountDisplay: sum != null ? fm(sum) : "",
      items: evs
    };
  });
  const lim = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : rows.length;
  return { rows: rows.slice(0, lim), hidden: Math.max(0, rows.length - lim), total: rows.length };
}

// src/feed/feed.mount.js
function el7(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls)
    n.className = cls;
  if (text != null)
    n.textContent = text;
  return n;
}
var TONES4 = ["accent", "blue", "violet", "green", "warn", "danger"];
var safeHref = (h) => typeof h === "string" && h && (/^(https?:|mailto:|tel:|\/|\.|#|\?)/i.test(h) || !/^[a-z][a-z0-9+.-]*:/i.test(h)) ? h : "";
function mount12(host, opts = {}) {
  const doc = host.ownerDocument;
  let state2 = { ...opts };
  const root = el7(doc, "section", "ui-feed ui-glass");
  host.appendChild(root);
  function render2() {
    const g = state2.group === false ? false : true;
    const windowSec = state2.group && state2.group.windowSec != null ? state2.group.windowSec : 60;
    const { rows } = feedRows(state2.items, { now: state2.now == null ? Date.now() : state2.now, limit: state2.limit == null ? 8 : state2.limit, windowSec, group: g, types: state2.types, fmtAmount: state2.fmtAmount, order: state2.order });
    root.textContent = "";
    if (state2.title || state2.sub || state2.more) {
      const head2 = el7(doc, "header", "ui-feed__head");
      const t = el7(doc, "div", "ui-feed__titles");
      if (state2.title)
        t.appendChild(el7(doc, "h3", "ui-feed__title", state2.title));
      if (state2.sub)
        t.appendChild(el7(doc, "div", "ui-feed__subtitle", state2.sub));
      head2.appendChild(t);
      if (state2.more && state2.more.label) {
        const b = el7(doc, "button", "ui-feed__more", state2.more.label);
        b.type = "button";
        b.addEventListener("click", (e) => state2.more.onClick && state2.more.onClick(e));
        head2.appendChild(b);
      }
      root.appendChild(head2);
    }
    const list2 = el7(doc, "div", "ui-feed__list");
    list2.setAttribute("role", "list");
    if (!rows.length)
      list2.appendChild(el7(doc, "div", "ui-feed__empty", state2.empty && state2.empty.text || "Событий пока нет"));
    for (const r of rows) {
      const href = r.kind === "event" ? safeHref(r.href) : "";
      const row = el7(doc, href ? "a" : "div", `ui-feed__row ui-feed--${TONES4.includes(r.tone) ? r.tone : "accent"}` + (r.kind === "group" ? " is-group" : ""));
      row.setAttribute("role", "listitem");
      if (href) {
        row.setAttribute("href", href);
        if (state2.newTab) {
          row.setAttribute("target", "_blank");
          row.setAttribute("rel", "noopener noreferrer");
        }
      }
      const hasLead = r.kind === "event" && r.lead != null;
      const ic = el7(doc, "span", "ui-feed__ico" + (hasLead ? " ui-feed__ico--lead" : ""));
      if (hasLead) {
        if (typeof r.lead === "string")
          ic.innerHTML = r.lead;
        else
          ic.appendChild(r.lead);
      } else if (r.icon && /^[a-z0-9-]+$/.test(r.icon))
        ic.innerHTML = icon(r.icon, { size: 16 });
      row.appendChild(ic);
      const main = el7(doc, "span", "ui-feed__main");
      main.appendChild(el7(doc, "span", "ui-feed__name", r.title));
      if (r.sub)
        main.appendChild(el7(doc, "span", "ui-feed__sub", r.sub));
      row.appendChild(main);
      const st = r.kind === "event" ? r.status : null;
      let side = row;
      if (st) {
        side = el7(doc, "span", "ui-feed__side");
        row.appendChild(side);
      }
      if (r.amountDisplay)
        side.appendChild(el7(doc, "span", "ui-feed__amount", r.amountDisplay));
      else if (r.time)
        side.appendChild(el7(doc, "span", "ui-feed__time", r.time));
      if (r.amountDisplay && r.time)
        side.appendChild(el7(doc, "span", "ui-feed__time is-under", r.time));
      if (st) {
        const sn = el7(doc, "span", `ui-feed__status ui-feed__status--${st.tone}`);
        if (st.icon && /^[a-z0-9-]+$/.test(st.icon)) {
          const si = el7(doc, "span", "ui-feed__status-ico");
          si.innerHTML = icon(st.icon, { size: 12 });
          sn.appendChild(si);
        }
        sn.appendChild(el7(doc, "span", "ui-feed__status-text", st.text));
        side.appendChild(sn);
      }
      const acts = r.kind === "event" ? r.actions : [];
      if (acts.length) {
        const item = el7(doc, "div", "ui-feed__item");
        item.setAttribute("role", "listitem");
        row.removeAttribute("role");
        item.appendChild(row);
        const bar = el7(doc, "div", "ui-feed__actions");
        for (const a of acts) {
          const b = el7(doc, "button", "ui-btn ui-btn--sm" + (a.primary ? " ui-btn--primary" : ""), a.label);
          b.type = "button";
          b.addEventListener("click", (e) => a.onClick && a.onClick(e));
          bar.appendChild(b);
        }
        item.appendChild(bar);
        list2.appendChild(item);
        continue;
      }
      list2.appendChild(row);
    }
    root.appendChild(list2);
  }
  render2();
  return {
    el: root,
    set(patch = {}) {
      state2 = { ...state2, ...patch };
      render2();
    },
    destroy() {
      if (root.parentNode)
        root.parentNode.removeChild(root);
    }
  };
}

// src/reader/reader.core.js
var exports_reader_core = {};
__export(exports_reader_core, {
  slug: () => slug,
  serializePrefs: () => serializePrefs,
  putPosition: () => putPosition,
  progressOf: () => progressOf,
  parsePrefs: () => parsePrefs,
  parsePositions: () => parsePositions,
  outline: () => outline,
  nestOutline: () => nestOutline,
  hasToc: () => hasToc,
  activeIndex: () => activeIndex,
  WIDTHS: () => WIDTHS,
  SIZES: () => SIZES,
  MAX_POSITIONS: () => MAX_POSITIONS,
  DEFAULTS: () => DEFAULTS
});
var SIZES = ["s", "m", "l"];
var WIDTHS = ["narrow", "wide"];
var DEFAULTS = { size: "m", width: "narrow" };
function slug(text, used = new Set) {
  let base3 = String(text == null ? "" : text).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  if (!base3)
    base3 = "section";
  let id = base3;
  for (let n = 2;used.has(id); n++)
    id = `${base3}-${n}`;
  used.add(id);
  return id;
}
function outline(headings, { min = 2, max = 3 } = {}) {
  const used = new Set;
  for (const h of headings || [])
    if (h && h.id)
      used.add(h.id);
  const out = [];
  (headings || []).forEach((h, index) => {
    if (!h || h.level < min || h.level > max)
      return;
    out.push({ id: h.id || slug(h.text, used), level: h.level, text: String(h.text == null ? "" : h.text).trim(), index });
  });
  return out;
}
function hasToc(items, minItems = 3) {
  return (items ? items.length : 0) >= minItems;
}
var pick = (list2, v, fallback) => list2.includes(v) ? v : fallback;
function parsePrefs(raw) {
  let o = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      o = null;
    }
  }
  if (!o || typeof o !== "object")
    o = {};
  return { size: pick(SIZES, o.size, DEFAULTS.size), width: pick(WIDTHS, o.width, DEFAULTS.width) };
}
function serializePrefs(p) {
  return JSON.stringify(parsePrefs(p));
}
function activeIndex(tops, scrollTop, offset = 0) {
  if (!tops || !tops.length)
    return -1;
  const line = scrollTop + offset;
  let idx = 0;
  for (let i = 0;i < tops.length; i++) {
    if (tops[i] <= line)
      idx = i;
    else
      break;
  }
  return idx;
}
function nestOutline(items) {
  const roots = [];
  const stack = [];
  for (const it of items || []) {
    const node = { ...it, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level)
      stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}
var MAX_POSITIONS = 200;
function progressOf(scrollTop, scrollHeight, clientHeight) {
  const range = scrollHeight - clientHeight;
  if (!(range > 0) || !Number.isFinite(scrollTop))
    return 0;
  return Math.max(0, Math.min(1, scrollTop / range));
}
function parsePositions(raw) {
  let o = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      o = null;
    }
  }
  const out = {};
  if (!o || typeof o !== "object" || Array.isArray(o))
    return out;
  for (const [k, v] of Object.entries(o)) {
    if (!k || !v || typeof v !== "object" || !Number.isFinite(v.ratio))
      continue;
    out[k] = { ratio: Math.max(0, Math.min(1, v.ratio)), id: typeof v.id === "string" ? v.id : "", at: Number.isFinite(v.at) ? v.at : 0 };
  }
  return out;
}
function putPosition(map, key, pos, now = Date.now(), max = MAX_POSITIONS) {
  const next = { ...parsePositions(map) };
  next[key] = { ratio: Math.max(0, Math.min(1, +pos.ratio || 0)), id: pos && typeof pos.id === "string" ? pos.id : "", at: now };
  const keys = Object.keys(next);
  if (keys.length > max) {
    keys.sort((a, b) => next[a].at - next[b].at || (a === key ? 1 : b === key ? -1 : 0));
    for (const k of keys.slice(0, keys.length - max))
      delete next[k];
  }
  return next;
}

// src/reader/reader.mount.js
var LABELS3 = {
  settings: "Настройки текста",
  toc: "Оглавление",
  size: "Размер текста",
  width: "Ширина колонки",
  sizes: ["мельче", "обычный", "крупнее"],
  widths: ["узко", "широко"],
  table: "Таблица, прокручивается"
};
var NARROW_MAX = 600;
var SIDE_TOC_MIN = { narrow: 1240, wide: 1480 };
function el8(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls)
    n.className = cls;
  if (text != null)
    n.textContent = text;
  return n;
}
function safeStorage2(given) {
  if (given !== undefined)
    return given;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
function scrollParent2(node, win) {
  for (let p = node.parentNode;p && p.nodeType === 1; p = p.parentNode) {
    const oy = win && win.getComputedStyle ? win.getComputedStyle(p).overflowY : "";
    if (oy === "auto" || oy === "scroll" || oy === "overlay")
      return p;
  }
  return null;
}
function mount13(root, cfg = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView || null;
  const labels = { ...LABELS3, ...cfg.labels || {} };
  const key = cfg.key || "ui-reader";
  const posKey = cfg.positionKey ? String(cfg.positionKey) : "";
  const noControls = cfg.controls === false;
  const tocHost = cfg.toc && typeof cfg.toc === "object" && cfg.toc.nodeType === 1 ? cfg.toc : null;
  const tocMode = cfg.toc === false ? "none" : tocHost ? "ext" : "builtin";
  const storage = safeStorage2(cfg.storage);
  let current;
  try {
    current = parsePrefs(storage ? storage.getItem(key) : null);
  } catch {
    current = parsePrefs(null);
  }
  root.classList.add("ui-reader");
  const ownContent = !cfg.content || cfg.content === root;
  const content = ownContent ? el8(doc, "div") : cfg.content;
  const body = el8(doc, "div", "ui-reader__body");
  const home = ownContent ? null : { parent: content.parentNode, next: content.nextSibling };
  if (ownContent) {
    while (root.firstChild)
      content.appendChild(root.firstChild);
    root.appendChild(body);
  } else {
    home.parent.insertBefore(body, content);
  }
  body.appendChild(content);
  content.classList.add("ui-prose");
  const toc = el8(doc, "nav", "ui-reader__toc");
  toc.setAttribute("aria-label", labels.toc);
  toc.hidden = true;
  if (tocMode === "builtin")
    body.appendChild(toc);
  else if (tocMode === "ext") {
    toc.classList.add("ui-reader__toc--ext");
    tocHost.appendChild(toc);
  }
  const ctl = el8(doc, "span", "ui-reader__ctl");
  const bar = cfg.controls || noControls ? null : el8(doc, "div", "ui-reader__bar");
  const btnSet = el8(doc, "button", "ui-btn ui-btn--ghost ui-btn--sm");
  const btnToc = el8(doc, "button", "ui-btn ui-btn--ghost ui-btn--sm");
  for (const [b, name, label2, act] of [[btnSet, "a-large-small", labels.settings, "settings"], [btnToc, "table-of-contents", labels.toc, "toc"]]) {
    b.type = "button";
    b.setAttribute("aria-label", label2);
    b.title = label2;
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("data-act", act);
    b.innerHTML = icon(name, { size: 16 });
  }
  btnToc.hidden = true;
  const popSet = el8(doc, "div", "ui-reader__pop");
  popSet.setAttribute("role", "group");
  popSet.setAttribute("aria-label", labels.settings);
  popSet.hidden = true;
  const popToc = el8(doc, "div", "ui-reader__pop ui-reader__pop--toc");
  popToc.setAttribute("role", "group");
  popToc.setAttribute("aria-label", labels.toc);
  popToc.hidden = true;
  ctl.append(btnSet);
  if (tocMode === "builtin")
    ctl.append(btnToc);
  ctl.append(popSet, popToc);
  if (noControls) {} else if (cfg.controls)
    cfg.controls.appendChild(ctl);
  else {
    bar.appendChild(ctl);
    root.insertBefore(bar, body);
  }
  const rowSize = el8(doc, "div", "ui-reader__row");
  rowSize.appendChild(el8(doc, "span", "ui-reader__label", labels.size));
  const rowWidth = el8(doc, "div", "ui-reader__row ui-reader__row--width");
  rowWidth.appendChild(el8(doc, "span", "ui-reader__label", labels.width));
  popSet.append(rowSize, rowWidth);
  const segSize = seg(rowSize, { label: labels.size, items: SIZES.map((v, i) => ({ value: v, label: labels.sizes[i] })), value: current.size, onChange: (v) => set2({ size: v }) });
  const segWidth = seg(rowWidth, { label: labels.width, items: WIDTHS.map((v, i) => ({ value: v, label: labels.widths[i] })), value: current.width, onChange: (v) => set2({ width: v }) });
  function apply() {
    root.setAttribute("data-ui-reader-size", current.size);
    root.setAttribute("data-ui-reader-width", current.width);
    segSize.set(current.size);
    segWidth.set(current.width);
  }
  function set2(next = {}) {
    current = parsePrefs({ ...current, ...next });
    apply();
    measure2();
    try {
      if (storage)
        storage.setItem(key, serializePrefs(current));
    } catch {}
    return { ...current };
  }
  apply();
  let open = null;
  let viewAnchor = null;
  function dockView(anchor) {
    anchor.parentNode.insertBefore(popSet, anchor.nextSibling);
    popSet.classList.add("ui-reader__pop--docked");
    popSet.style.top = (anchor.offsetTop || 0) + (anchor.offsetHeight || 0) + 6 + "px";
    popSet.style.left = "0px";
  }
  function undockView() {
    popSet.classList.remove("ui-reader__pop--docked");
    popSet.style.top = "";
    popSet.style.left = "";
    if (noControls) {
      if (popSet.parentNode)
        popSet.parentNode.removeChild(popSet);
    } else
      ctl.insertBefore(popSet, popToc);
  }
  function setOpen(which) {
    if (viewAnchor && which !== "view") {
      viewAnchor.setAttribute("aria-expanded", "false");
      viewAnchor = null;
      undockView();
    }
    open = which;
    popSet.hidden = which !== "settings" && which !== "view";
    popToc.hidden = which !== "toc";
    btnSet.setAttribute("aria-expanded", String(which === "settings"));
    btnToc.setAttribute("aria-expanded", String(which === "toc"));
  }
  function openView(anchor) {
    if (!anchor || !anchor.parentNode)
      return false;
    if (viewAnchor === anchor) {
      closeView();
      return false;
    }
    setOpen(null);
    viewAnchor = anchor;
    dockView(anchor);
    setOpen("view");
    anchor.setAttribute("aria-expanded", "true");
    const w = popSet.offsetWidth || 0;
    if (w)
      popSet.style.left = Math.max(0, (anchor.offsetLeft || 0) + (anchor.offsetWidth || 0) - w) + "px";
    return true;
  }
  function closeView() {
    if (viewAnchor) {
      const a = viewAnchor;
      setOpen(null);
      if (a.focus)
        a.focus();
    }
  }
  btnSet.addEventListener("click", () => setOpen(open === "settings" ? null : "settings"));
  btnToc.addEventListener("click", () => setOpen(open === "toc" ? null : "toc"));
  const onDocClick = (e) => {
    if (!open)
      return;
    const inside = ctl.contains(e.target) || popSet.contains(e.target) || viewAnchor && viewAnchor.contains(e.target);
    if (!inside)
      setOpen(null);
  };
  const onKey = (e) => {
    if (open && (e.key === "Escape" || e.key === "Esc")) {
      if (open === "view") {
        closeView();
        return;
      }
      const b = open === "toc" ? btnToc : btnSet;
      setOpen(null);
      if (b.focus)
        b.focus();
    }
  };
  if (doc.addEventListener) {
    doc.addEventListener("click", onDocClick);
    doc.addEventListener("keydown", onKey);
  }
  const scroller = cfg.scroller || scrollParent2(root, win);
  let items = [];
  let heads = [];
  let activeId = null;
  const linkSets = [];
  function scrollTopNow() {
    return scroller ? scroller.scrollTop : win ? win.scrollY || 0 : 0;
  }
  function topOf(h) {
    const r = h.getBoundingClientRect();
    return scroller ? r.top - scroller.getBoundingClientRect().top + scroller.scrollTop : r.top + (win ? win.scrollY || 0 : 0);
  }
  function reduced4() {
    return !!(win && win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function goTo(item) {
    const h = heads[item.index];
    if (!h)
      return;
    goHead(h);
    mark(item.id);
  }
  function goHead(h) {
    const top = Math.max(0, topOf(h) - (parseFloat(win && win.getComputedStyle ? win.getComputedStyle(h).scrollMarginTop : 0) || 0));
    const target = scroller || win;
    if (target && target.scrollTo)
      target.scrollTo({ top, behavior: reduced4() ? "auto" : "smooth" });
  }
  function buildList(host) {
    const list2 = el8(doc, "ul", "ui-reader__toc-list");
    const links = [];
    for (const it of items) {
      const li = el8(doc, "li");
      const a = el8(doc, "a", "ui-reader__toc-link" + (it.level >= 3 ? " is-sub" : ""), it.text);
      a.setAttribute("href", "#" + it.id);
      a.addEventListener("click", (e) => {
        if (e.preventDefault)
          e.preventDefault();
        setOpen(null);
        goTo(it);
      });
      li.appendChild(a);
      list2.appendChild(li);
      links.push([it.id, a]);
    }
    host.appendChild(list2);
    linkSets.push(links);
  }
  function mark(id) {
    activeId = id;
    for (const links of linkSets)
      for (const [lid, a] of links) {
        if (lid === id)
          a.setAttribute("aria-current", "location");
        else
          a.removeAttribute("aria-current");
      }
  }
  function clear2(node) {
    while (node.firstChild)
      node.removeChild(node.firstChild);
  }
  function refresh() {
    for (const t of [...content.querySelectorAll("table")]) {
      const p = t.parentNode;
      if (!p || p.classList && p.classList.contains("ui-prose__table"))
        continue;
      const wrap = el8(doc, "div", "ui-prose__table");
      wrap.setAttribute("tabindex", "0");
      wrap.setAttribute("role", "region");
      wrap.setAttribute("aria-label", labels.table);
      p.insertBefore(wrap, t);
      wrap.appendChild(t);
    }
    heads = [...content.querySelectorAll("h1, h2, h3, h4, h5")];
    const all = outline(heads.map((h) => ({ level: +h.tagName.slice(1), text: h.textContent.trim(), id: h.id || "" })), { min: 1, max: 5 });
    for (const it of all)
      if (!heads[it.index].id)
        heads[it.index].id = it.id;
    items = all.filter((it) => it.level === 2 || it.level === 3);
    const show3 = tocMode === "none" ? false : tocMode === "ext" ? items.length > 0 : hasToc(items);
    root.setAttribute("data-ui-reader-toc", tocMode === "ext" ? show3 ? "ext" : "off" : show3 ? "on" : "off");
    toc.hidden = !show3;
    clear2(toc);
    clear2(popToc);
    linkSets.length = 0;
    if (show3) {
      if (tocMode === "builtin") {
        toc.appendChild(el8(doc, "div", "ui-reader__toc-title", labels.toc));
        buildList(toc);
        buildList(popToc);
      } else
        buildList(toc);
    } else if (open === "toc")
      setOpen(null);
    syncButtons();
    onScroll();
  }
  let mode = "";
  function syncButtons() {
    btnToc.hidden = tocMode !== "builtin" || !(items.length && hasToc(items)) || mode === "wide";
  }
  function measure2() {
    const w = root.clientWidth || 0;
    if (!w)
      return;
    const next = w <= NARROW_MAX ? "narrow" : w >= SIDE_TOC_MIN[current.width] ? "wide" : "mid";
    if (next === mode)
      return;
    mode = next;
    ctl.setAttribute("data-ui-reader-mode", mode);
    popSet.setAttribute("data-ui-reader-mode", mode);
    syncButtons();
    if (open === "toc" && mode === "wide")
      setOpen(null);
  }
  let ro = null;
  if (win && win.ResizeObserver) {
    ro = new win.ResizeObserver(measure2);
    ro.observe(root);
  }
  measure2();
  const posStorage = posKey ? storage : null;
  const posStoreKey = key + ":positions";
  function progress() {
    if (scroller)
      return progressOf(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight);
    const de = doc.documentElement;
    return progressOf(win ? win.scrollY || 0 : 0, de ? de.scrollHeight : 0, win ? win.innerHeight : 0);
  }
  function nearestHeadingId() {
    if (!heads.length)
      return "";
    const st = scrollTopNow();
    const view = scroller ? scroller.clientHeight : win ? win.innerHeight : 0;
    const i = activeIndex(heads.map(topOf), st, Math.min(view * 0.25, 160) + 1);
    return i >= 0 && heads[i].id ? heads[i].id : "";
  }
  function readPositions() {
    try {
      return parsePositions(posStorage ? posStorage.getItem(posStoreKey) : null);
    } catch {
      return {};
    }
  }
  function savePosition() {
    saveTimer = 0;
    if (!posStorage)
      return;
    const next = putPosition(readPositions(), posKey, { ratio: progress(), id: nearestHeadingId() });
    try {
      posStorage.setItem(posStoreKey, JSON.stringify(next));
    } catch {}
  }
  let saveTimer = 0;
  function scheduleSave() {
    if (posStorage && !saveTimer)
      saveTimer = setTimeout(savePosition, 400);
  }
  function savedPosition() {
    const p = posStorage ? readPositions()[posKey] : null;
    return p ? { ratio: p.ratio, id: p.id } : null;
  }
  function restore() {
    const p = savedPosition();
    if (!p)
      return false;
    const target = scroller || win;
    const full = scroller ? scroller.scrollHeight : doc.documentElement ? doc.documentElement.scrollHeight : 0;
    const view = scroller ? scroller.clientHeight : win ? win.innerHeight : 0;
    if (full - view > 0 && target) {
      const top = Math.round(p.ratio * (full - view));
      if (target.scrollTo)
        target.scrollTo({ top, behavior: "auto" });
      else if (scroller)
        scroller.scrollTop = top;
      return true;
    }
    return p.id ? scrollTo(p.id) : false;
  }
  function scrollTo(id) {
    const h = heads.find((x) => x.id === id);
    if (!h)
      return false;
    goHead(h);
    const it = items.find((x) => x.id === id);
    if (it)
      mark(id);
    return true;
  }
  function outlineTree({ min = 2, max = 3 } = {}) {
    return nestOutline(outline(heads.map((h) => ({ level: +h.tagName.slice(1), text: h.textContent.trim(), id: h.id || "" })), { min, max }));
  }
  let raf = 0;
  function update() {
    raf = 0;
    if (cfg.onProgress)
      cfg.onProgress(progress());
    scheduleSave();
    if (!items.length)
      return;
    const st = scrollTopNow();
    const view = scroller ? scroller.clientHeight : win ? win.innerHeight : 0;
    const full = scroller ? scroller.scrollHeight : doc.documentElement ? doc.documentElement.scrollHeight : 0;
    const tops = items.map((it) => topOf(heads[it.index]));
    let i = activeIndex(tops, st, Math.min(view * 0.25, 160) + 1);
    if (view && full && st + view >= full - 2 && st > 0)
      i = items.length - 1;
    if (i >= 0 && items[i].id !== activeId)
      mark(items[i].id);
  }
  function onScroll() {
    if (raf)
      return;
    if (win && win.requestAnimationFrame)
      raf = win.requestAnimationFrame(update);
    else
      update();
  }
  const scrollTarget = scroller || win;
  if (scrollTarget && scrollTarget.addEventListener)
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
  const onHide = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      savePosition();
    }
  };
  if (posStorage && win && win.addEventListener)
    win.addEventListener("pagehide", onHide);
  refresh();
  function destroy() {
    if (scrollTarget && scrollTarget.removeEventListener)
      scrollTarget.removeEventListener("scroll", onScroll);
    if (doc.removeEventListener) {
      doc.removeEventListener("click", onDocClick);
      doc.removeEventListener("keydown", onKey);
    }
    if (ro)
      ro.disconnect();
    if (raf && win && win.cancelAnimationFrame)
      win.cancelAnimationFrame(raf);
    onHide();
    if (win && win.removeEventListener)
      win.removeEventListener("pagehide", onHide);
    if (viewAnchor) {
      viewAnchor.setAttribute("aria-expanded", "false");
      viewAnchor = null;
      undockView();
    }
    if (ctl.parentNode)
      ctl.parentNode.removeChild(ctl);
    if (bar && bar.parentNode)
      bar.parentNode.removeChild(bar);
    if (toc.parentNode)
      toc.parentNode.removeChild(toc);
    if (ownContent) {
      while (content.firstChild)
        root.insertBefore(content.firstChild, body);
    } else if (home.parent)
      home.parent.insertBefore(content, body);
    if (body.parentNode)
      body.parentNode.removeChild(body);
    content.classList.remove("ui-prose");
    root.classList.remove("ui-reader");
    for (const a of ["size", "width", "toc"])
      root.removeAttribute("data-ui-reader-" + a);
  }
  return { refresh, destroy, prefs: () => ({ ...current }), set: set2, openView, closeView, outline: outlineTree, scrollTo, progress, savedPosition, restore };
}

// src/capture/capture.core.js
var exports_capture_core = {};
__export(exports_capture_core, {
  targetSizes: () => targetSizes,
  normalize: () => normalize,
  isImage: () => isImage,
  formatBytes: () => formatBytes,
  fitSize: () => fitSize,
  clampQuality: () => clampQuality,
  LABELS: () => LABELS4,
  DEFAULTS: () => DEFAULTS2
});
var DEFAULTS2 = { capture: "environment", maxSide: 1600, thumbSide: 480, quality: 0.8 };
var LABELS4 = {
  take: "Сделать снимок",
  retake: "Переснять",
  remove: "Убрать",
  busy: "Обрабатываю снимок…",
  notImage: "Выбран не снимок",
  failed: "Не удалось обработать снимок",
  alt: "Снимок"
};
var pos = (v) => Number.isFinite(+v) && +v > 0;
function fitSize(width, height, maxSide) {
  if (!pos(width) || !pos(height))
    return { width: 1, height: 1, scale: 1 };
  const w = +width, h = +height;
  const scale = pos(maxSide) && Math.max(w, h) > +maxSide ? +maxSide / Math.max(w, h) : 1;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}
function targetSizes(width, height, { maxSide = DEFAULTS2.maxSide, thumbSide = DEFAULTS2.thumbSide } = {}) {
  const full = fitSize(width, height, maxSide);
  const thumb = fitSize(full.width, full.height, thumbSide);
  return { full, thumb };
}
function clampQuality(q) {
  const n = +q;
  if (!Number.isFinite(n) || n <= 0)
    return DEFAULTS2.quality;
  return Math.min(1, Math.max(0.1, n));
}
function formatBytes(n) {
  const v = Number.isFinite(+n) && +n > 0 ? +n : 0;
  const nb = " ";
  if (v < 1024)
    return `${Math.round(v)}${nb}Б`;
  const kb = v / 1024;
  if (kb < 1024)
    return `${kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10}`.replace(".", ",") + `${nb}КБ`;
  const mb = kb / 1024;
  return `${Math.round(mb * 10) / 10}`.replace(".", ",") + `${nb}МБ`;
}
function isImage(file) {
  if (!file)
    return false;
  if (typeof file.type === "string" && file.type)
    return file.type.startsWith("image/");
  return /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(String(file.name || ""));
}
function normalize(cfg = {}) {
  const capture = cfg.capture === undefined ? DEFAULTS2.capture : cfg.capture === "user" || cfg.capture === "environment" ? cfg.capture : "";
  const maxSide = pos(cfg.maxSide) ? Math.round(+cfg.maxSide) : DEFAULTS2.maxSide;
  const thumbSide = pos(cfg.thumbSide) ? Math.min(Math.round(+cfg.thumbSide), maxSide) : Math.min(DEFAULTS2.thumbSide, maxSide);
  return { capture, maxSide, thumbSide, quality: clampQuality(cfg.quality === undefined ? DEFAULTS2.quality : cfg.quality), labels: { ...LABELS4, ...cfg.labels || {} } };
}

// src/capture/capture.mount.js
function fail(code, cause) {
  const e = new Error(code === "not-image" ? "файл не снимок" : code === "decode" ? "снимок не раскодировался" : "снимок не сохранился в JPEG");
  e.code = code;
  e.cause = cause;
  return e;
}
function browserEnv(doc) {
  const makeUrl = (b) => URL.createObjectURL(b);
  return {
    async decode(file) {
      if (typeof createImageBitmap === "function") {
        try {
          const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
          return { source: bmp, width: bmp.width, height: bmp.height, release() {
            if (bmp.close)
              bmp.close();
          } };
        } catch (e) {}
      }
      const url = makeUrl(file);
      const img = new Image;
      await new Promise((ok, no) => {
        img.onload = ok;
        img.onerror = () => no(new Error("img"));
        img.src = url;
      });
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, release() {
        URL.revokeObjectURL(url);
      } };
    },
    draw(source, w, h) {
      const c = doc.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, w, h);
      return c;
    },
    toBlob: (canvas, q) => new Promise((ok, no) => canvas.toBlob((b) => b ? ok(b) : no(new Error("toBlob")), "image/jpeg", q)),
    url: { create: makeUrl, revoke: (u) => URL.revokeObjectURL(u) }
  };
}
async function processFile(file, opts, env) {
  let dec2;
  try {
    dec2 = await env.decode(file);
  } catch (e) {
    throw fail("decode", e);
  }
  try {
    if (!(dec2.width > 0 && dec2.height > 0))
      throw fail("decode");
    const { full, thumb } = targetSizes(dec2.width, dec2.height, opts);
    const canvas = env.draw(dec2.source, full.width, full.height);
    const blob = await env.toBlob(canvas, opts.quality);
    const same = thumb.width === full.width && thumb.height === full.height;
    const thumbBlob = same ? blob : await env.toBlob(env.draw(canvas, thumb.width, thumb.height), opts.quality);
    return { blob, thumb: thumbBlob, width: full.width, height: full.height, thumbWidth: thumb.width, thumbHeight: thumb.height, bytes: blob.size, thumbBytes: thumbBlob.size };
  } catch (e) {
    throw e && e.code ? e : fail("encode", e);
  } finally {
    if (dec2.release)
      dec2.release();
  }
}
function mount14(host, cfg = {}) {
  const doc = host.ownerDocument || document;
  const o = normalize(cfg);
  const L = o.labels;
  const env = cfg.env || browserEnv(doc);
  const mk = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls)
      n.className = cls;
    if (text != null)
      n.textContent = text;
    return n;
  };
  const ic = (name) => {
    const s = mk("span", "ui-capture__ic");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = icon(name, { size: 18 });
    return s;
  };
  const button2 = (cls, name, text) => {
    const b = mk("button", "ui-btn " + cls);
    b.setAttribute("type", "button");
    b.append(ic(name), mk("span", "ui-capture__text", text));
    return b;
  };
  const root = mk("div", "ui-capture");
  const input = mk("input", "ui-capture__input");
  input.setAttribute("type", "file");
  input.setAttribute("accept", "image/*");
  if (o.capture)
    input.setAttribute("capture", o.capture);
  input.hidden = true;
  input.setAttribute("tabindex", "-1");
  input.setAttribute("aria-hidden", "true");
  const empty = mk("div", "ui-capture__empty");
  const take = button2("ui-btn--primary ui-capture__take", "camera", cfg.label || L.take);
  const hint = mk("div", "ui-capture__hint", cfg.hint || "");
  hint.hidden = !cfg.hint;
  empty.append(take, hint);
  const result = mk("div", "ui-capture__result");
  result.hidden = true;
  const frame = mk("div", "ui-capture__frame");
  const img = mk("img", "ui-capture__img");
  img.setAttribute("alt", L.alt);
  img.setAttribute("decoding", "async");
  frame.appendChild(img);
  const meta = mk("div", "ui-capture__meta");
  const actions = mk("div", "ui-capture__actions");
  const retake = button2("ui-btn--sm ui-capture__retake", "rotate-ccw", L.retake);
  const remove = button2("ui-btn--sm ui-btn--ghost ui-capture__remove", "x", L.remove);
  actions.append(retake, remove);
  result.append(frame, meta, actions);
  const status = mk("div", "ui-capture__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const error = mk("div", "ui-capture__error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  root.append(input, empty, result, status, error);
  root.setAttribute("data-state", "empty");
  host.appendChild(root);
  let state2 = "empty", ownUrl = null, seq2 = 0, destroyed = false, hasImg = false;
  function dropOwnUrl() {
    if (ownUrl) {
      env.url.revoke(ownUrl);
      ownUrl = null;
    }
  }
  function setState(next) {
    state2 = next;
    root.setAttribute("data-state", next);
    const ready = next === "ready" || next === "busy" && hasImg;
    empty.hidden = ready;
    result.hidden = !ready;
    const busy = next === "busy";
    for (const b of [take, retake, remove]) {
      b.disabled = busy;
      if (busy)
        b.setAttribute("aria-disabled", "true");
      else
        b.removeAttribute("aria-disabled");
    }
    status.textContent = busy ? L.busy : "";
    if (busy)
      root.setAttribute("aria-busy", "true");
    else
      root.removeAttribute("aria-busy");
  }
  function showError(err) {
    error.hidden = false;
    error.textContent = err.code === "not-image" ? L.notImage : L.failed;
  }
  function hideError() {
    error.hidden = true;
    error.textContent = "";
  }
  function show3(url, w, h, text) {
    hasImg = true;
    img.setAttribute("src", url);
    if (w && h) {
      img.setAttribute("width", w);
      img.setAttribute("height", h);
    } else {
      img.removeAttribute("width");
      img.removeAttribute("height");
    }
    meta.textContent = text || "";
    meta.hidden = !text;
  }
  function reset() {
    seq2++;
    dropOwnUrl();
    hasImg = false;
    img.removeAttribute("src");
    meta.textContent = "";
    hideError();
    setState("empty");
  }
  async function run(file) {
    const my = ++seq2;
    hideError();
    setState("busy");
    let done;
    try {
      done = await processFile(file, o, env);
    } catch (err) {
      if (my !== seq2 || destroyed)
        return;
      setState(hasImg ? "ready" : "empty");
      showError(err);
      if (typeof cfg.onError === "function")
        cfg.onError(err);
      return;
    }
    if (my !== seq2 || destroyed)
      return;
    dropOwnUrl();
    ownUrl = env.url.create(done.thumb);
    show3(ownUrl, done.thumbWidth, done.thumbHeight, `${done.width}×${done.height} · ${formatBytes(done.bytes)}`);
    setState("ready");
    if (typeof cfg.onPhoto === "function")
      cfg.onPhoto({ blob: done.blob, thumb: done.thumb, width: done.width, height: done.height, bytes: done.bytes, thumbBytes: done.thumbBytes, previewUrl: ownUrl });
  }
  const open = () => {
    if (state2 !== "busy")
      input.click();
  };
  const onChange = () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file)
      return;
    if (!isImage(file)) {
      const err = fail("not-image");
      showError(err);
      if (typeof cfg.onError === "function")
        cfg.onError(err);
      return;
    }
    run(file);
  };
  const onRemove = () => {
    reset();
    if (typeof cfg.onClear === "function")
      cfg.onClear();
  };
  input.addEventListener("change", onChange);
  take.addEventListener("click", open);
  retake.addEventListener("click", open);
  remove.addEventListener("click", onRemove);
  function set2(value) {
    if (destroyed)
      return;
    if (value && value.previewUrl) {
      seq2++;
      dropOwnUrl();
      hideError();
      show3(value.previewUrl, 0, 0, "");
      setState("ready");
    } else
      reset();
  }
  set2(cfg.value);
  return {
    el: root,
    clear() {
      if (!destroyed)
        reset();
    },
    set: set2,
    destroy() {
      if (destroyed)
        return;
      reset();
      destroyed = true;
      input.removeEventListener("change", onChange);
      take.removeEventListener("click", open);
      retake.removeEventListener("click", open);
      remove.removeEventListener("click", onRemove);
      if (root.parentNode)
        root.parentNode.removeChild(root);
    }
  };
}

// src/compare/compare.core.js
var exports_compare_core = {};
__export(exports_compare_core, {
  sideModel: () => sideModel,
  ratioOf: () => ratioOf,
  frameLabel: () => frameLabel,
  SIDES: () => SIDES2,
  DEFAULT_RATIO: () => DEFAULT_RATIO
});
var SIDES2 = ["left", "right"];
var DEFAULT_RATIO = "3 / 4";
function ratioOf(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0)
    return String(v);
  const s = String(v == null ? "" : v).trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m && +m[1] > 0 && +m[2] > 0)
    return `${m[1]} / ${m[2]}`;
  if (/^\d+(?:\.\d+)?$/.test(s) && +s > 0)
    return s;
  return DEFAULT_RATIO;
}
function sideModel(side, fallbackLabel = "") {
  const s = side || {};
  const src = typeof s.src === "string" ? s.src.trim() : "";
  return { src, label: s.label == null ? fallbackLabel : String(s.label), empty: s.empty == null ? "Нет снимка" : String(s.empty), has: src !== "" };
}
function frameLabel(model2) {
  const name = model2.label || "Снимок";
  return model2.has ? `${name}: открыть снимок` : `${name}: снимка нет`;
}

// src/compare/compare.mount.js
function mount15(host, cfg = {}) {
  const doc = host.ownerDocument || document;
  let state2 = { ...cfg };
  const mk = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls)
      n.className = cls;
    if (text != null)
      n.textContent = text;
    return n;
  };
  const root = mk("div", "ui-compare");
  const cells = {};
  for (const side of SIDES2) {
    const cell = mk("figure", "ui-compare__cell");
    const frame = mk("button", "ui-compare__frame");
    frame.setAttribute("type", "button");
    const img = mk("img", "ui-compare__img");
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    img.setAttribute("alt", "");
    const blank = mk("span", "ui-compare__blank");
    const bi = mk("span", "ui-compare__blank-ic");
    bi.setAttribute("aria-hidden", "true");
    bi.innerHTML = icon("image", { size: 24 });
    const bt = mk("span", "ui-compare__blank-text");
    blank.append(bi, bt);
    frame.append(img, blank);
    const cap = mk("figcaption", "ui-compare__label");
    cell.append(frame, cap);
    root.appendChild(cell);
    frame.addEventListener("click", (ev) => {
      if (typeof state2.onOpen === "function")
        state2.onOpen(side, ev);
    });
    cells[side] = { cell, frame, img, blank, bt, cap };
  }
  host.appendChild(root);
  function render2() {
    const ratio = ratioOf(state2.ratio);
    if (root.style.setProperty)
      root.style.setProperty("--ui-compare-ratio", ratio);
    else
      root.style["--ui-compare-ratio"] = ratio;
    for (const side of SIDES2) {
      const m = sideModel(state2[side], side === "left" ? "Эталон" : "Результат");
      const c = cells[side];
      c.cell.setAttribute("data-has", m.has ? "true" : "false");
      c.frame.setAttribute("aria-label", frameLabel(m));
      if (m.has)
        c.img.setAttribute("src", m.src);
      else
        c.img.removeAttribute("src");
      c.img.hidden = !m.has;
      c.blank.hidden = m.has;
      c.bt.textContent = m.empty;
      c.cap.textContent = m.label;
    }
  }
  render2();
  return {
    el: root,
    set(patch = {}) {
      state2 = { ...state2, ...patch };
      render2();
    },
    destroy() {
      if (root.parentNode)
        root.parentNode.removeChild(root);
    }
  };
}

// src/month/month.core.js
var exports_month_core = {};
__export(exports_month_core, {
  weekdayLabels: () => weekdayLabels,
  validISO: () => validISO,
  todayISO: () => todayISO,
  tabStop: () => tabStop,
  shiftMonth: () => shiftMonth,
  safeColor: () => safeColor,
  normalizeWeekStart: () => normalizeWeekStart,
  moveFocus: () => moveFocus,
  monthHeading: () => monthHeading,
  markMap: () => markMap,
  isoOf: () => isoOf,
  gridWeeks: () => gridWeeks,
  dots: () => dots,
  dayLabel: () => dayLabel
});
var dow2 = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
var p22 = (n) => String(n).padStart(2, "0");
var isoOf = (y, m, d) => `${y}-${p22(m)}-${p22(d)}`;
var validISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
var WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
var MONTHS2 = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
var MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
var normalizeWeekStart = (w) => w === 0 || w === "0" ? 0 : 1;
function weekdayLabels(weekStart = 1) {
  const s = normalizeWeekStart(weekStart);
  return Array.from({ length: 7 }, (_, i) => WEEKDAYS[(s + i) % 7]);
}
var monthHeading = (year, month) => `${MONTHS2[month - 1]} ${year}`;
var dayLabel = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
function gridWeeks(year, month, weekStart = 1) {
  const s = normalizeWeekStart(weekStart);
  const first = isoOf(year, month, 1);
  const lead = (dow2(first) - s + 7) % 7;
  const start = addDaysISO(first, -lead);
  const weeks = [];
  for (let w = 0;w < 6; w++) {
    const row = [];
    for (let d = 0;d < 7; d++) {
      const iso = addDaysISO(start, w * 7 + d);
      row.push({ iso, day: Number(iso.slice(8, 10)), inMonth: Number(iso.slice(5, 7)) === month && Number(iso.slice(0, 4)) === year });
    }
    if (w >= 4 && !row.some((c) => c.inMonth))
      break;
    weeks.push(row);
  }
  return weeks;
}
var COLOR_OK = /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\([\d\s,.%/-]+\)|var\(--[\w-]+\))$/i;
var safeColor = (c) => typeof c === "string" && COLOR_OK.test(c.trim()) ? c.trim() : "";
function dots(colors2, max = 3) {
  const list2 = (Array.isArray(colors2) ? colors2 : []).map(safeColor).filter(Boolean);
  return { dots: list2.slice(0, max), more: list2.length > max };
}
function markMap(marks) {
  const out = new Map;
  if (!marks || typeof marks !== "object")
    return out;
  for (const [iso, colors2] of Object.entries(marks)) {
    if (!validISO(iso))
      continue;
    const d = dots(colors2);
    if (d.dots.length)
      out.set(iso, d);
  }
  return out;
}
function moveFocus(iso, key) {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[key];
  if (step)
    return addDaysISO(iso, step);
  if (key === "PageUp" || key === "PageDown") {
    const t = shiftMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), key === "PageUp" ? -1 : 1);
    const nx = shiftMonth(t.year, t.month, 1);
    const last = Number(addDaysISO(isoOf(nx.year, nx.month, 1), -1).slice(8, 10));
    return isoOf(t.year, t.month, Math.min(Number(iso.slice(8, 10)), last));
  }
  return null;
}
function tabStop(year, month, selected, today) {
  const inMonth = (iso) => validISO(iso) && Number(iso.slice(0, 4)) === year && Number(iso.slice(5, 7)) === month;
  if (inMonth(selected))
    return selected;
  if (inMonth(today))
    return today;
  return isoOf(year, month, 1);
}
var todayISO = (now = new Date) => toISO(now);

// src/month/month.mount.js
var seq2 = 0;
function el9(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls)
    n.className = cls;
  if (text != null)
    n.textContent = text;
  return n;
}
function mount16(host, cfg = {}) {
  const doc = host.ownerDocument;
  const uid2 = "ui-month-" + ++seq2;
  let state2 = {};
  let year, month;
  let focusIso = null;
  const root = el9(doc, "div", "ui-month");
  const head2 = el9(doc, "div", "ui-month__nav");
  const prev = el9(doc, "button", "ui-btn ui-btn--ghost ui-month__arrow");
  const next = el9(doc, "button", "ui-btn ui-btn--ghost ui-month__arrow");
  const title = el9(doc, "span", "ui-month__title");
  title.setAttribute("id", uid2 + "-title");
  title.setAttribute("aria-live", "polite");
  for (const [b, label2, ico] of [[prev, "Предыдущий месяц", "chevron-left"], [next, "Следующий месяц", "chevron-right"]]) {
    b.type = "button";
    b.setAttribute("aria-label", label2);
    b.innerHTML = icon(ico, { size: 20 });
  }
  head2.append(prev, title, next);
  const grid = el9(doc, "div", "ui-month__grid");
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-labelledby", uid2 + "-title");
  root.append(head2, grid);
  host.appendChild(root);
  const today = () => validISO(state2.today) ? state2.today : todayISO();
  function goto(delta, keepFocus) {
    const t = shiftMonth(year, month, delta);
    year = t.year;
    month = t.month;
    if (typeof state2.onNav === "function")
      state2.onNav({ year, month });
    render2(keepFocus);
  }
  function pick2(iso) {
    state2.selected = iso;
    const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
    const moved = y !== year || m !== month;
    if (moved) {
      year = y;
      month = m;
      if (typeof state2.onNav === "function")
        state2.onNav({ year, month });
    }
    focusIso = iso;
    render2(true);
    if (typeof state2.onSelect === "function")
      state2.onSelect(iso);
  }
  function render2(keepFocus) {
    const ws = normalizeWeekStart(state2.weekStart);
    const marks = markMap(state2.marks);
    const td = today();
    const stop = tabStop(year, month, state2.selected, td);
    title.textContent = monthHeading(year, month);
    grid.textContent = "";
    const hr = el9(doc, "div", "ui-month__row");
    hr.setAttribute("role", "row");
    for (const w of weekdayLabels(ws)) {
      const c = el9(doc, "div", "ui-month__wd", w);
      c.setAttribute("role", "columnheader");
      hr.appendChild(c);
    }
    grid.appendChild(hr);
    let focusBtn = null;
    for (const week of gridWeeks(year, month, ws)) {
      const row = el9(doc, "div", "ui-month__row");
      row.setAttribute("role", "row");
      for (const c of week) {
        const isSel = c.iso === state2.selected, isToday = c.iso === td, mk = marks.get(c.iso);
        const cell = el9(doc, "div", "ui-month__cell");
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-selected", String(isSel));
        const b = el9(doc, "button", "ui-month__d" + (c.inMonth ? "" : " is-out") + (isToday ? " is-today" : "") + (isSel ? " is-selected" : ""));
        b.type = "button";
        b.setAttribute("data-iso", c.iso);
        b.setAttribute("tabindex", c.iso === stop ? "0" : "-1");
        if (isToday)
          b.setAttribute("aria-current", "date");
        const n = mk ? mk.dots.length + (mk.more ? 1 : 0) : 0;
        b.setAttribute("aria-label", dayLabel(c.iso) + (isToday ? ", сегодня" : "") + (n ? ", есть события" : ""));
        b.appendChild(el9(doc, "span", "ui-month__num", String(c.day)));
        const dots2 = el9(doc, "span", "ui-month__dots");
        dots2.setAttribute("aria-hidden", "true");
        if (mk) {
          for (const col of mk.dots) {
            const i = el9(doc, "i");
            i.style.setProperty("--p", col);
            dots2.appendChild(i);
          }
          if (mk.more)
            dots2.appendChild(el9(doc, "b", "ui-month__more", "+"));
        }
        b.appendChild(dots2);
        cell.appendChild(b);
        row.appendChild(cell);
        if (c.iso === focusIso)
          focusBtn = b;
      }
      grid.appendChild(row);
    }
    if (keepFocus && focusBtn && focusBtn.focus) {
      focusBtn.setAttribute("tabindex", "0");
      focusBtn.focus();
    }
    focusIso = null;
  }
  const dayOf = (e) => {
    let n = e.target;
    while (n && !(n.getAttribute && n.getAttribute("data-iso")))
      n = n.parentNode;
    return n ? n.getAttribute("data-iso") : null;
  };
  const onClick = (e) => {
    const iso = dayOf(e);
    if (iso)
      pick2(iso);
  };
  const onKey = (e) => {
    const iso = dayOf(e);
    if (!iso)
      return;
    if (e.key === "Enter" || e.key === " ") {
      if (e.preventDefault)
        e.preventDefault();
      pick2(iso);
      return;
    }
    const to = moveFocus(iso, e.key);
    if (!to)
      return;
    if (e.preventDefault)
      e.preventDefault();
    focusIso = to;
    const y = Number(to.slice(0, 4)), m = Number(to.slice(5, 7));
    if (y !== year || m !== month) {
      year = y;
      month = m;
      if (typeof state2.onNav === "function")
        state2.onNav({ year, month });
    }
    render2(true);
  };
  const onPrev = () => goto(-1, false);
  const onNext = () => goto(1, false);
  grid.addEventListener("click", onClick);
  grid.addEventListener("keydown", onKey);
  prev.addEventListener("click", onPrev);
  next.addEventListener("click", onNext);
  function apply(c, first) {
    state2 = { ...state2, ...c };
    const td = today();
    const ny = Number.isInteger(c.year) ? c.year : null, nm = Number.isInteger(c.month) && c.month >= 1 && c.month <= 12 ? c.month : null;
    if (first || ny != null || nm != null) {
      year = ny != null ? ny : first ? Number(td.slice(0, 4)) : year;
      month = nm != null ? nm : first ? Number(td.slice(5, 7)) : month;
    }
    if (state2.selected != null && !validISO(state2.selected))
      state2.selected = null;
    render2(false);
  }
  apply(cfg, true);
  return {
    el: root,
    update(c = {}) {
      apply(c, false);
    },
    destroy() {
      grid.removeEventListener("click", onClick);
      grid.removeEventListener("keydown", onKey);
      prev.removeEventListener("click", onPrev);
      next.removeEventListener("click", onNext);
      if (root.parentNode)
        root.parentNode.removeChild(root);
    }
  };
}

// src/index.js
var VERSION = "0.43.0";
var toastHost = null;
var toastCfg = {};
function defaultToast() {
  if (!toastHost || !toastHost.el.isConnected) {
    const el10 = document.createElement("div");
    document.body.appendChild(el10);
    toastHost = { el: el10, api: mount2(el10, toastCfg) };
  }
  return toastHost.api;
}
var toast = {
  show: (opts) => defaultToast().show(opts),
  dismiss: (id) => defaultToast().dismiss(id),
  configure(next = {}) {
    toastCfg = { ...toastCfg, ...next };
    if (toastHost)
      toastHost.api.configure(next);
  },
  list: () => toastHost ? toastHost.api.list() : [],
  queued: () => toastHost ? toastHost.api.queued() : [],
  clear: () => {
    if (toastHost)
      toastHost.api.clear();
  },
  subscribe: (fn) => defaultToast().subscribe(fn),
  mount: mount2
};
var dialogApi = null;
var dialog = {
  open: (opts) => (dialogApi ||= mount3(document.body)).open(opts),
  closeAll: () => dialogApi?.closeAll(),
  mount: mount3
};
var period = {
  mount: mount4,
  get,
  set,
  PRESET_SETS,
  core: exports_period_core
};
var drillOpener = createOpener(() => dialog, () => document);
var drill = {
  mount: mount5,
  open: drillOpener.open,
  close: drillOpener.close,
  isOpen: drillOpener.isOpen,
  core: exports_drill_core
};
var iconsMount = mount;
var stat = { mount: mount6, spark, core: exports_stat_core, fmt, deltaOf };
var chart = {
  presets: presets2,
  weekends: weekends2,
  base: base2,
  fill: fill2,
  rgba: rgba2,
  draw: draw2,
  donut,
  overlayBars,
  tooltip,
  colors,
  fonts,
  callout,
  calloutPlugin,
  head,
  crosshair: crosshairPlugin,
  core: exports_chart_core
};
var skeleton = { show, swap, el: el3, html, KINDS: KINDS2, core: exports_skeleton_core };
var sidenav = { mount: mount8, core: exports_sidenav_core };
var glass = { mount: mount7, core: exports_glass_core };
var keysDefault = null;
var defaultKeys = () => keysDefault ||= create2();
var keys = {
  create: create2,
  add: (spec) => defaultKeys().add(spec),
  remove: (b) => defaultKeys().remove(b),
  list: () => defaultKeys().list(),
  label: (k) => defaultKeys().label(k),
  attach: () => defaultKeys().attach(),
  detach: () => defaultKeys().detach(),
  get isMac() {
    return defaultKeys().isMac;
  },
  core: exports_keys_core
};
var paletteDefault = null;
var defaultPalette = () => paletteDefault ||= create3({ keys: defaultKeys() });
var palette = {
  create: (o = {}) => create3({ keys: defaultKeys(), ...o }),
  register: (c) => defaultPalette().register(c),
  addSource: (s) => defaultPalette().addSource(s),
  mount: (cfg) => defaultPalette().mount(cfg),
  open: (q) => defaultPalette().open(q),
  close: (o) => defaultPalette().close(o),
  isOpen: () => defaultPalette().isOpen(),
  openKeys: () => defaultPalette().openKeys(),
  closeKeys: (o) => defaultPalette().closeKeys(o),
  keysOpen: () => defaultPalette().keysOpen(),
  get mounted() {
    return defaultPalette().mounted;
  },
  get commands() {
    return defaultPalette().commands;
  },
  get sources() {
    return defaultPalette().sources;
  },
  core: exports_palette_core
};
var seg2 = { mount: seg };
var ring = { mount: mount10, core: exports_ring_core };
var reveal2 = Object.assign((root, opts) => reveal(root, opts), { images, delays });
var parallax2 = parallax;
var barlist = { mount: mount11, core: exports_barlist_core, rows: barlistRows, initials };
var feed = { mount: mount12, core: exports_feed_core, rows: feedRows, relTime, plural };
var tip = { create, glide, unglide, core: exports_tip_core };
var reader = { mount: mount13, core: exports_reader_core };
var tree = { mount: mount9, core: exports_tree_core };
var crumbs2 = { mount: crumbs, core: exports_crumbs_core };
var capture = { mount: mount14, process: processFile, core: exports_capture_core };
var compare = { mount: mount15, core: exports_compare_core };
var month = { mount: mount16, core: exports_month_core };
export {
  tree,
  toast,
  tip,
  stat,
  skeleton,
  sidenav,
  seg2 as seg,
  ring,
  reveal2 as reveal,
  reader,
  period,
  parallax2 as parallax,
  palette,
  month,
  keys,
  iconsMount,
  icons,
  icon,
  glass,
  feed,
  drill,
  dialog,
  crumbs2 as crumbs,
  compare,
  chart,
  capture,
  barlist,
  VERSION
};
