const MODULE_ID = "mr-standee-portrait";
const OLD_ID = "standee-portrait"; // pre-rename id, only used to migrate saved data

const DEFAULT_CONFIG = {
  enabled: false,
  displayMode: "inside", // "inside" | "outside"
  panelWidth: 220,
  controlX: null,
  controlY: null,
  portraitImg: null,
  flagImg: null,
  flagScale: 1,
  flagX: 0,
  flagY: 0,
  flagOpacity: 1,
  portraitScale: 1,
  portraitX: 0,
  portraitY: 0
};

/* -------------------------------------------- */
/* Config helpers                                */
/* -------------------------------------------- */

function getConfig(actor) {
  return foundry.utils.mergeObject(DEFAULT_CONFIG, actor.getFlag(MODULE_ID, "config") ?? {}, { inplace: false });
}

// Writes each key with a dotted path, so concurrent writes of different keys never overwrite
// each other with a stale copy of the whole config. `render: false` skips the local sheet
// re-render (used by the sliders, which are applied live instead).
function setConfig(actor, partial, options = {}) {
  const update = {};
  for (const [k, v] of Object.entries(partial)) update[`flags.${MODULE_ID}.config.${k}`] = v;
  return actor.update(update, options);
}

/* -------------------------------------------- */
/* Small helpers                                 */
/* -------------------------------------------- */

const L = (k) => game.i18n.localize(k);

function pickImage(current, callback) {
  const FPClass = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  new FPClass({ type: "image", current: current ?? "", callback }).render(true);
}

function appElement(app) {
  return app.element instanceof HTMLElement ? app.element : app.element?.[0];
}

