// card.js — formats the activity values and draws the stats card on a <canvas>.
// The same code draws the live preview and the exported PNG, so both always match.

window.Card = (function () {
  const LAYOUT = {
    aspect: 0.633,          // width / height
    top_margin: 0.138,      // fractions of the height ...
    label_value_gap: 0.021,
    block_gap: 0.060,
    route_top_gap: 0.010,
    route_bottom: 0.775,
    label_fs: 0.041,        // ... and of the width
    value_fs: 0.085,
    route_side_pad: 0.161,
    route_width_frac: 0.0063,
    text_xscale: 1.24,
    text_yscale: 1.12,
    text_tracking: 0.036,
    font_weight: 800,
  };
  const EXPORT_WIDTH = 1080;

  const LABELS_BY_LOCALE = {
    en: { distance: "Distance", time: "Time", pace: "Pace", speed: "Speed", elevation: "Elevation", hr: "Avg HR" },
    es: { distance: "Distancia", time: "Tiempo", pace: "Ritmo", speed: "Velocidad", elevation: "Desnivel", hr: "FC media" },
  };
  const LABELS = { ...LABELS_BY_LOCALE.en };
  let numberLocale = "en-US";

  function setLang(lang) {
    Object.assign(LABELS, LABELS_BY_LOCALE[lang] || LABELS_BY_LOCALE.en);
    numberLocale = lang === "es" ? "es-ES" : "en-US";
  }

  const DEFAULT_FIELDS = {
    run: ["distance", "pace", "time"],
    walk: ["distance", "pace", "time"],
    ride: ["distance", "speed", "time"],
    hike: ["distance", "elevation", "time"],
    other: ["distance", "time", "elevation"],
  };
  const FILL_ORDER = ["distance", "time", "elevation", "pace", "speed", "hr"];

  // ── Values ────────────────────────────────────────────────────────────
  function defaultFields(a) {
    const fields = (DEFAULT_FIELDS[a.sport] || DEFAULT_FIELDS.other).filter((f) => a.available.includes(f));
    for (const f of FILL_ORDER) {
      if (fields.length >= 3) break;
      if (a.available.includes(f) && !fields.includes(f)) fields.push(f);
    }
    return fields.slice(0, 3);
  }

  function formatValue(field, a) {
    switch (field) {
      case "distance": return (a.distance_m / 1000).toFixed(2) + " km";
      case "time": {
        const s = Math.round(a.elapsed_s), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        return h >= 1 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
      }
      case "pace": {
        const s = Math.round(a.pace_s_per_km);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km`;
      }
      case "speed": return a.speed_kmh.toFixed(1) + " km/h";
      case "elevation": return Math.round(a.elev_gain_m).toLocaleString(numberLocale) + " m";
      case "hr": return Math.round(a.avg_hr) + " bpm";
      default: return "";
    }
  }

  // ── Text ──────────────────────────────────────────────────────────────
  // Letters are laid out one by one with extra tracking, then the block is
  // cropped to its ink and stretched.
  function textImage(text, px, color) {
    const font = `${LAYOUT.font_weight} ${px}px Inter, system-ui, sans-serif`;
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    const extra = LAYOUT.text_tracking * px;
    const glyphs = [];
    let x = 0, left = Infinity, right = -Infinity, asc = 0, desc = 0;
    for (const ch of text) {
      const m = probe.measureText(ch);
      const inkL = -m.actualBoundingBoxLeft, inkR = m.actualBoundingBoxRight;
      if (inkR > inkL) {
        left = Math.min(left, x + inkL); right = Math.max(right, x + inkR);
        asc = Math.max(asc, m.actualBoundingBoxAscent); desc = Math.max(desc, m.actualBoundingBoxDescent);
      }
      glyphs.push([ch, x]);
      x += Math.max(m.width, inkR) - Math.min(0, inkL) + extra;
    }
    if (!(right > left)) return null;
    const pad = 2;
    const c = document.createElement("canvas");
    c.width = Math.ceil(right - left) + pad * 2;
    c.height = Math.ceil(asc + desc) + pad * 2;
    const ctx = c.getContext("2d");
    ctx.font = font; ctx.fillStyle = color;
    for (const [ch, gx] of glyphs) ctx.fillText(ch, gx - left + pad, asc + pad);
    return { canvas: c, pad, h: asc + desc };
  }

  // Draws text centred on cx with its ink top at `top`; returns the drawn height.
  function pasteText(ctx, img, cx, top) {
    if (!img) return 0;
    const xs = LAYOUT.text_xscale, ys = LAYOUT.text_yscale;
    const w = img.canvas.width * xs, h = img.canvas.height * ys;
    ctx.drawImage(img.canvas, cx - w / 2, top - img.pad * ys, w, h);
    return img.h * ys;
  }

  // ── Route ─────────────────────────────────────────────────────────────
  function drawRoute(ctx, points, box, width, color) {
    if (!points || points.length < 2) return;
    const meanLat = points.reduce((s, p) => s + p[0], 0) / points.length;
    const k = Math.cos((meanLat * Math.PI) / 180);
    const proj = points.map((p) => [p[1] * k, p[0]]);
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const [x, y] of proj) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    const spanx = maxx - minx || 1e-9, spany = maxy - miny || 1e-9;
    const [x0, y0, x1, y1] = box, bw = x1 - x0, bh = y1 - y0;
    const s = Math.min(bw / spanx, bh / spany);
    const offx = x0 + (bw - spanx * s) / 2, offy = y0 + (bh - spany * s) / 2;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    proj.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](offx + (x - minx) * s, offy + (maxy - y) * s));
    ctx.stroke();
  }

  // ── Card ──────────────────────────────────────────────────────────────
  function cardHeight(W) { return Math.round(W / LAYOUT.aspect); }

  // opts: { activity, fields, routeColor, textColor }; background: "transparent" | "checker" | CSS colour
  function renderCard(canvas, W, opts, background) {
    const L = LAYOUT, H = cardHeight(W), cx = W / 2;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingQuality = "high";
    if (background === "checker") {
      const sq = Math.round(W / 16);
      for (let yy = 0; yy < H; yy += sq) for (let xx = 0; xx < W; xx += sq) {
        ctx.fillStyle = ((xx / sq + yy / sq) % 2 === 0) ? "#3a3a40" : "#2a2a30";
        ctx.fillRect(xx, yy, sq, sq);
      }
    } else if (background && background !== "transparent") {
      ctx.fillStyle = background; ctx.fillRect(0, 0, W, H);
    }

    let y = H * L.top_margin;
    for (const f of opts.fields) {
      y += pasteText(ctx, textImage(LABELS[f], W * L.label_fs, opts.textColor), cx, y);
      y += H * L.label_value_gap;
      y += pasteText(ctx, textImage(formatValue(f, opts.activity), W * L.value_fs, opts.textColor), cx, y);
      y += H * L.block_gap;
    }

    let routeTop = y + H * L.route_top_gap;
    const routeBottom = H * L.route_bottom;
    if (routeBottom - routeTop < H * 0.10) routeTop = routeBottom - H * 0.18;
    const side = W * L.route_side_pad;
    drawRoute(ctx, opts.activity.points, [side, routeTop, W - side, routeBottom], Math.max(2, W * L.route_width_frac), opts.routeColor);
  }

  return { EXPORT_WIDTH, LABELS, setLang, defaultFields, formatValue, renderCard };
})();
