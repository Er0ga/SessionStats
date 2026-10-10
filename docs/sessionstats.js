/* ===========================================================
   SESSIONSTATS APP
   SessionStats (github.com/Er0ga/SessionStats) inside MiOS: turns a
   GPX or FIT workout into a stats image with a transparent background.
   - card.js is the original src/ui/card.js, unchanged: to update the
     card, copy that file over this folder's card.js.
   - Reading GPX/FIT is a port of src/activity.py (Python can't run
     here), so if that file changes, update the code below.
   Files are read in the browser and never uploaded.
   =========================================================== */
const SESSION_FIELDS = ["distance", "time", "pace", "speed", "elevation", "hr"];
const SESSION_ROUTE_COLORS = ["#fc4c02", "#ffffff", "#2a6fdb", "#1f8a5b", "#e0457b"];
const SESSION_TEXT_COLORS = ["#ffffff", "#000000", "#fc4c02", "#ffd23f"];
const SESSION_BACKGROUNDS = [
  { key: "#111111", label: "Dark" },
  { key: "#4a4e56", label: "Gray" },
  { key: "checker", label: "Transparent" },
];

/* ---------- reading the activity (like activity.py) ---------- */
const EARTH_RADIUS_M = 6371000;
const FIT_SEMICIRCLE_TO_DEGREE = 180 / 2 ** 31;

function haversine(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dPhi = (lat2 - lat1) * rad;
  const dLambda = (lon2 - lon1) * rad;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function sportFromText(raw) {
  raw = (raw || "").toLowerCase();
  const has = (...words) => words.some((word) => raw.includes(word));
  if (has("run", "carrera", "correr", "jog")) return "run";
  if (has("ride", "cycl", "bike", "bici")) return "ride";
  if (has("hike", "trail", "mountain", "monte", "sender", "trek")) return "hike";
  if (has("walk", "andar", "camin")) return "walk";
  return "other";
}

/* points: [lat, lon] in degrees · eles: metres · times: seconds · hrs: bpm */
function buildActivity(sportRaw, points, eles, times, hrs) {
  if (points.length < 2) throw new Error("The file does not contain enough track points.");

  let distance = 0;
  for (let i = 1; i < points.length; i++) distance += haversine(...points[i - 1], ...points[i]);

  let elevationGain = null;
  if (eles.length >= 2) {
    elevationGain = 0;
    for (let i = 1; i < eles.length; i++) elevationGain += Math.max(0, eles[i] - eles[i - 1]);
  }

  let elapsed = times.length >= 2 ? times[times.length - 1] - times[0] : null;
  if (elapsed !== null && elapsed <= 0) elapsed = null;

  const hasPace = Boolean(elapsed && distance > 0);
  const activity = {
    sport: sportFromText(sportRaw),
    points,
    distance_m: distance,
    elapsed_s: elapsed,
    pace_s_per_km: hasPace ? elapsed / (distance / 1000) : null,
    speed_kmh: hasPace ? distance / 1000 / (elapsed / 3600) : null,
    elev_gain_m: elevationGain,
    avg_hr: hrs.length ? hrs.reduce((sum, hr) => sum + hr, 0) / hrs.length : null,
  };
  const available = {
    distance: true,
    time: elapsed !== null,
    pace: hasPace,
    speed: hasPace,
    elevation: elevationGain !== null,
    hr: hrs.length > 0,
  };
  activity.available = SESSION_FIELDS.filter((field) => available[field]);
  return activity;
}

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length || doc.documentElement.localName !== "gpx") {
    throw new Error("Not a valid GPX file.");
  }
  const byName = (root, name) => Array.from(root.getElementsByTagNameNS("*", name));
  const child = (node, name) => Array.from(node.children).find((el) => el.localName === name);

  let trackPoints = byName(doc, "trkpt");
  if (!trackPoints.length) trackPoints = byName(doc, "rtept"); // routes saved as <rte>

  const points = [], eles = [], times = [], hrs = [];
  trackPoints.forEach((point) => {
    points.push([parseFloat(point.getAttribute("lat")), parseFloat(point.getAttribute("lon"))]);
    const ele = child(point, "ele");
    if (ele && ele.textContent.trim() !== "" && Number.isFinite(Number(ele.textContent))) eles.push(Number(ele.textContent));
    const time = child(point, "time");
    const seconds = time ? Date.parse(time.textContent.trim()) / 1000 : NaN;
    if (Number.isFinite(seconds)) times.push(seconds);
    const extensions = child(point, "extensions");
    if (extensions) {
      const hr = Array.from(extensions.getElementsByTagName("*"))
        .filter((el) => ["hr", "heartrate"].includes(el.localName.toLowerCase()))
        .map((el) => parseFloat(el.textContent))
        .find(Number.isFinite);
      if (hr) hrs.push(hr);
    }
  });
  if (points.some(([lat, lon]) => !Number.isFinite(lat) || !Number.isFinite(lon))) {
    throw new Error("Not a valid GPX file: a track point has no coordinates.");
  }
  const type = byName(doc, "trk").map((track) => child(track, "type")).find(Boolean);
  return buildActivity(type ? type.textContent : "", points, eles, times, hrs);
}