function make(tag, className, attrs = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Line icons, one visual family (24px grid, 1.8 stroke, round caps).
const ICONS = {
  person: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c.6-4 3.7-6.4 7.5-6.4s6.9 2.4 7.5 6.4"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24"><path d="M4 7h8M17 7h3M4 17h3M12 17h8"/><circle cx="14.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/></svg>`,
  help: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2.9-1.2 1.8"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  reset: `<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/></svg>`,
  grip: `<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g></svg>`
};

// Settings sliders. `live` = how the value is previewed on the art while dragging.
const SLIDERS = [
  { group: "panel", key: "panelWidth", label: "SP.PanelWidth", min: 160, max: 400, step: 10, fmt: (v) => `${v}px` },
  { group: "portrait", key: "portraitScale", label: "SP.Zoom", min: 0.5, max: 3, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, live: { sel: ".sp-portrait-frame img", prop: "--sp-scale", css: (v) => v } },
  { group: "portrait", key: "portraitX", label: "SP.Horizontal", min: -50, max: 50, step: 1, fmt: (v) => `${v}%`, live: { sel: ".sp-portrait-frame img", prop: "--sp-x", css: (v) => `${v}%` } },
  { group: "portrait", key: "portraitY", label: "SP.Vertical", min: -50, max: 50, step: 1, fmt: (v) => `${v}%`, live: { sel: ".sp-portrait-frame img", prop: "--sp-y", css: (v) => `${v}%` } },
  { group: "flag", key: "flagScale", label: "SP.Zoom", min: 0.5, max: 3, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, live: { sel: ".sp-flag-frame img", prop: "--sp-scale", css: (v) => v } },
  { group: "flag", key: "flagX", label: "SP.Horizontal", min: -50, max: 50, step: 1, fmt: (v) => `${v}%`, live: { sel: ".sp-flag-frame img", prop: "--sp-x", css: (v) => `${v}%` } },
  { group: "flag", key: "flagY", label: "SP.Vertical", min: -50, max: 50, step: 1, fmt: (v) => `${v}%`, live: { sel: ".sp-flag-frame img", prop: "--sp-y", css: (v) => `${v}%` } },
  { group: "flag", key: "flagOpacity", label: "SP.Opacity", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, live: { sel: ".sp-flag-frame img", prop: "--sp-f-opacity", css: (v) => v } }
];
const SLIDER_BY_KEY = Object.fromEntries(SLIDERS.map((s) => [s.key, s]));
const GROUP_TITLES = { panel: "SP.GroupPanel", portrait: "SP.GroupPortrait", flag: "SP.GroupFlag" };

/* -------------------------------------------- */
/* The art (floating panel)                      */
/* -------------------------------------------- */

function applyArtVars(panel, cfg) {
  panel.style.setProperty("--sp-panel-width", `${cfg.panelWidth}px`);
  for (const s of SLIDERS) {
    if (!s.live) continue;
    panel.querySelector(s.live.sel)?.style.setProperty(s.live.prop, s.live.css(cfg[s.key]));
  }
}

// Pure art, no buttons on top of it at all — the whole point of "outside" mode is a clean
// image next to the sheet; controls live in the hub, always inside the window. Images are set
// as properties (not interpolated into HTML), so odd file names can't break the markup.
function buildPanel(actor, cfg) {
  const panel = make("div", "sp-standee-panel");
  const frames = [
    ["sp-flag-frame", cfg.flagImg],
    ["sp-portrait-frame", cfg.portraitImg || actor.img]
  ];
  for (const [cls, src] of frames) {
    const frame = make("div", cls);
    if (src) {
      const img = make("img", "", { alt: "", draggable: "false" });
      img.src = src;
      frame.append(img);
    }
    panel.append(frame);
  }
  applyArtVars(panel, cfg);
  return panel;
}

// Keeps a floating "outside" panel glued to its window: recomputed on every render and also
// whenever the window moves, resizes, minimizes or gets focus (see wrapMethod below), since
// dragging a window doesn't re-render its sheet at all.
function repositionOutsidePanel(app) {
  const panel = app._spOutsidePanel;
  if (!panel || !panel.isConnected) return;
  const appEl = appElement(app);
  if (!appEl) return;
  panel.hidden = !!(app.minimized ?? app._minimized);
  const rect = appEl.getBoundingClientRect();
  const width = parseFloat(panel.style.getPropertyValue("--sp-panel-width")) || 220;
  // On the left by default; flips to the right when the window hugs the left screen edge.
  let left = rect.left - width;
  if (left < 0 && rect.right + width <= window.innerWidth) left = rect.right;
  panel.style.left = `${left}px`;
  panel.style.top = `${rect.top}px`;
  panel.style.height = `${rect.height}px`;
  const z = getComputedStyle(appEl).zIndex;
  panel.style.zIndex = z && z !== "auto" ? z : "100";
}

// Commits the real Application resize ("inside" mode only — "outside" never touches the
// window's own size). Only on full render and when a slider is released.
function applyWidth(app, cfg) {
  const { wc, panel } = app._sp;
  const outsideMode = cfg.displayMode === "outside";
  const desired = cfg.enabled && !outsideMode ? cfg.panelWidth : 0;
  if (app._sp.appliedWidth !== desired) {
    const current = typeof app.position.width === "number" ? app.position.width : appElement(app)?.offsetWidth ?? 0;
    const base = current - app._sp.appliedWidth;
    app._sp.appliedWidth = desired;
    app.setPosition({ width: base + desired });
  }
  // Adds to the sheet's own left padding instead of replacing it.
  wc.style.paddingLeft = desired ? `${Number(wc.dataset.spPad) + desired}px` : "";
  if (panel) panel.style.setProperty("--sp-panel-width", `${cfg.panelWidth}px`);
  if (outsideMode) repositionOutsidePanel(app);
}

// Re-applies the stored config to the art that's already on screen, without re-rendering the
// sheet (used after slider commits, which are written with render:false).
function refreshLive(app, actor) {
  const cfg = getConfig(actor);
  if (app._sp.panel) applyArtVars(app._sp.panel, cfg);
  applyWidth(app, cfg);
}

/* -------------------------------------------- */
/* Hub (the small button cluster in the sheet)   */
/* -------------------------------------------- */

function buildHub(cfg, editable, settingsOpen) {
  const hub = make("div", "sp-hub");
  const btn = (cls, icon, title, on = false) => {
    const b = make("button", `sp-btn ${cls}${on ? " on" : ""}`, { type: "button", title, "aria-label": title });
    b.innerHTML = icon;
    return b;
  };
  const grip = make("span", "sp-grip", { title: L("SP.Drag") });
  grip.innerHTML = ICONS.grip;
  hub.append(grip);
  // Players without edit rights can't toggle anything, so they only get the help button.
  if (editable) hub.append(btn("sp-toggle", ICONS.person, cfg.enabled ? L("SP.ToggleOff") : L("SP.ToggleOn"), cfg.enabled));
  if (editable && cfg.enabled) hub.append(btn("sp-gear", ICONS.sliders, L("SP.Settings"), settingsOpen));
  hub.append(btn("sp-help", ICONS.help, L("SP.Help")));
  return hub;
}

// Drag the hub with the grip (left button) or anywhere on it with the right button.
function attachHubDrag(hub, actor, wc) {
  hub.addEventListener("contextmenu", (ev) => ev.preventDefault());
  hub.addEventListener("pointerdown", (ev) => {
    if (!(ev.button === 2 || (ev.button === 0 && ev.target.closest(".sp-grip")))) return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startLeft = hub.offsetLeft;
    const startTop = hub.offsetTop;
    hub.setPointerCapture(ev.pointerId);
    hub.classList.add("dragging");
    const onMove = (m) => {
      hub.style.left = `${startLeft + m.clientX - startX}px`;
      hub.style.top = `${startTop + m.clientY - startY}px`;
      clampHub(hub, wc);
    };
    const onUp = () => {
      hub.removeEventListener("pointermove", onMove);
      hub.removeEventListener("pointerup", onUp);
      hub.removeEventListener("pointercancel", onUp);
      hub.classList.remove("dragging");
      if (actor.isOwner) setConfig(actor, { controlX: hub.offsetLeft, controlY: hub.offsetTop }, { render: false });
    };
    hub.addEventListener("pointermove", onMove);
    hub.addEventListener("pointerup", onUp);
    hub.addEventListener("pointercancel", onUp);
  });
}

// Keeps the hub reachable if the window got smaller than where it was saved.
function clampHub(hub, wc) {
  const maxLeft = Math.max(0, wc.clientWidth - hub.offsetWidth);
  const maxTop = Math.max(0, wc.clientHeight - hub.offsetHeight);
  hub.style.left = `${Math.min(Math.max(hub.offsetLeft, 0), maxLeft)}px`;
  hub.style.top = `${Math.min(Math.max(hub.offsetTop, 0), maxTop)}px`;
}

/* -------------------------------------------- */
/* Settings window                               */
/* -------------------------------------------- */

// One floating window appended to <body>, so it's never clipped by the sheet and — the point
// of all this — survives the sheet re-rendering. Sliders are previewed live and saved on
// release without re-rendering anything, so you can keep tweaking without it closing.
let settings = null; // { el, app, actor }
const POS_KEY = `${MODULE_ID}.settingsPos`;

function slidersHTML(group) {
  return SLIDERS.filter((s) => s.group === group)
    .map(
      (s) => `
      <div class="sp-slider">
        <div class="sp-slider-head"><span class="sp-slider-label" data-reset-key="${s.key}" title="${L("SP.ResetOne")}">${L(s.label)}</span><output data-out="${s.key}"></output></div>
        <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" data-key="${s.key}">
      </div>`
    )
    .join("");
}

function imageRowHTML(kind) {
  const isPortrait = kind === "portrait";
  return `
  <div class="sp-image-row" data-kind="${kind}">
    <div class="sp-thumb"><img alt="" draggable="false"></div>
    <div class="sp-image-info">
      <strong>${L(isPortrait ? "SP.PortraitImage" : "SP.Flag")}</strong>
      <span class="sp-image-sub"></span>
      <div class="sp-row">
        <button type="button" class="sp-mini" data-act="pick-${kind}">${L("SP.Choose")}</button>
        <button type="button" class="sp-mini" data-act="clear-${kind}">${L(isPortrait ? "SP.UseCharacterPortrait" : "SP.Clear")}</button>
      </div>
    </div>
  </div>`;
}

function groupHTML(group) {
  return `
  <section class="sp-group">
    <div class="sp-group-head">
      <h4>${L(GROUP_TITLES[group])}</h4>
      <button type="button" class="sp-link" data-act="reset-${group}" title="${L("SP.Reset")}" aria-label="${L("SP.Reset")}">${ICONS.reset}</button>
    </div>
    ${slidersHTML(group)}
  </section>`;
}

function buildSettingsHTML() {
  return `
  <header class="sp-settings-head">
    <span class="sp-settings-title">${L("SP.Title")}</span>
    <button type="button" class="sp-link" data-act="close" title="${L("SP.Close")}" aria-label="${L("SP.Close")}">${ICONS.close}</button>
  </header>
  <div class="sp-settings-body">
    <section class="sp-group">
      <h4>${L("SP.DisplayMode")}</h4>
      <div class="sp-segmented">
        <button type="button" data-act="mode-inside">${L("SP.DisplayInside")}</button>
        <button type="button" data-act="mode-outside">${L("SP.DisplayOutside")}</button>
      </div>
    </section>
    <section class="sp-group">
      <h4>${L("SP.Images")}</h4>
      ${imageRowHTML("portrait")}
      ${imageRowHTML("flag")}
    </section>
    ${groupHTML("panel")}${groupHTML("portrait")}${groupHTML("flag")}
  </div>`;
}

// Pushes the stored config into the controls, leaving alone a slider the user is holding.
function syncSettings() {
  if (!settings) return;
  const { el, actor } = settings;
  const cfg = getConfig(actor);
  el.querySelectorAll("input[type=range]").forEach((input) => {
    const s = SLIDER_BY_KEY[input.dataset.key];
    if (document.activeElement !== input) input.value = cfg[s.key];
    el.querySelector(`[data-out="${s.key}"]`).textContent = s.fmt(Number(input.value));
  });
  const outside = cfg.displayMode === "outside";
  el.querySelector('[data-act="mode-inside"]').classList.toggle("active", !outside);
  el.querySelector('[data-act="mode-outside"]').classList.toggle("active", outside);

  const rows = {
    portrait: { src: cfg.portraitImg || actor.img, custom: !!cfg.portraitImg, sub: cfg.portraitImg ? cfg.portraitImg.split("/").pop() : L("SP.IsCharacterPortrait") },
    flag: { src: cfg.flagImg, custom: !!cfg.flagImg, sub: cfg.flagImg ? cfg.flagImg.split("/").pop() : L("SP.NoFlag") }
  };
  for (const [kind, r] of Object.entries(rows)) {
    const row = el.querySelector(`.sp-image-row[data-kind="${kind}"]`);
    const img = row.querySelector("img");
    if (r.src) img.src = r.src;
    else img.removeAttribute("src");
    img.hidden = !r.src;
    const sub = row.querySelector(".sp-image-sub");
    sub.textContent = r.sub;
    sub.title = r.custom ? r.src : "";
    row.querySelector(`[data-act="clear-${kind}"]`).disabled = !r.custom;
  }
}

function updateGearState() {
  settings?.app._sp?.hub?.querySelector(".sp-gear")?.classList.add("on");
}

function closeSettings() {
  if (!settings) return;
  settings.el.remove();
  const app = settings.app;
  settings = null;
  app._sp?.hub?.querySelector(".sp-gear")?.classList.remove("on");
}

function positionSettings(el, app) {
  let pos = null;
  try {
    pos = JSON.parse(localStorage.getItem(POS_KEY));
  } catch (err) {
    /* storage unavailable: fall back to the default spot */
  }
  if (!pos) {
    const rect = appElement(app)?.getBoundingClientRect();
    pos = { left: (rect?.right ?? 200) + 12, top: rect?.top ?? 80 };
  }
  placeSettings(el, pos.left, pos.top);
}

function placeSettings(el, left, top) {
  const w = el.offsetWidth || 300;
  el.style.left = `${Math.min(Math.max(left, 4), window.innerWidth - w - 4)}px`;
  el.style.top = `${Math.min(Math.max(top, 4), window.innerHeight - 80)}px`;
}

function commitSlider(key, value) {
  const { app, actor } = settings;
  setConfig(actor, { [key]: value }, { render: false }).then(() => {
    if (app._sp) refreshLive(app, actor);
  });
}

function resetKeys(keys) {
  const { app, actor } = settings;
  const patch = Object.fromEntries(keys.map((k) => [k, DEFAULT_CONFIG[k]]));
  setConfig(actor, patch, { render: false }).then(() => {
    if (app._sp) refreshLive(app, actor);
    syncSettings();
  });
}

function onSettingsClick(ev) {
  const reset = ev.target.closest("[data-reset-key]");
  if (reset) return resetKeys([reset.dataset.resetKey]);
  const act = ev.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  const { actor } = settings;
  const cfg = getConfig(actor);
  if (act === "close") return closeSettings();
  if (act === "mode-inside") return void setConfig(actor, { displayMode: "inside" });
  if (act === "mode-outside") return void setConfig(actor, { displayMode: "outside" });
  if (act === "pick-portrait") return pickImage(cfg.portraitImg || actor.img, (path) => setConfig(actor, { portraitImg: path }));
  if (act === "clear-portrait") return void setConfig(actor, { portraitImg: null });
  if (act === "pick-flag") return pickImage(cfg.flagImg, (path) => setConfig(actor, { flagImg: path }));
  if (act === "clear-flag") return void setConfig(actor, { flagImg: null });
  if (act.startsWith("reset-")) return resetKeys(SLIDERS.filter((s) => s.group === act.slice(6)).map((s) => s.key));
}

function onSettingsInput(ev) {
  const input = ev.target;
  if (input.type !== "range") return;
  const s = SLIDER_BY_KEY[input.dataset.key];
  const value = Number(input.value);
  settings.el.querySelector(`[data-out="${s.key}"]`).textContent = s.fmt(value);
  const { app } = settings;
  if (s.key === "panelWidth") {
    // Cheap preview: only the CSS width, never the real window (that happens on release).
    const panel = app._sp.panel;
    panel?.style.setProperty("--sp-panel-width", `${value}px`);
    if (app._spOutsidePanel) repositionOutsidePanel(app);
    else if (app._sp.appliedWidth) app._sp.wc.style.paddingLeft = `${Number(app._sp.wc.dataset.spPad) + value}px`;
  } else {
    app._sp.panel?.querySelector(s.live.sel)?.style.setProperty(s.live.prop, s.live.css(value));
  }
}

function onSettingsChange(ev) {
  if (ev.target.type === "range") commitSlider(ev.target.dataset.key, Number(ev.target.value));
}

function attachSettingsDrag(el) {
  el.querySelector(".sp-settings-head").addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || ev.target.closest("button")) return;
    ev.preventDefault();
    const head = ev.currentTarget;
    const dx = ev.clientX - el.offsetLeft;
    const dy = ev.clientY - el.offsetTop;
    head.setPointerCapture(ev.pointerId);
    const onMove = (m) => placeSettings(el, m.clientX - dx, m.clientY - dy);
    const onUp = () => {
      head.removeEventListener("pointermove", onMove);
      head.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({ left: el.offsetLeft, top: el.offsetTop }));
      } catch (err) {
        /* not critical */
      }
    };
    head.addEventListener("pointermove", onMove);
    head.addEventListener("pointerup", onUp);
  });
}

