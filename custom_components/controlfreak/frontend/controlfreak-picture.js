/**
 * Control Freak picture card (custom:controlfreak-picture).
 *
 * An animated canvas picture of one water feature: the pool, the spa, a
 * waterfall, deck jets or bubblers. The water moves with the bound pump's speed
 * and takes the colour of the bound light's effect. Night follows the Home
 * Assistant dark theme. Served by the integration next to the dashboard
 * strategy, which places one card per water-moving pump; it can also be added
 * by hand:
 *
 *   type: custom:controlfreak-picture
 *   scene: pool            # pool | spa | falls | deck | bub
 *   pump: fan.filter_pump  # optional: water speed = the fan's percentage
 *   light: light.pool_light  # optional: water colour = the light's effect
 *   spillover: sensor.filter_pump_current_mode  # optional (spa): "spillover"
 *   style: caustic         # optional: caustic | blueprint | depth | neon | poster
 *
 * Or the whole pool from above (see controlfreak-pool-shapes.js for the shapes):
 *
 *   type: custom:controlfreak-picture
 *   scene: overview
 *   shape: freeform        # rectangle | roman | kidney | freeform | lagoon | figure8
 *   pumps: { pool: fan.filter_pump, spa: fan.spa_jets, falls: fan.waterfall }
 *   lights: { pool: light.pool_light, spa: light.spa_light }
 *   spillover: sensor.filter_pump_current_mode
 *   show: [steps, ledge]   # optional: parts to draw without a pump or light
 *
 * The styles other than caustic live in controlfreak-picture-styles.js, served
 * beside this file and imported from here.
 *
 * No framework, no bundler, no dependencies: a plain HTMLElement and a 2D
 * canvas. Everything above the custom element (the effect table, speed to flow,
 * the water buffer, the motion gate) is pure and unit-tested with `node --test`.
 * Display only: nothing here ever writes to pool equipment.
 */

import { DEFAULT_STYLE, makeStyledScene, STYLES } from "./controlfreak-picture-styles.js";
import { DEFAULT_SHAPE, PARTS, partsOf, SHAPES } from "./controlfreak-pool-shapes.js";

/* ----- Shared tables ----------------------------------------------------- */

/**
 * Effect name -> water tint. The same table as EFFECT_COLORS in mapping.py
 * (tests/test_frontend.py checks they match). "show" cycles through hues.
 */
export const EFFECT_COLORS = {
  Blue: "#2f7dff",
  Green: "#34d07b",
  Red: "#ff4d4d",
  White: "#f4f7ff",
  Magenta: "#e04bd6",
  "SAM Mode": "show",
  "Party Mode": "show",
  "Romance Mode": "show",
  "Carribbean Mode": "show",
  "American Mode": "show",
  "California Sunset Mode": "show",
  "Royal Mode": "show",
};

export const SHOW = "show";
export const WHITE = EFFECT_COLORS.White;
export const SCENES = ["pool", "spa", "falls", "deck", "bub"];
export const OVERVIEW = "overview";
/** The parts of an overview a pump or a light can bind to. */
export const OVERVIEW_PARTS = ["pool", "spa", "falls", "deck", "bub"];

/** Water colours by time of day, overridable with --controlfreak-water-a/-b/-hi. */
export const PALETTE = {
  day: { a: "#4cc3d6", b: "#1d8fb0", hi: "#ffffff" },
  night: { a: "#0d4a66", b: "#062a40", hi: "#9ff0ff" },
};

// Effects a panel lists on its own (not the captured Pentair set) are matched
// on their wording: a show cycles, a named colour tints, anything else is white.
const COLOR_WORDS = [
  ["magenta", "#e04bd6"],
  ["pink", "#e04bd6"],
  ["purple", "#8b5cf6"],
  ["violet", "#8b5cf6"],
  ["red", "#ff4d4d"],
  ["orange", "#ff9f43"],
  ["amber", "#ffbf47"],
  ["yellow", "#ffd84d"],
  ["green", "#34d07b"],
  ["aqua", "#22d3e6"],
  ["cyan", "#22d3e6"],
  ["teal", "#22d3e6"],
  ["blue", "#2f7dff"],
  ["white", WHITE],
];

/** The tint for an effect name: a "#rrggbb" string or SHOW. Unknown: white. */
export function effectHex(name) {
  if (name == null || name === "") return WHITE;
  const exact = EFFECT_COLORS[name];
  if (exact) return exact;
  const lower = String(name).toLowerCase();
  if (/\b(mode|show|party|cycle|disco|rainbow)\b/.test(lower)) return SHOW;
  for (const [word, hex] of COLOR_WORDS) if (lower.includes(word)) return hex;
  return WHITE;
}