/* A small FIT reader: only the "record" and "session" messages are used.
   Base types: [size, DataView getter, invalid value] */
const FIT_TYPES = {
  0: [1, "getUint8", 0xff], 1: [1, "getInt8", 0x7f], 2: [1, "getUint8", 0xff],
  3: [2, "getInt16", 0x7fff], 4: [2, "getUint16", 0xffff], 5: [4, "getInt32", 0x7fffffff],
  6: [4, "getUint32", 0xffffffff], 10: [1, "getUint8", 0], 11: [2, "getUint16", 0],
  12: [4, "getUint32", 0], 13: [1, "getUint8", 0xff],
};
const FIT_RECORD = 20;
const FIT_SESSION = 18;
const FIT_SPORTS = { 0: "generic", 1: "running", 2: "cycling", 11: "walking", 16: "mountaineering", 17: "hiking" };

function parseFit(buffer) {
  const view = new DataView(buffer);
  const points = [], eles = [], times = [], hrs = [];
  let sportRaw = null;
  try {
    const headerSize = view.getUint8(0);
    if (String.fromCharCode(...new Uint8Array(buffer, 8, 4)) !== ".FIT") throw new Error();
    const end = Math.min(view.byteLength, headerSize + view.getUint32(4, true));
    const definitions = {};
    let offset = headerSize;
    let lastTimestamp = null;

    const readMessage = (definition) => {
      const values = {};
      definition.fields.forEach((field) => {
        const type = FIT_TYPES[field.type];
        if (type && type[0] === field.size) {
          const value = view[type[1]](offset, definition.littleEndian);
          if (value !== type[2]) values[field.number] = value;
        }
        offset += field.size;
      });
      offset += definition.developerSize;
      return values;
    };

    while (offset < end) {
      const header = view.getUint8(offset++);
      let definition, values;

      if (header & 0x80) {
        /* compressed timestamp header: 5-bit offset from the last full timestamp */
        definition = definitions[(header >> 5) & 0x03];
        if (!definition) throw new Error();
        values = readMessage(definition);
        if (lastTimestamp !== null) {
          const timeOffset = header & 0x1f;
          let timestamp = lastTimestamp - (lastTimestamp % 32) + timeOffset;
          if (timeOffset < lastTimestamp % 32) timestamp += 32;
          values[253] = timestamp;
        }
      } else if (header & 0x40) {
        /* definition message */
        const littleEndian = view.getUint8(offset + 1) === 0;
        const global = view.getUint16(offset + 2, littleEndian);
        const count = view.getUint8(offset + 4);
        offset += 5;
        const fields = [];
        for (let i = 0; i < count; i++, offset += 3) {
          fields.push({ number: view.getUint8(offset), size: view.getUint8(offset + 1), type: view.getUint8(offset + 2) & 0x1f });
        }
        let developerSize = 0;
        if (header & 0x20) {
          const developerCount = view.getUint8(offset++);
          for (let i = 0; i < developerCount; i++, offset += 3) developerSize += view.getUint8(offset + 1);
        }
        definitions[header & 0x0f] = { global, littleEndian, fields, developerSize };
        continue;
      } else {
        definition = definitions[header & 0x0f];
        if (!definition) throw new Error();
        values = readMessage(definition);
      }

      if (values[253] !== undefined) lastTimestamp = values[253];
      if (definition.global === FIT_RECORD) {
        if (values[0] !== undefined && values[1] !== undefined) {
          points.push([values[0] * FIT_SEMICIRCLE_TO_DEGREE, values[1] * FIT_SEMICIRCLE_TO_DEGREE]);
        }
        const altitude = values[78] !== undefined ? values[78] : values[2]; // enhanced_altitude, altitude
        if (altitude !== undefined) eles.push(altitude / 5 - 500);
        if (values[253] !== undefined) times.push(values[253]);
        if (values[3]) hrs.push(values[3]);
      } else if (definition.global === FIT_SESSION && sportRaw === null) {
        sportRaw = FIT_SPORTS[values[5]] || "";
      }
    }
  } catch (e) {
    throw new Error("Not a valid FIT file.");
  }
  return buildActivity(sportRaw || "", points, eles, times, hrs);
}