function toggleSettings(app, actor) {
  const wasThisOne = settings?.actor === actor;
  closeSettings();
  if (wasThisOne) return;
  const el = make("div", "sp-settings");
  el.innerHTML = buildSettingsHTML();
  document.body.append(el);
  settings = { el, app, actor };
  el.addEventListener("click", onSettingsClick);
  el.addEventListener("input", onSettingsInput);
  el.addEventListener("change", onSettingsChange);
  attachSettingsDrag(el);
  syncSettings();
  positionSettings(el, app);
  updateGearState();
}

/* -------------------------------------------- */
/* Render hook                                   */
/* -------------------------------------------- */

function extractWindowContent(el) {
  if (!el) return null;
  if (el.classList?.contains("window-content")) return el;
  return el.querySelector?.(".window-content") ?? null;
}

function onRenderActorSheet(app, actor, wc) {
  const cfg = getConfig(actor);
  const editable = !!app.isEditable;
  const outsideMode = cfg.displayMode === "outside";

  app._sp ??= { appliedWidth: 0 };
  app._sp.wc = wc;
  wc.dataset.spPad ??= String(parseFloat(getComputedStyle(wc).paddingLeft) || 0);
  wc.style.position = "relative";

  wc.querySelector(":scope > .sp-standee-panel")?.remove();
  wc.querySelector(":scope > .sp-hub")?.remove();
  app._spOutsidePanel?.remove();
  app._spOutsidePanel = null;

  // A settings window left open for an actor whose standee just got turned off has nothing to
  // control any more.
  if (!cfg.enabled && settings?.actor === actor) closeSettings();

  // The hub (buttons) always lives inside the window, regardless of enabled state or display
  // mode — it never sits on top of the floating art.
  const hub = buildHub(cfg, editable, settings?.actor === actor);
  wc.prepend(hub);
  if (cfg.controlX != null) hub.style.left = `${cfg.controlX}px`;
  if (cfg.controlY != null) hub.style.top = `${cfg.controlY}px`;
  clampHub(hub, wc);
  app._sp.hub = hub;

  let panel = null;
  if (cfg.enabled) {
    panel = buildPanel(actor, cfg);
    if (outsideMode) {
      // Outside the window entirely, so it's not clipped by / drawn on the sheet's own
      // background — appended to <body> and kept glued to the window via repositionOutsidePanel.
      panel.classList.add("sp-standee-outside");
      document.body.appendChild(panel);
      app._spOutsidePanel = panel;
    } else {
      wc.prepend(panel);
    }
  }
  app._sp.panel = panel;
  applyWidth(app, cfg);

  hub.querySelector(".sp-toggle")?.addEventListener("click", () => setConfig(actor, { enabled: !cfg.enabled }));
  hub.querySelector(".sp-gear")?.addEventListener("click", () => toggleSettings(app, actor));
  hub.querySelector(".sp-help").addEventListener("click", () => openHelpJournal());
  attachHubDrag(hub, actor, wc);

  if (settings?.actor === actor) {
    settings.app = app;
    syncSettings();
  }
}