/** "#rgb" or "#rrggbb" -> [r, g, b]. */
export function hexToRgb(h) {
  h = String(h).trim();
  if (h.length === 4) h = `#${[...h.slice(1)].map((c) => c + c).join("")}`;
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A saturated hue (degrees) -> [r, g, b], for colour shows. */
export function hsl(h) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return 255 * (0.55 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rnd = (n) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* ----- Entity state -> scene model --------------------------------------- */

/** Water speed from a fan state: 0 when off, else its percentage as 0..1. */
export function flowOf(fanState) {
  const on = fanState?.state === "on";
  if (!on) return { on: false, speed: 0 };
  const pct = Number(fanState.attributes?.percentage);
  return { on: true, speed: Number.isFinite(pct) ? clamp01(pct / 100) : 1 };
}

/** Light on/off and its effect's tint from a light state. */
export function lightOf(lightState) {
  const on = lightState?.state === "on";
  const effect = lightState?.attributes?.effect ?? null;
  return { on, effect, hex: effectHex(effect) };
}

/** A pump mode sensor reading "spillover" (any case) pours the spa into the pool. */
export function spillingOf(sensorState) {
  return String(sensorState?.state ?? "").toLowerCase() === "spillover";
}

/** Night: the Home Assistant dark theme, else the browser's colour scheme. */
export function isDarkMode(hass, matchMedia = globalThis.matchMedia) {
  const themed = hass?.themes?.darkMode;
  if (typeof themed === "boolean") return themed;
  return Boolean(matchMedia?.("(prefers-color-scheme: dark)")?.matches);
}

/**
 * The overview's model: the filter pump and pool light drive the water (the
 * top-level fields), every other part carries its own pump and light.
 */
export function overviewModelOf(hass, config) {
  const states = hass?.states ?? {};
  const pumps = config.pumps ?? {};
  const lights = config.lights ?? {};
  const parts = {};
  for (const part of OVERVIEW_PARTS) {
    const pump = pumps[part] ? flowOf(states[pumps[part]]) : { on: false, speed: 0 };
    const light = lights[part] ? lightOf(states[lights[part]]) : { on: false, effect: null, hex: WHITE };
    parts[part] = {
      on: pump.on,
      speed: pump.speed,
      lightOn: light.on,
      effect: light.effect,
      hex: light.hex,
      rgb: light.hex === SHOW ? null : hexToRgb(light.hex),
    };
  }
  const pool = parts.pool;
  return {
    on: pool.on,
    speed: pool.speed,
    lightOn: pool.lightOn,
    effect: pool.effect,
    hex: pool.hex,
    spilling: config.spillover ? spillingOf(states[config.spillover]) : false,
    dark: isDarkMode(hass),
    shape: config.shape ?? DEFAULT_SHAPE,
    parts,
    show: partsOf(config),
  };
}

/** Everything the renderer needs, from the hass object and the card config. */
export function modelOf(hass, config) {
  if (config.scene === OVERVIEW) return overviewModelOf(hass, config);
  const states = hass?.states ?? {};
  const pump = config.pump ? flowOf(states[config.pump]) : { on: false, speed: 0 };
  const light = config.light ? lightOf(states[config.light]) : { on: false, effect: null, hex: WHITE };
  return {
    on: pump.on,
    speed: pump.speed,
    lightOn: light.on,
    effect: light.effect,
    hex: light.hex,
    spilling: config.spillover ? spillingOf(states[config.spillover]) : false,
    dark: isDarkMode(hass),
  };
}

/**
 * Whether frames should run: never under reduced motion (a single static frame
 * is drawn instead), never off-screen or in a hidden tab.
 */
export function shouldAnimate({ reduced = false, visible = true, hidden = false } = {}) {
  return !reduced && visible && !hidden;
}

/* ----- Simulation (pure) ------------------------------------------------- */

export function createSim() {
  return { t: 0, flow: 0, wt: 0, clock: 0, ripples: [], bubbles: [], lit: { level: 0, cur: hexToRgb(WHITE) } };
}

/** Ease the light's level and colour toward the model; dt null snaps. */
export function stepLights(sim, dt, model) {
  const want = model.lightOn ? 1 : 0;
  const h = model.hex ?? WHITE;
  const target = h === SHOW ? hsl((sim.t * 38) % 360) : hexToRgb(h);
  if (dt === null) {
    sim.lit.level = want;
    sim.lit.cur = target;
    return;
  }
  sim.lit.level += (want - sim.lit.level) * Math.min(1, dt * 3.2);
  sim.lit.cur = mix(sim.lit.cur, target, Math.min(1, dt * (h === SHOW ? 10 : 4)));
}

export function addRipple(sim, x, y, amp, max = 10) {
  sim.ripples.push({ x, y, age: 0, amp });
  if (sim.ripples.length > max) sim.ripples.shift();
}

/**
 * Advance time by dt seconds. The pool's caustics and lateral flow follow the
 * pump speed; the other scenes move their water with their own clocks.
 */
export function advance(sim, dt, model, kind) {
  const sp = kind === "pool" && model.on ? model.speed : 0;
  sim.t += dt * (0.8 + sp * 1.4);
  sim.flow += dt * sp * 26;
  sim.wt += dt;
  for (let i = sim.ripples.length - 1; i >= 0; i--) {
    const r = sim.ripples[i];
    r.age += dt;
    r.amp *= 0.985;
    if (r.age > 3.2) sim.ripples.splice(i, 1);
  }
  stepLights(sim, dt, model);
}

/* ----- Geometry (canvas pixels; pure in W, H and speed) ------------------ */

// Round raised spa on the deck at the pool's edge; its spillover lip pours into the pool.
export function spaGeo(W, H) {
  const r = Math.min(W * 0.24, H * 0.36);
  const wall = Math.max(10, r * 0.16);
  const x = W - r - wall - Math.max(26, W * 0.14);
  const y = H * 0.5;
  const poolW = x - r - wall + 2;
  const fall = Math.max(18, r * 0.35);
  return { poolW, x, y, r, wall, lipIn: [x - r, y], land: [poolW - fall, y] };
}

export function fallGeo(W, H, sp) {
  const depth = Math.max(54, W * 0.24);
  const hh = H * 0.92;
  const cy = H * 0.5;
  const half = H * (0.07 + 0.14 * sp);
  const run = Math.max(30, W * (0.09 + 0.07 * sp));
  return { depth, hh, cy, half, run, land: [depth + run, cy] };
}

// Deck jets: nozzles set in the deck along the top, arcing into the pool.
export function deckGeo(W, H, sp) {
  const deckH = Math.max(34, H * 0.2);
  const jets = [0.24, 0.5, 0.76].map((fx, i) => {
    const n = [W * fx, deckH * 0.5];
    const reach = H * (0.3 + 0.42 * sp);
    const drift = (fx - 0.5) * W * 0.12;
    return { n, land: [n[0] + drift, Math.min(H - 14, deckH + reach)], i };
  });
  return { deckH, jets };
}

// Bubblers on a shallow sun shelf along the bottom.
export function bubGeo(W, H) {
  const shelfY = H * 0.52;
  return { shelfY, heads: [0.22, 0.5, 0.78].map((fx) => [W * fx, shelfY + (H - shelfY) * 0.52]) };
}

/** Where each scene's light fixtures sit, as fractions of the picture. */
export function fixtures(kind, W, H, sp) {
  if (kind === "pool") return [{ x: 0, y: 0.56 }, { x: 1, y: 0.74 }];
  if (kind === "spa") {
    const g = spaGeo(W, H);
    return [{ x: g.x / W, y: g.y / H }];
  }
  if (kind === "falls") return [{ x: 0.4, y: 0.5 }];
  if (kind === "deck") return deckGeo(W, H, sp).jets.map((j) => ({ x: j.land[0] / W, y: j.land[1] / H }));
  return bubGeo(W, H).heads.map((h) => ({ x: h[0] / W, y: h[1] / H }));
}

/** Where falling water hits the pool (ripple sources), per scene. */
export function landings(kind, W, H, model) {
  const sp = model.speed;
  if (kind === "falls" && model.on) return [fallGeo(W, H, sp).land.map((v, i) => (i ? v : v + 4))];
  if (kind === "spa" && model.spilling) return [spaGeo(W, H).land];
  if (kind === "deck" && model.on) return deckGeo(W, H, sp).jets.map((j) => j.land);
  if (kind === "bub" && model.on) return bubGeo(W, H).heads;
  return [];
}

/* ----- Water: caustics into a small pixel buffer, lit by the light ------- */

/**
 * Fill `data` (RGBA, BW x BH) with lit water. Pure: the same sim, colours and
 * light give the same pixels. `colors` holds rgb triples a, b, hi; `fx` the
 * fixtures as fractions; `strength` the light's current weight (0..1).
 */
export function renderWater(data, BW, BH, sim, { kind, dark, colors, fx, strength }) {
  const lc = sim.lit.cur;
  const A = colors.a;
  const B = colors.b;
  const HI = colors.hi;
  const s = 150 / BW;
  const cx = BW * 0.5;
  const cy = BH * 0.5;
  const t = sim.t;
  const flow = sim.flow;
  const ripples = sim.ripples;
  const lights = fx.map((f) => [f.x * BW, f.y * BH]);
  const R2 = 2 * (BW * (kind === "pool" ? 0.34 : 0.24)) ** 2;
  let p = 0;
  for (let y = 0; y < BH; y++) {
    const gy = y / BH;
    for (let x = 0; x < BW; x++) {
      const X = x * s + flow;
      const Y = y * s;
      let c =
        Math.sin(X * 0.11 + t * 0.9) +
        Math.sin(Y * 0.13 - t * 0.7) +
        Math.sin((X + Y) * 0.08 + t * 0.55) +
        Math.sin(Math.hypot(x - cx, y - cy) * s * 0.14 - t * 0.8);
      for (let i = 0; i < ripples.length; i++) {
        const r = ripples[i];
        const dd = Math.hypot(x - r.x * BW, y - r.y * BH);
        const front = r.age * 34;
        c += r.amp * Math.sin(dd * 0.9 - r.age * 9) * Math.exp(-Math.abs(dd - front) * 0.22);
      }
      let b = 1 - Math.min(1, Math.abs(c) * 0.9);
      b = b * b * b;
      const depth = gy * 0.6 + (x / BW) * 0.4;
      let r0 = A[0] + (B[0] - A[0]) * depth;
      let g0 = A[1] + (B[1] - A[1]) * depth;
      let b0 = A[2] + (B[2] - A[2]) * depth;
      let hr = HI[0];
      let hg = HI[1];
      let hb = HI[2];
      let hiK = dark ? 0.45 : 0.6;
      if (strength > 0.001) {
        let near = 0;
        for (let j = 0; j < lights.length; j++) {
          const dx = x - lights[j][0];
          const dy = y - lights[j][1];
          near = Math.max(near, Math.exp(-(dx * dx + dy * dy) / R2));
        }
        const k = strength * (0.42 + 0.58 * near);
        const keep = 1 - k * (dark ? 0.7 : 0.55);
        r0 = r0 * keep + lc[0] * k;
        g0 = g0 * keep + lc[1] * k;
        b0 = b0 * keep + lc[2] * k;
        const hk = Math.min(1, k * 1.3);
        hr = HI[0] + (Math.min(255, lc[0] * 0.6 + 110) - HI[0]) * hk;
        hg = HI[1] + (Math.min(255, lc[1] * 0.6 + 110) - HI[1]) * hk;
        hb = HI[2] + (Math.min(255, lc[2] * 0.6 + 110) - HI[2]) * hk;
        hiK += 0.25 * k;
      }
      const m = b * hiK;
      data[p++] = r0 + (hr - r0) * m;
      data[p++] = g0 + (hg - g0) * m;
      data[p++] = b0 + (hb - b0) * m;
      data[p++] = 255;
    }
  }
}

/* ----- Scene renderer (browser: needs a canvas) --------------------------- */

/**
 * One water renderer, five small scenes. `getModel()` returns the current
 * model (see modelOf); `getColors()` the water palette as rgb triples.
 */
export function makeScene(cv, kind, getModel, getColors, rng = Math.random) {
  const ctx = cv.getContext("2d");
  const buf = document.createElement("canvas");
  const bctx = buf.getContext("2d");
  const sim = createSim();
  let W = 0;
  let H = 0;
  let BW = 120;
  let BH = 80;
  let img = null;
  let last = 0;
  let running = false;
  let frames = 0;
  const on = () => getModel().on;
  const speed = () => getModel().speed;
  const spilling = () => getModel().spilling;
  const rgbOf = () => sim.lit.cur.map(Math.round).join(",");

  // Fixed stone outlines for the waterfall: x in ledge-depth units, y and r in height units.
  const ROCKS = [
    { x: 0.2, y: -0.34, r: 0.2, s: 1 },
    { x: 0.55, y: -0.22, r: 0.15, s: 2 },
    { x: 0.28, y: 0.0, r: 0.24, s: 3 },
    { x: 0.6, y: 0.24, r: 0.15, s: 4 },
    { x: 0.2, y: 0.36, r: 0.2, s: 5 },
    { x: 0.82, y: -0.03, r: 0.12, s: 6 },
    { x: 0.62, y: -0.42, r: 0.12, s: 7 },
    { x: 0.66, y: 0.44, r: 0.11, s: 8 },
  ];

  function resize() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (!r.width || !r.height) return;
    W = Math.round(r.width);
    H = Math.round(r.height);
    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    BW = 120;
    BH = Math.max(40, Math.round((BW * H) / W));
    buf.width = BW;
    buf.height = BH;
    img = bctx.createImageData(BW, BH);
    draw();
  }

  function water(dark, paint, lightOn = true) {
    const strength = lightOn ? sim.lit.level * (dark ? 1 : 0.7) : 0;
    const fx = fixtures(kind, W, H, speed());
    renderWater(img.data, BW, BH, sim, { kind, dark, colors: getColors(), fx, strength });
    bctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (paint) ctx.drawImage(buf, 0, 0, W, H);
    if (paint && strength > 0.01) {
      const rgb = rgbOf();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const f of fx) {
        const px = f.x * W;
        const py = f.y * H;
        const g = ctx.createRadialGradient(px, py, 0, px, py, Math.max(W, H) * (kind === "pool" ? 0.55 : 0.35));
        g.addColorStop(0, `rgba(${rgb},${0.4 * strength})`);
        g.addColorStop(0.4, `rgba(${rgb},${0.14 * strength})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }
    return strength;
  }

  // Travertine deck with paver joints.
  function deck(dark, x, y, w, h) {
    ctx.fillStyle = dark ? "#2e2b26" : "#e9e1d2";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.05)" : "rgba(120,100,70,0.16)";
    ctx.lineWidth = 1;
    const sz = 34;
    ctx.beginPath();
    for (let gx = x - (x % sz); gx < x + w; gx += sz) {
      ctx.moveTo(gx + 0.5, y);
      ctx.lineTo(gx + 0.5, y + h);
    }
    for (let gy = y - (y % sz); gy < y + h; gy += sz) {
      ctx.moveTo(x, gy + 0.5);
      ctx.lineTo(x + w, gy + 0.5);
    }
    ctx.stroke();
  }
  function coping(dark, x0, y0, x1, y1) {
    ctx.lineCap = "butt";
    ctx.lineWidth = 7;
    ctx.strokeStyle = dark ? "#5d5850" : "#f4efe5";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  function foam(x, y, rx, ry, a = 0.5) {
    const fm = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    fm.addColorStop(0, `rgba(255,255,255,${a})`);
    fm.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = fm;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPool(dark) {
    if (on()) {
      const n = 6;
      const sp = speed();
      ctx.lineCap = "round";
      ctx.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        const ph = (sim.t * (0.25 + sp * 0.9) + i / n) % 1;
        const x0 = 18 + ph * (W * 0.55);
        const y0 = H * 0.3 + Math.sin(i * 1.3) * 8 + i * (H * 0.09);
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * Math.sin(ph * Math.PI)})`;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + 22 + sp * 34, y0 + 2);
        ctx.stroke();
      }
    }
    ctx.lineWidth = 8;
    ctx.strokeStyle = dark ? "rgba(190,225,235,0.12)" : "rgba(255,255,255,0.55)";
    ctx.strokeRect(4, 4, W - 8, H - 8);
  }

  function drawSpa(dark) {
    const g = spaGeo(W, H);
    const strength = sim.lit.level * (dark ? 1 : 0.75);
    const rgb = rgbOf();
    // Deck, with the pool alongside to catch the spillover. The spa light lights only the spa.
    deck(dark, 0, 0, W, H);
    water(dark, false, false);
    ctx.drawImage(buf, 0, 0, BW * (g.poolW / W), BH, 0, 0, g.poolW, H);
    water(dark, false, true);
    coping(dark, g.poolW + 3, 0, g.poolW + 3, H);
    // Raised stone wall.
    const stone = dark ? "#6b6457" : "#d9ccb3";
    ctx.save();
    ctx.shadowColor = dark ? "rgba(0,0,0,0.6)" : "rgba(60,45,20,0.28)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = -4;
    ctx.shadowOffsetY = 6;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r + g.wall, 0, Math.PI * 2);
    ctx.fillStyle = stone;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r + g.wall - 1, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.7)";
    ctx.stroke();
    // Spa water.
    ctx.save();
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(buf, 0, 0, W, H);
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r * 0.86, 0, Math.PI * 2);
    ctx.lineWidth = g.r * 0.24;
    ctx.strokeStyle = dark ? "rgba(160,220,235,0.07)" : "rgba(255,255,255,0.22)";
    ctx.stroke();
    if (strength > 0.01) {
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      const sl = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r * 1.1);
      sl.addColorStop(0, `rgba(${rgb},${0.6 * strength})`);
      sl.addColorStop(1, `rgba(${rgb},${0.22 * strength})`);
      ctx.fillStyle = sl;
      ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
      ctx.globalCompositeOperation = "source-over";
    }
    // Jets: froth and swirling bubbles, stronger with pump speed.
    if (on()) {
      const js = speed();
      const fr = ctx.createRadialGradient(g.x, g.y, g.r * 0.3, g.x, g.y, g.r);
      fr.addColorStop(0, `rgba(255,255,255,${0.03 + 0.06 * js})`);
      fr.addColorStop(1, `rgba(255,255,255,${0.12 + 0.34 * js})`);
      ctx.fillStyle = fr;
      ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
      const spawn = Math.round(1 + js * 4);
      for (let k = 0; k < spawn && sim.bubbles.length < 40 + js * 110; k++) {
        sim.bubbles.push({
          a: rng() * Math.PI * 2,
          rr: g.r * (0.55 + rng() * 0.42),
          r: 0.8 + rng() * 2.4,
          life: 0,
          v: 0.02 + rng() * 0.03,
        });
      }
    }
    for (let i = sim.bubbles.length - 1; i >= 0; i--) {
      const bb = sim.bubbles[i];
      bb.life += bb.v;
      bb.rr *= 0.995;
      bb.a += 0.004 + 0.02 * speed();
      if (bb.life >= 1) {
        sim.bubbles.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.arc(g.x + Math.cos(bb.a) * bb.rr, g.y + Math.sin(bb.a) * bb.rr, bb.r * (1 + bb.life * 0.8), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - bb.life)})`;
      ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(120,100,70,0.25)";
    ctx.stroke();

    // Spillover lip facing the pool, and the sheet running over it into the pool.
    const half = g.r * 0.3;
    const L = g.lipIn;
    ctx.lineCap = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = dark ? "#9aa6a8" : "#c9d1d3";
    ctx.beginPath();
    ctx.moveTo(L[0], L[1] - half);
    ctx.lineTo(L[0], L[1] + half);
    ctx.stroke();
    if (!spilling()) return;
    const E = g.land;
    const sheet = ctx.createLinearGradient(L[0], 0, E[0], 0);
    sheet.addColorStop(0, "rgba(235,250,255,0.85)");
    sheet.addColorStop(0.6, "rgba(235,250,255,0.5)");
    sheet.addColorStop(1, "rgba(235,250,255,0.1)");
    ctx.beginPath();
    ctx.moveTo(L[0], L[1] - half);
    ctx.lineTo(E[0], E[1] - half * 1.15);
    ctx.lineTo(E[0], E[1] + half * 1.15);
    ctx.lineTo(L[0], L[1] + half);
    ctx.closePath();
    ctx.fillStyle = sheet;
    ctx.fill();
    if (strength > 0.01) {
      ctx.fillStyle = `rgba(${rgb},${0.25 * strength})`;
      ctx.fill();
    }
    ctx.lineWidth = 1.4;
    const len = L[0] - E[0];
    for (let i = 0; i < 9; i++) {
      const off = (i / 8 - 0.5) * 2 * half;
      const ph = (sim.wt / 1.2 + rnd(i + 9)) % 1;
      const a0 = ph * len;
      ctx.strokeStyle = `rgba(255,255,255,${0.75 * Math.sin(ph * Math.PI)})`;
      ctx.beginPath();
      ctx.moveTo(L[0] - a0, L[1] + off);
      ctx.lineTo(L[0] - Math.min(len, a0 + 10), L[1] + off);
      ctx.stroke();
    }
    foam(E[0], E[1], half * 0.9 * (0.9 + 0.1 * Math.sin(sim.wt * 5)), half * 1.5, 0.55);
  }

  function drawFalls(dark, strength) {
    const g = fallGeo(W, H, speed());
    const stone = dark ? [104, 96, 84] : [196, 184, 162];
    ctx.save();
    ctx.shadowColor = dark ? "rgba(0,0,0,0.6)" : "rgba(8,50,64,0.3)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 7;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= 12; i++) {
      const y = (i / 12) * H;
      const edge = g.depth * (0.62 + 0.22 * rnd(i + 40) + (Math.abs(y - g.cy) < H * 0.24 ? 0.18 : 0));
      ctx.lineTo(edge, y);
    }
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = `rgb(${stone.map((c) => (c * 0.62) | 0)})`;
    ctx.fill();
    ctx.shadowColor = "transparent";
    for (const rk of ROCKS) {
      const cx = rk.x * g.depth;
      const cy = g.cy + rk.y * g.hh;
      const r = rk.r * g.hh;
      const n = 7;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2 + rk.s;
        const rr = r * (0.78 + rnd(rk.s * 10 + (i % n)) * 0.34);
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr * 0.9;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      const sh = 0.86 + rnd(rk.s) * 0.22;
      const gr = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      gr.addColorStop(0, `rgb(${stone.map((c) => Math.min(255, c * sh * 1.18) | 0)})`);
      gr.addColorStop(1, `rgb(${stone.map((c) => (c * sh * 0.72) | 0)})`);
      ctx.fillStyle = gr;
      ctx.fill();
    }
    ctx.restore();
    const lx = g.depth;
    const top = g.cy - g.half;
    const bot = g.cy + g.half;
    ctx.lineCap = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = dark ? "#8d9592" : "#ddd3c1";
    ctx.beginPath();
    ctx.moveTo(lx - 5, g.cy - H * 0.2);
    ctx.lineTo(lx, g.cy + H * 0.2);
    ctx.stroke();
    if (!on()) return;
    const E = g.land;
    const len = g.run;
    const sheet = ctx.createLinearGradient(lx, 0, E[0], 0);
    sheet.addColorStop(0, "rgba(240,252,255,0.88)");
    sheet.addColorStop(0.6, "rgba(235,250,255,0.5)");
    sheet.addColorStop(1, "rgba(235,250,255,0.1)");
    ctx.beginPath();
    ctx.moveTo(lx, top);
    ctx.lineTo(E[0], top - 4);
    ctx.lineTo(E[0], bot + 4);
    ctx.lineTo(lx, bot);
    ctx.closePath();
    ctx.fillStyle = sheet;
    ctx.fill();
    if (strength > 0.01) {
      ctx.fillStyle = `rgba(${rgbOf()},${0.4 * strength})`;
      ctx.fill();
    }
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const y = top + ((i + 0.5) / 12) * (bot - top);
      const ph = (sim.wt * (0.45 + speed() * 0.9) + rnd(i + 3)) % 1;
      const a0 = ph * len;
      ctx.strokeStyle = `rgba(255,255,255,${0.75 * Math.sin(ph * Math.PI)})`;
      ctx.beginPath();
      ctx.moveTo(lx + a0, y);
      ctx.lineTo(lx + Math.min(len, a0 + 12), y);
      ctx.stroke();
    }
    for (let k = 0; k < 3; k++) {
      const per = [1.1, 1.5, 0.9][k];
      const pulse = 0.85 + 0.15 * Math.sin((sim.wt / per) * Math.PI * 2 + k);
      foam(E[0] + k * 4, E[1] + (k - 1) * g.half * 0.35, g.half * 0.8 * pulse, g.half * 1.3 * pulse, 0.45);
    }
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 2; k++) {
      const ph = (sim.wt / 2.6 + k * 0.5) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - ph)})`;
      ctx.beginPath();
      ctx.ellipse(E[0] + 6, E[1], g.half * (0.8 + ph * 1.6), g.half * (1.3 + ph * 1.4), 0, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    }
  }

  // Deck jets: arcs of water from the deck into the pool. The stream's shadow on the water shows the arc.
  function drawDeck(dark, strength) {
    const sp = speed();
    const g = deckGeo(W, H, sp);
    const rgb = rgbOf();
    deck(dark, 0, 0, W, g.deckH);
    coping(dark, 0, g.deckH + 3, W, g.deckH + 3);
    for (const j of g.jets) {
      // Nozzle set in the deck.
      ctx.beginPath();
      ctx.arc(j.n[0], j.n[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = dark ? "#1a1a18" : "#8f8a80";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(j.n[0], j.n[1], 2.2, 0, Math.PI * 2);
      ctx.fillStyle = strength > 0.01 ? `rgb(${rgb})` : dark ? "#555" : "#c9c4ba";
      ctx.fill();
    }
    if (!on()) return;
    const lift = 0.35 + 0.25 * sp;
    for (const j of g.jets) {
      const [x0, y0] = j.n;
      const [x1, y1] = j.land;
      const L = Math.hypot(x1 - x0, y1 - y0);
      const cx = (x0 + x1) / 2 - L * lift * 1.0 * (j.i === 2 ? -1 : 1);
      const cy = (y0 + y1) / 2 - L * lift * 0.2;
      // Shadow of the stream on the water.
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = dark ? "rgba(0,0,0,0.28)" : "rgba(8,50,64,0.18)";
      ctx.beginPath();
      ctx.moveTo(x0, y0 + 4);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      // The stream: a smooth glassy arc (laminar), its glow tinted by the light.
      const tint = strength > 0.01 ? `rgba(${rgb},0.85)` : dark ? "rgba(200,240,255,0.45)" : "rgba(11,90,120,0.35)";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.lineWidth = 7 + 3 * sp;
      ctx.strokeStyle = tint;
      if (strength > 0.01) {
        ctx.shadowColor = `rgba(${rgb},1)`;
        ctx.shadowBlur = 14;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2.2 + 1.2 * sp;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.stroke();
      // Pulses travelling along the arc.
      for (let k = 0; k < 4; k++) {
        const u = (sim.wt * (0.5 + sp) + k / 4 + j.i * 0.13) % 1;
        const a = 1 - u;
        const px = a * a * x0 + 2 * a * u * cx + u * u * x1;
        const py = a * a * y0 + 2 * a * u * cy + u * u * y1;
        ctx.beginPath();
        ctx.arc(px, py, 1.6 + sp, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fill();
      }
      foam(x1, y1, 7 + 6 * sp, 5 + 4 * sp, 0.6);
    }
  }

  // Bubblers: domes of froth on the sun shelf, taller and wider with pump speed.
  function drawBub(dark, strength) {
    const g = bubGeo(W, H);
    const sp = speed();
    const rgb = rgbOf();
    ctx.fillStyle = dark ? "rgba(200,240,250,0.08)" : "rgba(255,255,255,0.28)";
    ctx.fillRect(0, g.shelfY, W, H - g.shelfY);
    ctx.lineWidth = 2;
    ctx.strokeStyle = dark ? "rgba(200,240,250,0.18)" : "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.moveTo(0, g.shelfY);
    ctx.lineTo(W, g.shelfY);
    ctx.stroke();
    for (const [x, y] of g.heads) {
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = dark ? "rgba(0,0,0,0.4)" : "rgba(60,90,100,0.35)";
      ctx.fill();
    }
    if (!on()) return;
    g.heads.forEach(([x, y], i) => {
      const pulse = 0.88 + 0.12 * Math.sin(sim.wt * (6 + sp * 6) + i * 1.7);
      const R = (12 + 26 * sp) * pulse;
      if (strength > 0.01) {
        foam(x, y, R * 1.6, R * 1.6, 0.5 * strength);
        ctx.fillStyle = `rgba(${rgb},${0.35 * strength})`;
        ctx.beginPath();
        ctx.arc(x, y, R * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      foam(x, y, R, R, 0.95);
      ctx.beginPath();
      ctx.arc(x, y, R * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
      for (let k = 0; k < 2; k++) {
        const ph = (sim.wt * (0.5 + sp * 0.6) + k * 0.5 + i * 0.2) % 1;
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - ph)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, R * (1 + ph * 1.6), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let k = 0; k < 6; k++) {
        const a = rnd(i * 10 + k) * Math.PI * 2 + sim.wt * 0.6;
        const u = (sim.wt * (1 + sp) + rnd(k + i * 7)) % 1;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * R * 1.3 * u, y + Math.sin(a) * R * 1.3 * u, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - u)})`;
        ctx.fill();
      }
    });
  }

  function draw() {
    if (!img) return;
    const dark = getModel().dark;
    const strength = kind === "spa" ? 0 : water(dark, true);
    if (kind === "pool") drawPool(dark);
    else if (kind === "spa") drawSpa(dark);
    else if (kind === "falls") drawFalls(dark, strength);
    else if (kind === "deck") drawDeck(dark, strength);
    else drawBub(dark, strength);
    frames++;
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    const model = getModel();
    advance(sim, dt, model, kind);
    const lands = landings(kind, W, H, model);
    if (lands.length && (sim.clock += dt) > 0.85 - 0.5 * (kind === "spa" ? 0.6 : model.speed)) {
      sim.clock = 0;
      const L = lands[Math.floor(rng() * lands.length)];
      addRipple(sim, L[0] / W, L[1] / H, 1);
    }
    draw();
    requestAnimationFrame(frame);
  }
  function start() {
    if (running) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
  }
  /** Redraw now with the light snapped to its target: for static frames and state changes. */
  function kick() {
    if (!running) {
      stepLights(sim, null, getModel());
      draw();
    }
  }
  function splash(fx, fy) {
    addRipple(sim, fx, fy, 2.4, 6);
    if (!running) {
      sim.ripples[sim.ripples.length - 1].age = 0.6;
      draw();
    }
  }
  return { resize, start, stop, kick, splash, draw, get running() { return running; }, get frames() { return frames; } };
}

/* ----- The custom element (browser only) --------------------------------- */

const Base = globalThis.HTMLElement ?? class {};
const DOCS_URL = "https://github.com/Jimmyneox/ha-controlfreak/blob/main/docs/controlfreak.md";
const SCENE_LABELS = { pool: "Pool", spa: "Spa", falls: "Waterfall", deck: "Deck jets", bub: "Bubblers", overview: "Pool overview" };

const STYLE = `
  :host { display: block; height: 100%; }
  ha-card {
    display: block; position: relative; height: 100%; overflow: hidden;
    min-height: var(--controlfreak-picture-height, 200px);
    background: var(--controlfreak-water-b, #1d8fb0);
  }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; }
`;

export class ControlFreakPictureCard extends Base {
  static getStubConfig() {
    return { scene: "pool" };
  }

  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._model = null;
    this._scene = null;
    this._visible = true;
    this._media = [];
    this._observers = [];
    this._onVisibility = () => this._gate();
  }

  setConfig(config) {
    if (!config || (!SCENES.includes(config.scene) && config.scene !== OVERVIEW)) {
      throw new Error(`controlfreak-picture: set "scene" to one of ${[...SCENES, OVERVIEW].join(", ")}`);
    }
    for (const key of ["pump", "light", "spillover"]) {
      if (config[key] != null && typeof config[key] !== "string") {
        throw new Error(`controlfreak-picture: "${key}" must be an entity id`);
      }
    }
    if (config.scene === OVERVIEW) {
      if (config.shape != null && !SHAPES.includes(config.shape)) {
        throw new Error(`controlfreak-picture: set "shape" to one of ${SHAPES.join(", ")}`);
      }
      for (const key of ["pumps", "lights"]) {
        const map = config[key];
        if (map == null) continue;
        if (typeof map !== "object" || Array.isArray(map)) {
          throw new Error(`controlfreak-picture: "${key}" maps parts (${OVERVIEW_PARTS.join(", ")}) to entity ids`);
        }
        for (const [part, id] of Object.entries(map)) {
          if (!OVERVIEW_PARTS.includes(part) || typeof id !== "string") {
            throw new Error(`controlfreak-picture: "${key}.${part}" must be an entity id for one of ${OVERVIEW_PARTS.join(", ")}`);
          }
        }
      }
      if (config.show != null && (!Array.isArray(config.show) || config.show.some((p) => !PARTS.includes(p)))) {
        throw new Error(`controlfreak-picture: "show" lists parts from ${PARTS.join(", ")}`);
      }
    }
    if (config.style != null && !STYLES.includes(config.style)) {
      throw new Error(`controlfreak-picture: set "style" to one of ${STYLES.join(", ")}`);
    }
    this._config = config;
    this._model = this._hass ? modelOf(this._hass, config) : null;
    this._rebuild();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const next = modelOf(hass, this._config);
    const prev = this._model;
    this._model = next;
    const changed =
      !prev ||
      ["on", "speed", "lightOn", "effect", "hex", "spilling", "dark"].some((k) => prev[k] !== next[k]) ||
      (next.parts && JSON.stringify(prev.parts) !== JSON.stringify(next.parts));
    if (changed) {
      this._label();
      this._scene?.kick();
    }
  }

  get hass() {
    return this._hass;
  }

  /** Frames drawn so far (the render harness waits for the first one). */
  get frames() {
    return this._scene?.frames ?? 0;
  }

  getCardSize() {
    return 3;
  }

  getGridOptions() {
    return { columns: "full", rows: 4, min_rows: 2 };
  }

  connectedCallback() {
    this._rebuild();
  }

  disconnectedCallback() {
    this._scene?.stop();
    for (const o of this._observers) o.disconnect();
    this._observers = [];
    for (const [mq, fn] of this._media) mq.removeEventListener?.("change", fn);
    this._media = [];
    document.removeEventListener("visibilitychange", this._onVisibility);
  }

  _model_() {
    return this._model ?? modelOf(this._hass, this._config ?? {});
  }

  _colors() {
    const dark = this._model_().dark;
    const base = dark ? PALETTE.night : PALETTE.day;
    const cs = globalThis.getComputedStyle ? getComputedStyle(this) : null;
    const pick = (name, fallback) => {
      const v = cs?.getPropertyValue(`--controlfreak-water-${name}`).trim();
      return hexToRgb(v && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v) ? v : fallback);
    };
    return { a: pick("a", base.a), b: pick("b", base.b), hi: pick("hi", base.hi) };
  }

  _rebuild() {
    if (!this.isConnected || !this._config || this._scene) return;
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style><ha-card><canvas role="img"></canvas></ha-card>`;
    const canvas = root.querySelector("canvas");
    this._canvas = canvas;
    const style = this._config.style ?? DEFAULT_STYLE;
    this._scene = makeStyledScene(canvas, this._config.scene, style, () => this._model_(), () => this._colors());
    this._label();
    canvas.addEventListener("pointerdown", (e) => {
      const r = canvas.getBoundingClientRect();
      if (r.width && r.height) this._scene.splash((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });
    if (globalThis.ResizeObserver) {
      const ro = new ResizeObserver(() => this._scene.resize());
      ro.observe(canvas);
      this._observers.push(ro);
    } else {
      this._scene.resize();
    }
    if (globalThis.IntersectionObserver) {
      const io = new IntersectionObserver(([entry]) => {
        this._visible = entry.isIntersecting;
        this._gate();
      });
      io.observe(this);
      this._observers.push(io);
    }
    document.addEventListener("visibilitychange", this._onVisibility);
    if (globalThis.matchMedia) {
      for (const query of ["(prefers-reduced-motion: reduce)", "(prefers-color-scheme: dark)"]) {
        const mq = matchMedia(query);
        const fn = () => this._gate();
        mq.addEventListener?.("change", fn);
        this._media.push([mq, fn]);
      }
    }
    this._gate();
  }

  _reduced() {
    return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }

  /** Start or stop the frame loop from motion preference, visibility and tab state. */
  _gate() {
    if (!this._scene) return;
    const animate = shouldAnimate({ reduced: this._reduced(), visible: this._visible, hidden: document.hidden });
    if (animate) this._scene.start();
    else {
      this._scene.stop();
      this._scene.kick();
    }
  }

  _label() {
    if (!this._canvas || !this._config) return;
    const m = this._model_();
    const parts = [SCENE_LABELS[this._config.scene]];
    if (m.parts) {
      parts.push(`${m.shape} shape`);
      for (const [name, p] of Object.entries(m.parts)) {
        if (this._config.pumps?.[name]) parts.push(`${name} pump ${p.on ? `on at ${Math.round(p.speed * 100)}%` : "off"}`);
        if (this._config.lights?.[name]) parts.push(`${name} light ${p.lightOn ? (p.effect ?? "on") : "off"}`);
      }
    }
    if (this._config.pump) parts.push(m.on ? `pump on at ${Math.round(m.speed * 100)}%` : "pump off");
    if (this._config.light) parts.push(m.lightOn ? `light ${m.effect ?? "on"}` : "light off");
    if (this._config.spillover && m.spilling) parts.push("spillover running");
    this._canvas.setAttribute("aria-label", `${parts.join(". ")}.`);
  }
}

if (globalThis.customElements) {
  if (!customElements.get("controlfreak-picture")) {
    customElements.define("controlfreak-picture", ControlFreakPictureCard);
  }
  globalThis.customCards = globalThis.customCards || [];
  if (!globalThis.customCards.some((c) => c.type === "controlfreak-picture")) {
    globalThis.customCards.push({
      type: "controlfreak-picture",
      name: "Control Freak picture",
      description:
        "An animated pool, spa, waterfall, deck jet or bubbler picture driven by a pump and a light, in one of five styles.",
      preview: true,
      documentationURL: DOCS_URL,
    });
  }
}
