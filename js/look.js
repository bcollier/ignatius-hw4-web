// ================================================================ the look: icons, color from the paintings, words for days

// ---------------------------------------------------------------- icons
// Small line drawings in the current text color, instead of symbol-font characters.
const ICON_PATHS = {
  mark: '<circle cx="12" cy="12" r="9.5"/><path d="M12 5.5v13M7.5 10h9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 6.2l1.7 1.7M18.1 16.1l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.2 17.8l1.7-1.7M18.1 7.9l1.7-1.7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  prev: '<path d="M17 5L8 12l9 7M6 5v14"/>',
  next: '<path d="M7 5l9 7-9 7M18 5v14"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 16l5-5 4 4 3-3 5 5"/><circle cx="16" cy="9" r="1.4"/>',
  text: '<path d="M5 6h14M5 10h14M5 14h14M5 18h9"/>',
  both: '<rect x="3.5" y="4" width="17" height="8" rx="1.5"/><path d="M5 15.5h14M5 19h10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  upload: '<path d="M4 5h7a3 3 0 013 3v12a2 2 0 00-2-2H4z"/><path d="M20 5h-4a3 3 0 00-3 3"/><path d="M17 12.5v-4M15 10.5l2-2 2 2"/>',
  speaker: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
  bell: '<path d="M6 16c0-6 2-10 6-10s6 4 6 10l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>',
  fleuron: '<path d="M12 7.5l3.2 4.5-3.2 4.5-3.2-4.5z" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  newbook: '<path d="M4 5h7a3 3 0 013 3v12a2 2 0 00-2-2H4z"/><path d="M20 5h-4a3 3 0 00-3 3"/><path d="M17 12v6M14 15h6"/>',
};

function iconSvg(name, size = 20) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}

function icon(name, size) {
  const span = document.createElement("span");
  span.className = "icon-wrap";
  span.innerHTML = iconSvg(name, size);
  return span;
}

// Fill every <span data-icon="name"> in the page's markup.
function drawIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((n) => {
    if (!n.firstElementChild) n.innerHTML = iconSvg(n.dataset.icon, Number(n.dataset.size) || 20);
  });
}

// ---------------------------------------------------------------- words for days and hours

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
const dayWords = (n) => (n >= 1 && n <= ORDINALS.length ? `the ${ORDINALS[n - 1]} day` : `day ${n}`);

// The part of the day where the person is, which also sets the Today card's light.
function hourMood(date = new Date()) {
  const h = date.getHours();
  if (h >= 21 || h < 5) return { greeting: "Before you sleep", mood: "night" };
  if (h < 9) return { greeting: "Good morning", mood: "dawn" };
  if (h < 12) return { greeting: "Good morning", mood: "day" };
  if (h < 17) return { greeting: "Good afternoon", mood: "day" };
  return { greeting: "Good evening", mood: "dusk" };
}

// A day that is an activity to go and do (a worksheet, a review day), with nothing to listen to.
const isExercise = (d, st) => d?.kind === "exercise" || st?.kind === "exercise";

const longWeekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });

// ---------------------------------------------------------------- color from the painting
// A few colors are taken from each painting (drawn small on a canvas and counted), so
// every day and every retreat is colored by its own art. If the image can't be read
// (a cross-origin image without CORS, or a load error), the default colors stay.

const paletteCache = new Map();
const PALETTE_STORE = "palettes.v4";

const paletteKey = (url) => (url || "").split("?")[0].replace(/^.*\/(storage\/v1\/object\/sign\/|api\/files\/)/, "");

function storedPalettes() {
  return store.get(PALETTE_STORE, {}) || {};
}

function paintingPalette(url) {
  if (!url) return Promise.resolve(null);
  const key = paletteKey(url);
  if (paletteCache.has(key)) return paletteCache.get(key);
  const saved = storedPalettes()[key];
  if (saved) {
    const done = Promise.resolve(saved);
    paletteCache.set(key, done);
    return done;
  }
  const job = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const pal = readPalette(img);
        const all = storedPalettes();
        all[key] = pal;
        const keys = Object.keys(all);
        if (keys.length > 200) delete all[keys[0]];
        store.set(PALETTE_STORE, all);
        resolve(pal);
      } catch {
        resolve(null); // a tainted canvas: keep the default colors
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  paletteCache.set(key, job);
  return job;
}

const luminance = ([r, g, b]) => {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const saturation = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
};
const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const unhex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const chroma = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

function readPalette(img) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data; // throws on a tainted canvas
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const key = rgb.map((v) => v >> 5).join(","); // eight levels a channel: similar shades count together
    const b = buckets.get(key) || { n: 0, sum: [0, 0, 0] };
    b.n += 1;
    b.sum = b.sum.map((s, k) => s + rgb[k]);
    buckets.set(key, b);
  }
  const colors = [...buckets.values()].map((b) => ({ n: b.n, rgb: b.sum.map((s) => s / b.n) })).sort((a, b) => b.n - a.n);
  const top = colors.slice(0, 40);
  const lum = (c) => luminance(c.rgb);
  // The painting's main color: the most common one that isn't near black or near white.
  const dominant = (top.find((c) => lum(c) > 0.05 && lum(c) < 0.75) || top[0]).rgb;
  // Its most vivid color: strong chroma, weighted by how much of it there is, not too dark.
  const accent = [...top].filter((c) => lum(c) > 0.03 && lum(c) < 0.8)
    .sort((a, b) => chroma(b.rgb) ** 2 * Math.sqrt(b.n) - chroma(a.rgb) ** 2 * Math.sqrt(a.n))[0]?.rgb || dominant;
  // A deep tone of the painting (for a field or a drop cap) and a light one.
  let deep = [...top].filter((c) => c.n > 3 && lum(c) < 0.1).sort((a, b) => chroma(b.rgb) * Math.sqrt(b.n) - chroma(a.rgb) * Math.sqrt(a.n))[0]?.rgb
    || mix(dominant, [0, 0, 0], 0.6);
  if (luminance(deep) > 0.1) deep = mix(deep, [18, 14, 10], 0.55);
  const light = [...top].filter((c) => c.n > 3 && lum(c) > 0.5).sort((a, b) => b.n - a.n)[0]?.rgb || mix(dominant, [246, 238, 222], 0.7);
  return { dominant: hex(dominant), deep: hex(deep), light: hex(light), accent: hex(accent) };
}

// The painting's colors as custom properties on an element (removed when there are none).
function applyPalette(node, pal) {
  const props = { "--day-deep": pal?.deep, "--day-accent": pal?.accent, "--day-light": pal?.light, "--day-dominant": pal?.dominant };
  for (const [k, v] of Object.entries(props)) (v ? node.style.setProperty(k, v) : node.style.removeProperty(k));
  if (pal) node.style.setProperty("--day-on-deep", readableOn(pal.deep));
  else node.style.removeProperty("--day-on-deep");
}

// Ivory or ink, whichever reads better on the color.
function readableOn(color) {
  const bg = unhex(color);
  const ivory = [246, 236, 216], ink = [28, 23, 18];
  return contrast(bg, ivory) >= contrast(bg, ink) ? "#f6ecd8" : "#1c1712";
}

// Four small dots of the painting's colors ("today's colors").
function paletteDots(pal) {
  const row = el("span", { class: "swatches", "aria-hidden": "true" });
  if (!pal) return row;
  for (const c of [pal.dominant, pal.deep, pal.accent, pal.light]) row.append(el("i", { style: `background:${c}` }));
  return row;
}