// Foundry lets any Application subclass declare its own `baseApplication` /
// `BASE_APPLICATION`, which truncates the hook-name chain at that point — a common pattern
// for systems that want their sheet selectable in the "Configure Sheet" picker. That means a
// generic `Hooks.on("renderApplication" / "renderApplicationV2", ...)` is NOT guaranteed to
// fire for every system (it didn't for Mothership, Kult, Mausritter...). Hooks are dispatched
// by name, on top of the actual render methods — instrumenting those methods directly bypasses
// that name-based dispatch entirely, so it fires regardless of what any system declares.
function patchSheetRendering() {
  if (typeof DocumentSheet !== "undefined") {
    const originalRenderV1 = DocumentSheet.prototype._render;
    DocumentSheet.prototype._render = async function (...args) {
      const result = await originalRenderV1.apply(this, args);
      try {
        if (this.object instanceof Actor) {
          const windowContent = extractWindowContent(this.element?.[0]);
          if (windowContent) onRenderActorSheet(this, this.object, windowContent);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | Error rendering the standee panel (V1)`, err);
      }
      return result;
    };
  }

  const DocumentSheetV2 = foundry.applications?.api?.DocumentSheetV2;
  if (DocumentSheetV2) {
    const originalOnRenderV2 = DocumentSheetV2.prototype._onRender;
    DocumentSheetV2.prototype._onRender = async function (...args) {
      const result = await originalOnRenderV2?.apply(this, args);
      try {
        const actor = this.document ?? this.object;
        if (actor instanceof Actor) {
          const windowContent = extractWindowContent(this.element);
          if (windowContent) onRenderActorSheet(this, actor, windowContent);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | Error rendering the standee panel (V2)`, err);
      }
      return result;
    };
  }
}

