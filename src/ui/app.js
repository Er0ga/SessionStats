// app.js — SessionStats UI logic, plain JavaScript.
// Any change goes through setState(), which re-renders the controls and the preview.

(function () {
  const $ = (id) => document.getElementById(id);
  const api = () => (window.pywebview && window.pywebview.api) || null;

  const ROUTE_COLORS = ["#fc4c02", "#ffffff", "#2a6fdb", "#1f8a5b", "#e0457b"];
  const TEXT_COLORS = ["#ffffff", "#000000", "#fc4c02", "#ffd23f"];
  const BG_DEFS = [
    { key: "#111111", style: "background:#111" },
    { key: "#4a4e56", style: "background:#4a4e56" },
    { key: "checker", style: "background-color:#2a2620;background-image:repeating-conic-gradient(#3a342b 0% 25%, transparent 0% 50%);background-size:8px 8px" },
  ];
  const PREVIEW_WIDTH = 660;   // drawn at 2x and shown at 330 x 521
  const DEFAULT_LANG = "en";
  const LANG_STORAGE_KEY = "sessionstats-lang";

  // Program-language strings (not the field values, which come from card.js).
  const STRINGS = {
    en: {
      minimize: "Minimize", fullscreen: "Fullscreen", close: "Close",
      change: "change",
      fields: "FIELDS", lineColor: "LINE COLOR", textColor: "TEXT & DATA COLOR",
      previewLive: "PREVIEW · LIVE", background: "BACKGROUND",
      exportPng: "Transparent PNG",
      fieldSlot: (n) => `Field ${n}`,
      loadPrompt: "load a .gpx or .fit to start",
      pts: "pts",
      readError: "Could not read the file: ",
      saved: "Image saved",
      saveError: "Could not save: ",
      locale: "en-US",
    },
    es: {
      minimize: "Minimizar", fullscreen: "Pantalla completa", close: "Cerrar",
      change: "cambiar",
      fields: "CAMPOS", lineColor: "COLOR DE LÍNEA", textColor: "COLOR DE TEXTO Y DATOS",
      previewLive: "PREVIEW · EN VIVO", background: "FONDO",
      exportPng: "PNG transparente",
      fieldSlot: (n) => `Dato ${n}`,
      loadPrompt: "carga un .gpx o .fit para empezar",
      pts: "pts",
      readError: "No se pudo leer el archivo: ",
      saved: "Imagen guardada",
      saveError: "No se pudo guardar: ",
      locale: "es-ES",
    },
  };

  function loadStoredLang() {
    try {
      const v = localStorage.getItem(LANG_STORAGE_KEY);
      return STRINGS[v] ? v : DEFAULT_LANG;
    } catch (e) {
      return DEFAULT_LANG;
    }
  }

  const state = { activity: null, fileName: "—", fields: [], open: null,
    routeColor: "#fc4c02", textColor: "#ffffff", bg: "checker", lang: loadStoredLang() };
  let fontsReady = false;
  Card.setLang(state.lang);

  function t(key) { return STRINGS[state.lang][key]; }

  function setState(patch) { Object.assign(state, patch); render(); }

  function toast(msg, isError) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), isError ? 4500 : 2200);
  }

  function demoActivity() {
    const A = [22,24,14,12,27,7,23,19,46,46,78,84,110,122,142,158,172,192,196,216,216,232,246,236,251,219,252,252];
    const B = [35,226,47,214,55,222,64,211,74,218,82,207,90,216,98,206,107,216,117,206,121,218,131,211,141,221,151,214,159,227,167,237,161,251,169,263,177,251,185,263,197,257,216,273,241,293,259,309,263,321,257,327,269,339,273,352];
    const toPts = (a) => { const r = []; for (let i = 0; i < a.length; i += 2) r.push([40 - a[i + 1] * 0.00012, -3.7 + a[i] * 0.00012]); return r; };
    return { sport: "run", points: toPts(A).concat(toPts(B)), distance_m: 5470, elapsed_s: 2182, pace_s_per_km: 399,
      speed_kmh: 9.03, elev_gain_m: 78, avg_hr: 152, available: ["distance", "time", "pace", "speed", "elevation", "hr"] };
  }

  const cardOpts = () => ({ activity: state.activity, fields: state.fields, routeColor: state.routeColor, textColor: state.textColor });

  // ── Actions ───────────────────────────────────────────────────────────
  function setFieldAt(i, key) {
    const f = [...state.fields];
    const j = f.indexOf(key);
    if (j !== -1 && j !== i) f[j] = f[i];
    f[i] = key;
    setState({ fields: f, open: null });
  }

  const actions = {
    closeDropdowns: () => setState({ open: null }),
    async pickActivity() {
      if (!api()) return;
      const r = await api().pick_activity();
      if (r && r.ok) setState({ activity: r.activity, fileName: r.activity.filename, fields: Card.defaultFields(r.activity) });
      else if (r && r.error) toast(t("readError") + r.error, true);
    },
    toggleSlot: (i) => setState({ open: state.open === i ? null : i }),
    setField: (arg) => { const [i, k] = arg.split(":"); setFieldAt(+i, k); },
    addField: (k) => setFieldAt(state.fields.length - 1, k),
    routeColor: (c) => setState({ routeColor: c }),
    textColor: (c) => setState({ textColor: c }),
    bg: (k) => setState({ bg: k }),
    setLang(lang) {
      if (!STRINGS[lang] || lang === state.lang) return;
      Card.setLang(lang);
      try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch (e) {}
      document.documentElement.lang = lang;
      setState({ lang });
    },
    async exportPng() {
      if (!state.activity || !api()) return;
      const c = document.createElement("canvas");
      Card.renderCard(c, Card.EXPORT_WIDTH, cardOpts(), "transparent");
      const r = await api().save_png(c.toDataURL("image/png"));
      if (r && r.ok) toast(t("saved"));
      else if (r && r.error) toast(t("saveError") + r.error, true);
    },
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (el && actions[el.dataset.act]) actions[el.dataset.act](el.dataset.arg);
  });
  $("routeColor").addEventListener("input", (e) => setState({ routeColor: e.target.value }));
  $("textColor").addEventListener("input", (e) => setState({ textColor: e.target.value }));

  // ── Render ────────────────────────────────────────────────────────────
  const cls = (base, on) => base + (on ? " on" : "");

  function renderStaticText() {
    $("btn-min").title = t("minimize");
    $("btn-max").title = t("fullscreen");
    $("btn-close").title = t("close");
    $("fileChangeLabel").textContent = t("change");
    $("sectionFieldsTitle").textContent = t("fields");
    $("sectionLineColorTitle").textContent = t("lineColor");
    $("sectionTextColorTitle").textContent = t("textColor");
    $("stageLabel").textContent = t("previewLive");
    $("bgLabel").textContent = t("background");
    $("exportBtnLabel").textContent = t("exportPng");
    $("langSwitch").innerHTML = Object.keys(STRINGS).map((lang) =>
      `<div class="${cls("lang-btn", lang === state.lang)}" data-act="setLang" data-arg="${lang}">${lang.toUpperCase()}</div>`).join("");
  }

  function render() {
    const s = state, a = s.activity;
    renderStaticText();
    $("ddOverlay").style.display = s.open !== null ? "block" : "none";
    $("fileName").textContent = s.fileName;
    $("fileMeta").textContent = a
      ? `${a.sport} · ${(a.distance_m / 1000).toFixed(2)} km · ${a.points.length.toLocaleString(t("locale"))} ${t("pts")}`
      : t("loadPrompt");

    const available = a ? a.available : [];
    $("fieldSlots").innerHTML = s.fields.map((key, i) => `
      <div class="slot">
        <span class="slot-grip">⠿</span>
        <div style="flex:1;min-width:0">
          <div class="slot-label">${t("fieldSlot")(i + 1)}</div>
          <div class="dd">
            <div class="dd-btn" data-act="toggleSlot" data-arg="${i}"><span>${Card.LABELS[key]}</span><span class="dd-caret">▾</span></div>
            ${String(s.open) === String(i) ? `<div class="dd-menu">${available.map((k) =>
              `<div class="${cls("dd-opt", k === key)}" data-act="setField" data-arg="${i}:${k}">${Card.LABELS[k]}</div>`).join("")}</div>` : ""}
          </div>
        </div>
        <span class="slot-value">${a ? Card.formatValue(key, a) : ""}</span>
      </div>`).join("");
    $("addChips").innerHTML = available.filter((k) => !s.fields.includes(k)).map((k) =>
      `<div class="chip" data-act="addField" data-arg="${k}">+ ${Card.LABELS[k]}</div>`).join("");

    const swatches = (act, colors, current) => colors.map((c) =>
      `<div class="${cls("swatch" + (c === "#ffffff" ? " light" : ""), current.toLowerCase() === c)}" style="background:${c}" data-act="${act}" data-arg="${c}"></div>`).join("");
    $("colorSwatches").innerHTML = swatches("routeColor", ROUTE_COLORS, s.routeColor);
    $("textSwatches").innerHTML = swatches("textColor", TEXT_COLORS, s.textColor);
    for (const id of ["routeColor", "textColor"]) if (document.activeElement !== $(id)) $(id).value = s[id];

    $("bgSwatches").innerHTML = BG_DEFS.map((d) =>
      `<div class="${cls("bg-swatch", s.bg === d.key)}" style="${d.style}" data-act="bg" data-arg="${d.key}"></div>`).join("");

    if (fontsReady && a) Card.renderCard($("preview"), PREVIEW_WIDTH, cardOpts(), s.bg);
  }

  // ── Title bar: buttons, dragging and resizing (handled by Python) ─────
  (function () {
    const call = (method, ...args) => { if (api()) api()[method](...args); };
    $("btn-close").addEventListener("click", (e) => { e.stopPropagation(); call("close_window"); });
    $("btn-min").addEventListener("click", (e) => { e.stopPropagation(); call("minimize_window"); });
    $("btn-max").addEventListener("click", (e) => { e.stopPropagation(); call("toggle_fullscreen"); });

    let mode = null, last = [0, 0], queued = false;
    $("titlebar").addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("titlebar-btn")) return;
      e.preventDefault(); mode = "drag"; call("start_drag", e.screenX, e.screenY);
    });
    ["n", "s", "e", "w", "nw", "ne", "sw", "se"].forEach((edge) => {
      $("resize-" + edge).addEventListener("mousedown", (e) => {
        e.preventDefault(); e.stopPropagation(); mode = "resize"; call("start_resize", edge, e.screenX, e.screenY);
      });
    });
    document.addEventListener("mousemove", (e) => {
      if (!mode) return;
      last = [e.screenX, e.screenY];
      if (queued) return;
      queued = true;   // one call per animation frame
      requestAnimationFrame(() => { queued = false; if (mode) call(mode === "drag" ? "drag_to" : "resize_to", ...last); });
    });
    document.addEventListener("mouseup", () => {
      if (mode === "drag") call("end_drag");
      if (mode === "resize") call("end_resize");
      mode = null;
    });
  })();

  // ── Start ─────────────────────────────────────────────────────────────
  (async function init() {
    document.documentElement.lang = state.lang;
    render();
    try { await document.fonts.load("800 40px Inter"); } catch (e) {}
    fontsReady = true;
    const demo = demoActivity();
    setState({ activity: demo, fileName: "Easy run.gpx", fields: Card.defaultFields(demo) });
  })();
})();