/* like load_activity(): .fit files are read as FIT, anything else as GPX */
function readActivityFile(file) {
  const isFit = file.name.toLowerCase().endsWith(".fit");
  return (isFit ? file.arrayBuffer().then(parseFit) : file.text().then(parseGpx)).then((activity) => ({
    ...activity,
    filename: file.name,
  }));
}

/* the run shown before any file is loaded (demoActivity() in app.js) */
function demoActivity() {
  const A = [22,24,14,12,27,7,23,19,46,46,78,84,110,122,142,158,172,192,196,216,216,232,246,236,251,219,252,252];
  const B = [35,226,47,214,55,222,64,211,74,218,82,207,90,216,98,206,107,216,117,206,121,218,131,211,141,221,151,214,159,227,167,237,161,251,169,263,177,251,185,263,197,257,216,273,241,293,259,309,263,321,257,327,269,339,273,352];
  const toPoints = (a) => {
    const points = [];
    for (let i = 0; i < a.length; i += 2) points.push([40 - a[i + 1] * 0.00012, -3.7 + a[i] * 0.00012]);
    return points;
  };
  return {
    sport: "run", points: toPoints(A).concat(toPoints(B)), distance_m: 5470, elapsed_s: 2182, pace_s_per_km: 399,
    speed_kmh: 9.03, elev_gain_m: 78, avg_hr: 152, available: SESSION_FIELDS.slice(), filename: "Easy run.gpx",
  };
}

const CARD_PREVIEW_WIDTH = 660; // drawn at 2x, like PREVIEW_WIDTH in app.js

/* ---------- SessionStats window ---------- */
const session = {
  activity: null,
  fields: [],
  routeColor: SESSION_ROUTE_COLORS[0],
  textColor: SESSION_TEXT_COLORS[0],
  background: "checker",
  lang: store.get("sessionStatsLanguage", "en") === "es" ? "es" : "en",
  started: false,
};

const cardOptions = () => ({
  activity: session.activity,
  fields: session.fields,
  routeColor: session.routeColor,
  textColor: session.textColor,
});

function renderSessionPreview() {
  if (session.started && session.activity) {
    Card.renderCard($("#ssPreview"), CARD_PREVIEW_WIDTH, cardOptions(), session.background);
  }
}

function renderSessionFields() {
  const container = $("#ssFields");
  const focused = $$("select", container).indexOf(document.activeElement);
  const { activity } = session;
  container.innerHTML = session.fields
    .map(
      (field, i) => `
      <label class="ss-slot">
        <span class="ss-slot-label">Field ${i + 1}</span>
        <select data-slot="${i}">${activity.available
          .map((key) => `<option value="${key}"${key === field ? " selected" : ""}>${Card.LABELS[key]}</option>`)
          .join("")}</select>
        <span class="ss-slot-value">${escapeHtml(Card.formatValue(field, activity))}</span>
      </label>`
    )
    .join("");
  if (focused !== -1) $$("select", container)[focused].focus();
}

function renderSessionFile() {
  const { activity } = session;
  $("#ssFileName").textContent = activity.filename;
  $("#ssFileMeta").textContent =
    `${activity.sport} · ${(activity.distance_m / 1000).toFixed(2)} km · ` +
    `${activity.points.length.toLocaleString("en-US")} pts`;
}

function setSessionActivity(activity) {
  session.activity = activity;
  session.fields = Card.defaultFields(activity);
  renderSessionFile();
  renderSessionFields();
  renderSessionPreview();
}

/* picking a field that is already in another slot swaps the two (setFieldAt() in app.js) */
function setSessionField(slot, key) {
  const fields = session.fields.slice();
  const other = fields.indexOf(key);
  if (other !== -1 && other !== slot) fields[other] = fields[slot];
  fields[slot] = key;
  session.fields = fields;
  renderSessionFields();
  renderSessionPreview();
}