// Runs `after(app)` once `method` on `cls.prototype` has finished (waiting for it if it's
// async, so a close that gets vetoed or fails doesn't tear anything down), only for windows we
// have touched — this fires on every window move/focus/close in the whole game, so it must
// stay cheap for everything else.
function wrapMethod(cls, method, after) {
  const original = cls?.prototype?.[method];
  if (typeof original !== "function") return;
  const run = (app) => {
    try {
      after(app);
    } catch (err) {
      console.error(`${MODULE_ID} | Error in ${cls.name}.${method}`, err);
    }
  };
  cls.prototype[method] = function (...args) {
    const result = original.apply(this, args);
    if (!this._sp) return result;
    if (typeof result?.then === "function") return result.then((r) => (run(this), r));
    run(this);
    return result;
  };
}

function onWindowClosed(app) {
  app._spOutsidePanel?.remove();
  app._spOutsidePanel = null;
  if (settings?.app === app) closeSettings();
}

function patchWindowTracking() {
  const AppV1 = globalThis.Application; // gone in future Foundry versions — wrapMethod copes
  const AppV2 = foundry.applications?.api?.ApplicationV2;
  // Dragging or resizing a window doesn't re-render its sheet (no document change involved),
  // so the floating panel needs to be re-synced on these too, not just on our render hooks.
  for (const [cls, front] of [[AppV1, "bringToTop"], [AppV2, "bringToFront"]]) {
    wrapMethod(cls, "setPosition", repositionOutsidePanel);
    wrapMethod(cls, front, repositionOutsidePanel);
    wrapMethod(cls, "minimize", repositionOutsidePanel);
    wrapMethod(cls, "maximize", repositionOutsidePanel);
    wrapMethod(cls, "close", onWindowClosed);
  }
}

/* -------------------------------------------- */
/* In-world help (journal entry + one-time chat ping) */
/* -------------------------------------------- */

const HELP_JOURNAL_FLAG = "helpJournal";

function helpContentEs() {
  return `
  <p><em>MR- Standee Portrait</em> muestra el retrato de cualquier ficha de personaje como una figura recortada a cuerpo entero, con una imagen de fondo tipo bandera detrás. Funciona con cualquier sistema de juego.</p>
  <h2>El hub de control</h2>
  <p>En cada ficha de actor aparece un pequeño grupo de botones (el "hub") dentro de la ventana. Vive siempre dentro de la ficha, nunca encima de la imagen.</p>
  <ul>
    <li><strong>Muévelo</strong> arrastrando el asa de puntos (⋮⋮) o con el <strong>botón derecho del ratón</strong> sobre cualquier parte, para colocarlo donde no moleste. La posición se guarda por personaje.</li>
    <li><strong>Figura:</strong> activa o desactiva el modo standee (solo con permiso de edición).</li>
    <li><strong>Ajustes</strong> (visible cuando está activo y tienes permiso de edición): abre o cierra la ventana de ajustes.</li>
    <li><strong>Ayuda:</strong> vuelve a abrir esta página, siempre disponible.</li>
  </ul>
  <h2>Ventana de ajustes</h2>
  <p>Es una ventana flotante que se puede arrastrar por su cabecera y que <strong>se queda abierta</strong> mientras ajustas: los deslizadores se ven en directo y se guardan al soltarlos. Haz clic en el nombre de un deslizador para devolverlo a su valor por defecto, o en el icono ↺ de cada bloque para restablecer todo el bloque.</p>
  <ul>
    <li><strong>Posición:</strong> "Dentro de la ficha" integra la imagen en la propia ventana, ensanchándola. "Fuera, al lado" saca la imagen de la ventana por completo: flota junto a ella, la sigue si la mueves, y no se ve afectada por el fondo/skin propio de esa hoja.</li>
    <li><strong>Imagen del standee:</strong> "Elegir imagen" usa una imagen distinta a la del retrato del personaje; "Usar el retrato del personaje" vuelve a \`actor.img\`. No modifica el retrato real del actor — ambas se conservan por separado.</li>
    <li><strong>Bandera de fondo:</strong> "Elegir imagen" / "Quitar" gestionan la imagen que aparece detrás del standee.</li>
    <li><strong>Ancho del panel:</strong> cuánto sitio ocupa la imagen.</li>
    <li><strong>Zoom y posición de la figura / de la bandera:</strong> para encuadrar cada imagen dentro de su hueco.</li>
    <li><strong>Opacidad de la bandera.</strong></li>
  </ul>
  <h2>Importante: qué imagen usar</h2>
  <p>Tanto el retrato como la bandera se muestran sin caja ni marco, sobre fondo transparente. El resultado solo se ve "recortado" si la imagen ya tiene fondo transparente (PNG con alpha), como el arte de token. Con una imagen rectangular normal (fondo sólido) verás ese rectángulo completo — el módulo no recorta el sujeto automáticamente.</p>
  <p><em>Módulo en desarrollo activo (WIP). Si algo falla, repórtalo en <a href="https://github.com/ManuRomera/mr-standee-portrait/issues">GitHub</a>.</em></p>`;
}