function renderSwatches(container, colors, current, onPick, label) {
  container.innerHTML =
    colors
      .map(
        (color) =>
          `<button type="button" class="ss-swatch" style="--swatch:${color}" data-color="${color}" ` +
          `aria-label="${color}" aria-pressed="${color === current}"></button>`
      )
      .join("") +
    `<input type="color" class="ss-custom-color" value="${current}" aria-label="Custom ${label}" />`;
  const update = (color) => {
    onPick(color);
    $$(".ss-swatch", container).forEach((swatch) => {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.color === color.toLowerCase()));
    });
    $("input", container).value = color;
  };
  $$(".ss-swatch", container).forEach((swatch) => {
    swatch.addEventListener("click", () => update(swatch.dataset.color));
  });
  $("input", container).addEventListener("input", (e) => update(e.target.value));
}

async function loadSessionFile(file) {
  const error = $("#ssError");
  error.hidden = true;
  try {
    setSessionActivity(await readActivityFile(file));
  } catch (e) {
    error.textContent = "Could not read the file: " + e.message;
    error.hidden = false;
  }
}

function setupSessionStatsApp() {
  const app = $("#sessionstats");
  const fileInput = $("#ssFileInput");

  $("#ssOpen").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) loadSessionFile(fileInput.files[0]);
    fileInput.value = "";
  });

  /* drag & drop a file anywhere on the window */
  const body = $(".window-body", app);
  body.addEventListener("dragover", (e) => {
    e.preventDefault();
    body.classList.add("is-dropping");
  });
  body.addEventListener("dragleave", (e) => {
    if (!body.contains(e.relatedTarget)) body.classList.remove("is-dropping");
  });
  body.addEventListener("drop", (e) => {
    e.preventDefault();
    body.classList.remove("is-dropping");
    if (e.dataTransfer.files[0]) loadSessionFile(e.dataTransfer.files[0]);
  });

  $("#ssFields").addEventListener("change", (e) => {
    if (e.target.dataset.slot) setSessionField(Number(e.target.dataset.slot), e.target.value);
  });

  renderSwatches($("#ssRouteColors"), SESSION_ROUTE_COLORS, session.routeColor, (color) => {
    session.routeColor = color;
    renderSessionPreview();
  }, "line color");
  renderSwatches($("#ssTextColors"), SESSION_TEXT_COLORS, session.textColor, (color) => {
    session.textColor = color;
    renderSessionPreview();
  }, "text color");

  /* preview background (the exported PNG is always transparent) */
  const backgrounds = $("#ssBackgrounds");
  backgrounds.innerHTML = SESSION_BACKGROUNDS.map(
    (bg) =>
      `<button type="button" class="ss-bg" data-bg="${bg.key}" title="${bg.label}" aria-label="${bg.label}" ` +
      `aria-pressed="${bg.key === session.background}"></button>`
  ).join("");
  $$(".ss-bg", backgrounds).forEach((button) => {
    button.addEventListener("click", () => {
      session.background = button.dataset.bg;
      $$(".ss-bg", backgrounds).forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      renderSessionPreview();
    });
  });

  /* card language: only the labels and number format on the card */
  function setCardLanguage(lang) {
    session.lang = lang;
    Card.setLang(lang);
    store.set("sessionStatsLanguage", lang);
    $$("[data-card-lang]", app).forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.cardLang === lang));
    });
    if (session.activity) {
      renderSessionFields();
      renderSessionPreview();
    }
  }
  $$("[data-card-lang]", app).forEach((button) => {
    button.addEventListener("click", () => setCardLanguage(button.dataset.cardLang));
  });
  setCardLanguage(session.lang);

  $("#ssExport").addEventListener("click", (e) => {
    const button = e.currentTarget;
    const canvas = document.createElement("canvas");
    Card.renderCard(canvas, Card.EXPORT_WIDTH, cardOptions(), "transparent");
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "sessionstats.png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      button.textContent = "Downloaded!";
      setTimeout(() => (button.textContent = "Download PNG"), 1200);
    }, "image/png");
  });

  setSessionActivity(demoActivity());
}
setupSessionStatsApp();

/* The card font is only downloaded the first time the window opens;
   the preview is drawn once it's ready (or with the fallback font). */
function startSessionStats() {
  if (session.started) return;
  session.started = true;
  const ready = document.fonts ? document.fonts.load("800 40px Inter").catch(() => {}) : Promise.resolve();
  ready.then(renderSessionPreview);
}