function helpContentEn() {
  return `
  <p><em>MR- Standee Portrait</em> shows any character sheet's portrait as a full-body cutout standee, with a background flag image behind it. Works with any game system.</p>
  <h2>The control hub</h2>
  <p>Every actor sheet gets a small button cluster (the "hub") inside the window. It always lives inside the sheet, never on top of the artwork.</p>
  <ul>
    <li><strong>Move it</strong> by dragging the dotted handle (⋮⋮) or by holding the <strong>right mouse button</strong> anywhere on it, to put it somewhere out of the way. Its position is saved per character.</li>
    <li><strong>Figure:</strong> turns standee mode on or off (needs edit permission).</li>
    <li><strong>Settings</strong> (visible once enabled, if you can edit the actor): opens or closes the settings window.</li>
    <li><strong>Help:</strong> reopens this page, always available.</li>
  </ul>
  <h2>Settings window</h2>
  <p>A floating window you can drag by its header. It <strong>stays open</strong> while you tweak: sliders preview live and are saved when released. Click a slider's name to reset it to its default, or the ↺ icon of a block to reset the whole block.</p>
  <ul>
    <li><strong>Position:</strong> "Inside the sheet" integrates the image into the window itself, widening it. "Outside, next to it" takes the image out of the window entirely: it floats beside it, follows it when moved, and isn't affected by that sheet's own background/skin.</li>
    <li><strong>Standee image:</strong> "Choose image" uses a different image than the character's portrait; "Use character portrait" goes back to \`actor.img\`. This never modifies the actor's real portrait — both are kept separately.</li>
    <li><strong>Background flag:</strong> "Choose image" / "Clear" manage the image behind the standee.</li>
    <li><strong>Panel width:</strong> how much room the image takes up.</li>
    <li><strong>Figure / flag zoom and position:</strong> to frame each image within its space.</li>
    <li><strong>Flag opacity.</strong></li>
  </ul>
  <h2>Important: what image to use</h2>
  <p>Both the portrait and the flag are shown with no box or frame, on a transparent background. The result only looks "cut out" if the image already has a transparent background (PNG with alpha), like token art. A regular rectangular image (solid background) will show as that full rectangle — the module doesn't crop the subject automatically.</p>
  <p><em>This module is a work in progress (WIP). If something breaks, report it on <a href="https://github.com/ManuRomera/mr-standee-portrait/issues">GitHub</a>.</em></p>`;
}

async function ensureHelpJournal() {
  const existing = game.journal.find((j) => j.getFlag(MODULE_ID, HELP_JOURNAL_FLAG));
  if (existing) return existing;

  const spanish = game.i18n.lang?.startsWith("es");
  const name = spanish ? "MR- Standee Portrait — Ayuda" : "MR- Standee Portrait — Help";
  const content = spanish ? helpContentEs() : helpContentEn();

  return JournalEntry.create({
    name,
    pages: [{ name, type: "text", text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } }],
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MODULE_ID]: { [HELP_JOURNAL_FLAG]: true } }
  });
}

function openHelpJournal() {
  const journal = game.journal?.find((j) => j.getFlag(MODULE_ID, HELP_JOURNAL_FLAG));
  if (journal) journal.sheet.render(true);
  else ui.notifications.warn(game.i18n.localize("SP.HelpMissing"));
}

async function announceHelpOnce() {
  if (!game.user.isGM) return;
  try {
    const journal = await ensureHelpJournal();
    if (game.settings.get(MODULE_ID, "helpAnnounced")) return;
    await game.settings.set(MODULE_ID, "helpAnnounced", true);
    const link = `@UUID[${journal.uuid}]{${journal.name}}`;
    await ChatMessage.create({ content: `<p>${game.i18n.format("SP.HelpAnnounce", { link })}</p>`, whisper: [] });
  } catch (err) {
    console.error(`${MODULE_ID} | Could not create/announce the help journal`, err);
  }
}

Hooks.once("init", () => {
  patchSheetRendering();
  patchWindowTracking();
  game.settings.register(MODULE_ID, "helpAnnounced", { scope: "world", config: false, type: Boolean, default: false });
});

// The module used to be called "standee-portrait". Foundry treats a new id as a different
// package, so saved data has to be copied across by hand. Copies (doesn't delete) the old flags,
// and is idempotent: only actors/journals not already migrated are touched.
async function migrateFromOldId() {
  if (!game.user.isGM) return;
  for (const actor of game.actors) {
    const old = actor.flags?.[OLD_ID]?.config;
    if (old && !actor.flags?.[MODULE_ID]?.config) await actor.update({ [`flags.${MODULE_ID}.config`]: old });
  }
  const journal = game.journal.find((j) => j.flags?.[OLD_ID]?.helpJournal && !j.flags?.[MODULE_ID]?.helpJournal);
  if (journal) {
    await journal.update({ [`flags.${MODULE_ID}.${HELP_JOURNAL_FLAG}`]: true });
    await game.settings.set(MODULE_ID, "helpAnnounced", true);
  }
  if (game.modules.get(OLD_ID)?.active) {
    ui.notifications.warn("MR- Standee Portrait: desactiva el módulo antiguo «Standee Portrait» (standee-portrait); se llama igual y se pisarían. / Disable the old «Standee Portrait» module; they would clash.", { permanent: true });
  }
}

Hooks.once("ready", async () => {
  try {
    await migrateFromOldId();
  } catch (err) {
    console.error(`${MODULE_ID} | Migration from ${OLD_ID} failed`, err);
  }
  announceHelpOnce();
});
