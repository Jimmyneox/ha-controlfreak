/**
 * Picture styles for the Control Freak picture card (custom:controlfreak-picture).
 *
 * Five complete looks for the same five scenes (pool, spa, falls, deck, bub):
 *
 *   caustic    the demo's soft caustic water (controlfreak-picture.js, unchanged)
 *   blueprint  a flat plan view: ink lines, flat fills, slow drifting ripple rings
 *   depth      layered realism: refracted tile floor, sun glints, shadowed coping
 *   neon       dark-first: the lights are the only bright things, the water a mirror
 *   poster     a mid-century pool postcard: four flat colours, bold shapes, paper grain
 *
 * Every style reads the same model (pump speed moves the water, the light's
 * effect tints it, night follows the Home Assistant dark theme) and honours the
 * same motion gate (reduced motion -> one still frame; off-screen -> paused).
 * The scene geometry, the simulation and the caustic water buffer come from
 * controlfreak-picture.js; this file only paints. Display only.
 *
 * `makeStyledScene(canvas, scene, style, getModel, getColors)` returns the same
 * object as `makeScene` (resize, start, stop, kick, splash, draw, frames).
 *
 * Scene "overview" is the whole pool from above in one of the shapes from
 * controlfreak-pool-shapes.js: deck and coping around the outline, the water
 * inside it in the chosen style, and the spa, steps, ledge, waterfall rocks,
 * deck jets, bubblers and lights at the shape's anchors, each driven by its
 * own pump and light (see `overview` below).
 */

import {
  addRipple,
  advance,
  bubGeo,
  createSim,
  deckGeo,
  fallGeo,
  fixtures,
  landings,
  makeScene,
  renderWater,
  spaGeo,
  stepLights,
} from "./controlfreak-picture.js";
import { layoutShape, partsOf } from "./controlfreak-pool-shapes.js";

export const STYLES = ["caustic", "blueprint", "depth", "neon", "poster"];
export const DEFAULT_STYLE = "caustic";

export const STYLE_LABELS = {
  caustic: "Caustic",
  blueprint: "Blueprint",
  depth: "Depth",
  neon: "Neon",
  poster: "Poster",
};

/* ----- Small helpers ------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const rnd = (n) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

/** The flat water colour a style starts from: the palette tinted by the light. */
export function flatWater(colors, lc, strength, dark) {
  const base = mix(colors.a, colors.b, dark ? 0.6 : 0.4);
  return mix(base, lc, clamp01(strength) * (dark ? 0.55 : 0.4));
}

/** Where a style's ambient ripple rings sit: the fixtures, else the picture centre. */
export function ringCentres(kind, W, H, model) {
  const lands = landings(kind, W, H, model);
  if (lands.length) return lands.map(([x, y]) => [x / W, y / H]);
  if (kind === "pool") return [
    [0.3, 0.42],
    [0.68, 0.6],
  ];
  if (kind === "spa") {
    const g = spaGeo(W, H);
    return [[g.x / W, g.y / H]];
  }
  return fixtures(kind, W, H, model.speed).map((f) => [f.x, f.y]);
}

/* ----- Engine: canvas, clock and the motion gate, shared by the styles ---- */

function makeEngine(cv, kind, painter, getModel, getColors, rng) {
  const ctx = cv.getContext("2d");
  const buf = document.createElement("canvas");
  const bctx = buf.getContext("2d");
  const sim = createSim();
  let W = 0;
  let H = 0;
  let BW = 150;
  let BH = 100;
  let img = null;
  let last = 0;
  let running = false;
  let frames = 0;
  let grain = null;

  function resize() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (!r.width || !r.height) return;
    W = Math.round(r.width);
    H = Math.round(r.height);
    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    BW = 150;
    BH = Math.max(50, Math.round((BW * H) / W));
    buf.width = BW;
    buf.height = BH;
    img = bctx.createImageData(BW, BH);
    draw();
  }

  /** The caustic water buffer (see renderWater), as a canvas to drawImage. */
  function caustic(S, lightOn = true) {
    renderWater(img.data, BW, BH, sim, {
      kind: S.kind,
      dark: S.dark,
      colors: S.colors,
      fx: S.fx ?? fixtures(S.kind, W, H, S.sp),
      strength: lightOn ? S.strength : 0,
    });
    bctx.putImageData(img, 0, 0);
    return buf;
  }

  /** A paper-grain pattern, built once (deterministic). */
  function paperGrain() {
    if (grain) return grain;
    const g = document.createElement("canvas");
    g.width = 96;
    g.height = 96;
    const gc = g.getContext("2d");
    for (let i = 0; i < 1400; i++) {
      const x = rnd(i * 2 + 1) * 96;
      const y = rnd(i * 2 + 2) * 96;
      gc.fillStyle = i % 2 ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)";
      gc.fillRect(x, y, 1, 1);
    }
    grain = ctx.createPattern(g, "repeat");
    return grain;
  }

  function state() {
    const model = getModel();
    const dark = Boolean(model.dark);
    const colors = getColors();
    const lc = sim.lit.cur;
    const strength = sim.lit.level * (dark ? 1 : 0.7);
    return {
      ctx,
      W,
      H,
      kind,
      sim,
      model,
      dark,
      colors,
      lc,
      strength,
      lit: strength > 0.01,
      on: model.on,
      sp: model.on ? model.speed : 0,
      spilling: model.spilling,
      t: sim.t,
      wt: sim.wt,
      rng,
      caustic,
      paperGrain,
      deck: DECKS.includes(model.deck) ? model.deck : DEFAULT_DECK,
    };
  }

  function draw() {
    if (!img) return;
    const S = state();
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (kind === "overview") overview(S, painter);
    else {
      painter.water(S);
      features(S, painter.theme(S));
    }
    painter.finish?.(S);
    ctx.restore();
    frames++;
  }

  /** Where falling water lands this frame (ripple sources), in pixels. */
  function lands(model) {
    if (kind === "overview") return overviewLandings(W, H, model);
    return landings(kind, W, H, model);
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    const model = getModel();
    advance(sim, dt, model, kind === "overview" ? "pool" : kind);
    const L = lands(model);
    if (L.length && (sim.clock += dt) > 0.85 - 0.5 * (kind === "spa" ? 0.6 : model.speed)) {
      sim.clock = 0;
      const p = L[Math.floor(rng() * L.length)];
      addRipple(sim, p[0] / W, p[1] / H, 1);
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

/* ----- Scene features: one layout, painted through a theme ---------------- */

/**
 * Draws the fixed parts of each scene (deck, coping, spa wall, rock ledge,
 * nozzles, sun shelf) and its moving water (jets, sheets, arcs, domes) through
 * the theme's primitives, so every style shares one layout.
 */
function features(S, T) {
  const { ctx, W, H, kind } = S;
  if (kind === "pool") {
    T.poolEdge();
    if (S.on) T.streaks();
    for (const f of fixtures("pool", W, H, S.sp)) T.fixture(f.x * W, f.y * H);
    return;
  }
  if (kind === "spa") {
    const g = spaGeo(W, H);
    T.deck(g.poolW + 3, 0, W - g.poolW - 3, H);
    T.coping(g.poolW + 3, 0, g.poolW + 3, H);
    T.spaWall(g);
    ctx.save();
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, TAU);
    ctx.clip();
    T.waterDisc(g);
    if (S.on) T.froth(g);
    ctx.restore();
    T.spaRim(g);
    const half = g.r * 0.3;
    const L = g.lipIn;
    T.lip(L[0], L[1] - half, L[0], L[1] + half);
    if (S.spilling) {
      const E = g.land;
      T.sheet([L[0], L[1] - half], [E[0], E[1] - half * 1.15], [E[0], E[1] + half * 1.15], [L[0], L[1] + half], {
        len: L[0] - E[0],
        dir: -1,
        lines: 7,
        speed: 0.9,
      });
      T.foam(E[0], E[1], half * 0.9, half * 1.5);
      T.rings(E[0], E[1], half * 2.4, 0.5);
    }
    return;
  }
  if (kind === "falls") {
    const g = fallGeo(W, H, S.sp);
    T.ledge(g);
    T.lip(g.depth - 5, g.cy - H * 0.2, g.depth, g.cy + H * 0.2);
    for (const f of fixtures("falls", W, H, S.sp)) T.fixture(f.x * W, f.y * H);
    if (!S.on) return;
    const top = g.cy - g.half;
    const bot = g.cy + g.half;
    const E = g.land;
    T.sheet([g.depth, top], [E[0], top - 4], [E[0], bot + 4], [g.depth, bot], {
      len: g.run,
      dir: 1,
      lines: 10,
      speed: 0.45 + S.sp * 0.9,
    });
    T.foam(E[0] + 4, E[1], g.half * 0.9, g.half * 1.4);
    T.rings(E[0] + 6, E[1], g.half * 2.6, 0.5, true);
    return;
  }
  if (kind === "deck") {
    const g = deckGeo(W, H, S.sp);
    T.deck(0, 0, W, g.deckH);
    T.coping(0, g.deckH + 3, W, g.deckH + 3);
    for (const j of g.jets) T.nozzle(j.n[0], j.n[1]);
    if (!S.on) return;
    const lift = 0.35 + 0.25 * S.sp;
    for (const j of g.jets) {
      const [x0, y0] = j.n;
      const [x1, y1] = j.land;
      const L = Math.hypot(x1 - x0, y1 - y0);
      const cx = (x0 + x1) / 2 - L * lift * (j.i === 2 ? -1 : 1);
      const cy = (y0 + y1) / 2 - L * lift * 0.2;
      T.arc(x0, y0, cx, cy, x1, y1, j.i);
      T.foam(x1, y1, 7 + 6 * S.sp, 5 + 4 * S.sp);
    }
    return;
  }
  const g = bubGeo(W, H);
  T.shelf(g.shelfY);
  g.heads.forEach(([x, y], i) => {
    T.head(x, y);
    if (!S.on) return;
    const pulse = 0.88 + 0.12 * Math.sin(S.wt * (6 + S.sp * 6) + i * 1.7);
    T.dome(x, y, (12 + 26 * S.sp) * pulse, i);
  });
}

/* ----- Primitives shared by more than one theme --------------------------- */

/** Streaks running along a sheet of falling water, phase from the clock. */
function sheetLines(S, a, b, c, d, opts, color, width) {
  const { ctx } = S;
  const { len, dir, lines, speed } = opts;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  for (let i = 0; i < lines; i++) {
    const k = (i + 0.5) / lines;
    const y = a[1] + (d[1] - a[1]) * k;
    const ph = (S.wt * speed + rnd(i + 3)) % 1;
    const a0 = ph * len;
    ctx.strokeStyle = color(0.8 * Math.sin(ph * Math.PI));
    ctx.beginPath();
    ctx.moveTo(a[0] + dir * a0, y);
    ctx.lineTo(a[0] + dir * Math.min(len, a0 + 10), y);
    ctx.stroke();
  }
}

function pavers(ctx, x, y, w, h, color, sz = 34) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
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

function hatch(ctx, x, y, w, h, color, gap = 9) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -h; d < w + h; d += gap) {
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d - h, y + h);
  }
  ctx.stroke();
  ctx.restore();
}

/* ----- Deck finishes ------------------------------------------------------ */

/** The surround around the water. Most pools sit in concrete, so that is the default. */
export const DECKS = ["concrete", "pavers", "travertine", "wood", "stone"];
export const DEFAULT_DECK = "concrete";
export const DECK_LABELS = {
  concrete: "Concrete",
  pavers: "Pavers",
  travertine: "Travertine",
  wood: "Wood deck",
  stone: "Flagstone",
};
// Two tones for a soft gradient, and the colour of the joints. Night is the
// same colour, only darker (NIGHT_DIM): a grey deck stays grey after dark.
const DECK_TONES = {
  concrete: { day: [[218, 219, 215], [203, 205, 200]], line: [70, 76, 82] },
  pavers: { day: [[198, 188, 174], [176, 164, 150]], line: [80, 66, 54] },
  travertine: { day: [[239, 231, 216], [220, 210, 191]], line: [120, 100, 70] },
  wood: { day: [[206, 162, 114], [184, 138, 94]], line: [96, 62, 34] },
  stone: { day: [[190, 194, 190], [166, 172, 169]], line: [52, 62, 66] },
};
export const NIGHT_DIM = 0.78;
const dim = (c) => c.map((v) => Math.round(v * NIGHT_DIM));
const deckTones = (finish, dark) => {
  const t = DECK_TONES[finish] ?? DECK_TONES.concrete;
  return dark ? t.day.map(dim) : t.day;
};

/** The finish's base tone, for painters that mix their own palette. */
export function deckTone(finish, dark) {
  return deckTones(finish, dark)[0];
}

/** The joints of a finish, stroked in `color` over x,y,w,h. Deterministic. */
export function deckPattern(ctx, x, y, w, h, finish, color, scale = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  const s = scale;
  switch (finish) {
    case "pavers": {
      // Running bond: every second course shifted by half a brick.
      const bw = 30 * s;
      const bh = 15 * s;
      ctx.beginPath();
      let row = 0;
      for (let gy = y - (y % bh); gy < y + h; gy += bh, row++) {
        ctx.moveTo(x, gy + 0.5);
        ctx.lineTo(x + w, gy + 0.5);
        const off = row % 2 ? bw / 2 : 0;
        for (let gx = x - (x % bw) - bw + off; gx < x + w; gx += bw) {
          ctx.moveTo(gx + 0.5, gy);
          ctx.lineTo(gx + 0.5, gy + bh);
        }
      }
      ctx.stroke();
      break;
    }
    case "travertine":
      // Big square tiles.
      pavers(ctx, x, y, w, h, color, 44 * s);
      break;
    case "wood": {
      // Boards with staggered butt joints.
      const bh = 16 * s;
      const len = 160 * s;
      ctx.beginPath();
      let row = 0;
      for (let gy = y - (y % bh); gy < y + h; gy += bh, row++) {
        ctx.moveTo(x, gy + 0.5);
        ctx.lineTo(x + w, gy + 0.5);
        const jx = x + ((row * 73) % 160) * s;
        for (let gx = jx - len * 3; gx < x + w; gx += len) {
          ctx.moveTo(gx + 0.5, gy);
          ctx.lineTo(gx + 0.5, gy + bh);
        }
      }
      ctx.stroke();
      break;
    }
    case "stone": {
      // Flagstones: one irregular hexagon per cell.
      const cell = 46 * s;
      ctx.lineJoin = "round";
      for (let gy = y - (y % cell) - cell; gy < y + h + cell; gy += cell) {
        for (let gx = x - (x % cell) - cell; gx < x + w + cell; gx += cell) {
          const i = Math.floor(gx / cell) * 131 + Math.floor(gy / cell) * 197;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU + rnd(i + k) * 0.5;
            const r = cell * (0.36 + rnd(i * 3 + k) * 0.12);
            const px = gx + cell / 2 + Math.cos(a) * r;
            const py = gy + cell / 2 + Math.sin(a) * r * 0.85;
            if (k) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      break;
    }
    default: {
      // Concrete: control joints and a light speckle.
      const j = 96 * s;
      ctx.beginPath();
      for (let gx = x - (x % j); gx < x + w; gx += j) {
        ctx.moveTo(gx + 0.5, y);
        ctx.lineTo(gx + 0.5, y + h);
      }
      for (let gy = y - (y % j); gy < y + h; gy += j) {
        ctx.moveTo(x, gy + 0.5);
        ctx.lineTo(x + w, gy + 0.5);
      }
      ctx.stroke();
      const n = Math.min(360, Math.floor((w * h) / 900));
      ctx.globalAlpha = 0.45;
      for (let i = 0; i < n; i++) {
        ctx.fillRect(x + rnd(i * 7 + 1) * w, y + rnd(i * 7 + 4) * h, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/** A finished deck: its gradient and its joints. Used by the picture styles. */
export function deckBase(ctx, x, y, w, h, finish, dark) {
  const t = DECK_TONES[finish] ?? DECK_TONES.concrete;
  const [a, b] = deckTones(finish, dark);
  const gr = ctx.createLinearGradient(x, y, x + w, y + h);
  gr.addColorStop(0, rgb(a));
  gr.addColorStop(1, rgb(b));
  ctx.fillStyle = gr;
  ctx.fillRect(x, y, w, h);
  deckPattern(ctx, x, y, w, h, finish, rgb(t.line, dark ? 0.2 : 0.22));
}

/** The waterfall's ledge outline and rocks, as paths for a theme to fill. */
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

function ledgePath(ctx, g, H) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 0; i <= 12; i++) {
    const y = (i / 12) * H;
    const edge = g.depth * (0.62 + 0.22 * rnd(i + 40) + (Math.abs(y - g.cy) < H * 0.24 ? 0.18 : 0));
    ctx.lineTo(edge, y);
  }
  ctx.lineTo(0, H);
  ctx.closePath();
}

function rockPath(ctx, rk, g) {
  const cx = rk.x * g.depth;
  const cy = g.cy + rk.y * g.hh;
  const r = rk.r * g.hh;
  const n = 7;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU + rk.s;
    const rr = r * (0.78 + rnd(rk.s * 10 + (i % n)) * 0.34);
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr * 0.9;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  return { cx, cy, r };
}

function arcPath(ctx, x0, y0, cx, cy, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
}

function arcPulses(S, x0, y0, cx, cy, x1, y1, i, color, size) {
  const { ctx } = S;
  for (let k = 0; k < 4; k++) {
    const u = (S.wt * (0.5 + S.sp) + k / 4 + i * 0.13) % 1;
    const a = 1 - u;
    const px = a * a * x0 + 2 * a * u * cx + u * u * x1;
    const py = a * a * y0 + 2 * a * u * cy + u * u * y1;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/** Expanding rings (ripples) from a point; `arc` draws half rings facing right. */
function expandingRings(S, x, y, R, alpha, color, n = 2, period = 2.6, arc = false, width = 1.2) {
  const { ctx } = S;
  ctx.lineWidth = width;
  for (let k = 0; k < n; k++) {
    const ph = (S.wt / period + k / n) % 1;
    ctx.strokeStyle = color(alpha * (1 - ph));
    ctx.beginPath();
    if (arc) ctx.ellipse(x, y, R * (0.3 + ph * 0.7), R * (0.45 + ph * 0.6), 0, -Math.PI / 2, Math.PI / 2);
    else ctx.arc(x, y, R * (0.3 + ph * 0.7), 0, TAU);
    ctx.stroke();
  }
}

/** Splash ripples from the simulation (taps and landings), as rings. */
function simRipples(S, color, width = 1.2) {
  const { ctx, W, H, sim } = S;
  ctx.lineWidth = width;
  for (const r of sim.ripples) {
    const k = Math.min(1, r.age / 3.2);
    ctx.strokeStyle = color(0.5 * r.amp * (1 - k));
    ctx.beginPath();
    ctx.ellipse(r.x * W, r.y * H, 6 + r.age * 34, (6 + r.age * 34) * 0.7, 0, 0, TAU);
    ctx.stroke();
  }
}

/* ----- blueprint: ink lines on flat water -------------------------------- */

const blueprint = {
  water(S) {
    const { ctx, W, H, dark } = S;
    const base = flatWater(S.colors, S.lc, S.strength, dark);
    ctx.fillStyle = rgb(mix(base, dark ? [8, 20, 30] : [255, 255, 255], dark ? 0.25 : 0.35));
    ctx.fillRect(0, 0, W, H);
    const ink = (a) => (dark ? `rgba(190,225,240,${a})` : `rgba(12,48,72,${a})`);
    // Depth contours: gentle curves across the water, drifting with the pump.
    ctx.lineWidth = 1;
    const drift = S.sim.flow * 0.25 + S.t * 2;
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = ink(0.16);
      ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 12) {
        const y = H * (0.1 + i * 0.16) + Math.sin((x + drift) * 0.025 + i) * H * 0.03;
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (S.on) {
      // Circulation arrows along the contours, marching with the pump.
      ctx.strokeStyle = ink(0.55);
      ctx.lineWidth = 1.2;
      const gap = 64;
      const a = 4 + 3 * S.sp;
      for (let i = 0; i < 6; i++) {
        const yb = H * (0.1 + i * 0.16);
        const dir = i % 2 ? -1 : 1;
        const off = ((drift * 3 * dir) % gap + gap) % gap;
        for (let x = -gap + off; x <= W + gap; x += gap) {
          const y = yb + Math.sin((x + drift) * 0.025 + i) * H * 0.03;
          ctx.beginPath();
          ctx.moveTo(x - a * dir, y - a * 0.6);
          ctx.lineTo(x, y);
          ctx.lineTo(x - a * dir, y + a * 0.6);
          ctx.stroke();
        }
      }
    }
    // Slow drifting ripple rings from the fixtures and landings.
    const centres = S.centres ?? ringCentres(S.kind, W, H, S.model);
    const maxR = Math.min(W, H) * (S.kind === "pool" ? 0.5 : 0.3);
    for (let c = 0; c < centres.length; c++) {
      const [fx, fy] = centres[c];
      for (let k = 0; k < 4; k++) {
        const ph = (S.t * 0.12 * (0.5 + S.sp * 2) + k / 4 + c * 0.17) % 1;
        ctx.strokeStyle = ink(0.42 * (1 - ph));
        ctx.lineWidth = 1 + (1 - ph);
        ctx.beginPath();
        ctx.ellipse(fx * W, fy * H, maxR * ph, maxR * ph * 0.72, 0, 0, TAU);
        ctx.stroke();
      }
    }
    simRipples(S, ink);
  },
  theme(S) {
    const { ctx, W, H, dark } = S;
    const ink = (a = 0.85) => (dark ? `rgba(190,225,240,${a})` : `rgba(12,48,72,${a})`);
    const paper = dark ? "#121a22" : "#f6f3ea";
    const light = (a = 1) => rgb(S.lc, a);
    const line = (w = 1.5) => {
      ctx.lineWidth = w;
      ctx.strokeStyle = ink();
      ctx.lineCap = "butt";
    };
    return {
      poolEdge() {
        line(2);
        ctx.strokeRect(5, 5, W - 10, H - 10);
        line(1);
        ctx.strokeRect(10, 10, W - 20, H - 20);
        // Main drain and the deep-end mark.
        ctx.beginPath();
        ctx.arc(W * 0.78, H * 0.62, 7, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(W * 0.78 - 5, H * 0.62);
        ctx.lineTo(W * 0.78 + 5, H * 0.62);
        ctx.moveTo(W * 0.78, H * 0.62 - 5);
        ctx.lineTo(W * 0.78, H * 0.62 + 5);
        ctx.stroke();
      },
      streaks() {
        // Flow arrows along the water, faster with the pump.
        line(1);
        for (let i = 0; i < 4; i++) {
          const ph = (S.t * (0.1 + S.sp * 0.35) + i / 4) % 1;
          const x = 24 + ph * (W - 48);
          const y = H * (0.28 + i * 0.15);
          ctx.strokeStyle = ink(0.6 * Math.sin(ph * Math.PI));
          ctx.beginPath();
          ctx.moveTo(x - 14, y);
          ctx.lineTo(x, y);
          ctx.moveTo(x - 4, y - 3);
          ctx.lineTo(x, y);
          ctx.lineTo(x - 4, y + 3);
          ctx.stroke();
        }
      },
      fixture(x, y) {
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, TAU);
        ctx.fillStyle = S.lit ? light(0.9) : paper;
        ctx.fill();
        line(1.2);
        ctx.stroke();
        if (S.lit) {
          ctx.strokeStyle = light(0.5);
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, TAU);
          ctx.stroke();
        }
      },
      deck(x, y, w, h) {
        ctx.fillStyle = paper;
        ctx.fillRect(x, y, w, h);
        if (S.deck === "concrete") hatch(ctx, x, y, w, h, ink(0.22));
        else deckPattern(ctx, x, y, w, h, S.deck, ink(0.3));
        line(1.5);
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      },
      coping(x0, y0, x1, y1) {
        line(2);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      },
      copingPath(trace, w) {
        trace(ctx);
        line(w);
        ctx.strokeStyle = paper;
        ctx.stroke();
        trace(ctx);
        line(1.5);
        ctx.stroke();
        trace(ctx);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      },
      rock(cx, cy, r, sd) {
        ctx.beginPath();
        for (let i = 0; i <= 7; i++) {
          const a = (i / 7) * TAU + sd;
          const rr = r * (0.78 + rnd(sd * 10 + (i % 7)) * 0.34);
          if (i) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9);
          else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9);
        }
        ctx.closePath();
        ctx.fillStyle = paper;
        ctx.fill();
        line(1);
        ctx.stroke();
      },
      steps(x, y, r, ang) {
        line(1.2);
        for (let k = 1; k <= 3; k++) {
          ctx.beginPath();
          ctx.arc(x, y, (r * k) / 3, ang - Math.PI / 2, ang + Math.PI / 2);
          ctx.stroke();
        }
      },
      shelfDisc(x, y, r, ang) {
        ctx.beginPath();
        ctx.arc(x, y, r, ang - Math.PI / 2, ang + Math.PI / 2);
        ctx.closePath();
        ctx.fillStyle = ink(0.07);
        ctx.fill();
        line(1.2);
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      },
      spaWall(g) {
        ctx.fillStyle = paper;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r + g.wall, 0, TAU);
        ctx.fill();
        line(1.5);
        ctx.stroke();
      },
      waterDisc(g) {
        const base = flatWater(S.colors, S.lc, S.strength * 1.3, dark);
        ctx.fillStyle = rgb(base);
        ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
        for (let k = 0; k < 3; k++) {
          const ph = (S.t * 0.1 * (0.5 + S.sp * 2) + k / 3) % 1;
          ctx.strokeStyle = ink(0.45 * (1 - ph));
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(g.x, g.y, g.r * ph, 0, TAU);
          ctx.stroke();
        }
      },
      froth(g) {
        // Jet ticks around the wall, more with speed.
        line(1.2);
        const n = 6 + Math.round(S.sp * 6);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + S.t * 0.4;
          ctx.beginPath();
          ctx.moveTo(g.x + Math.cos(a) * g.r * 0.92, g.y + Math.sin(a) * g.r * 0.92);
          ctx.lineTo(g.x + Math.cos(a) * g.r * (0.74 - S.sp * 0.1), g.y + Math.sin(a) * g.r * (0.74 - S.sp * 0.1));
          ctx.stroke();
        }
      },
      spaRim(g) {
        line(2);
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r, 0, TAU);
        ctx.stroke();
      },
      lip(x0, y0, x1, y1) {
        line(3);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      },
      sheet(a, b, c, d, opts) {
        line(1);
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.moveTo(d[0], d[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        sheetLines(S, a, b, c, d, opts, ink, 1);
      },
      foam(x, y, rx, ry) {
        line(1);
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
        ctx.stroke();
      },
      rings(x, y, R, alpha, arc) {
        expandingRings(S, x, y, R, alpha, ink, 2, 3.2, arc, 1);
      },
      ledge(g) {
        ledgePath(ctx, g, H);
        ctx.fillStyle = paper;
        ctx.fill();
        ctx.save();
        ctx.clip();
        hatch(ctx, 0, 0, g.depth, H, ink(0.2), 7);
        ctx.restore();
        ledgePath(ctx, g, H);
        line(1.5);
        ctx.stroke();
        for (const rk of ROCKS) {
          rockPath(ctx, rk, g);
          ctx.fillStyle = paper;
          ctx.fill();
          line(1);
          ctx.stroke();
        }
      },
      nozzle(x, y) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, TAU);
        ctx.fillStyle = S.lit ? light(0.9) : paper;
        ctx.fill();
        line(1.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x + 8, y);
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x, y + 8);
        ctx.stroke();
      },
      arc(x0, y0, cx, cy, x1, y1, i) {
        line(1.5);
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -S.wt * 30 * (0.5 + S.sp);
        arcPath(ctx, x0, y0, cx, cy, x1, y1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        arcPulses(S, x0, y0, cx, cy, x1, y1, i, ink(0.9), 1.6);
      },
      shelf(y) {
        line(1.5);
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ink(0.06);
        ctx.fillRect(0, y, W, H - y);
      },
      head(x, y) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, TAU);
        ctx.fillStyle = S.lit ? light(0.9) : paper;
        ctx.fill();
        line(1.2);
        ctx.stroke();
      },
      dome(x, y, R) {
        expandingRings(S, x, y, R * 2.2, 0.7, ink, 3, 2.2, false, 1.2);
        line(1.5);
        ctx.beginPath();
        ctx.arc(x, y, R * 0.5, 0, TAU);
        ctx.stroke();
      },
    };
  },
};

/* ----- depth: refracted tile floor under caustic water -------------------- */

const depth = {
  water(S) {
    const { ctx, W, H, dark, kind } = S;
    const spa = kind === "spa";
    const buf = S.caustic(S, !spa);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(buf, 0, 0, W, H);
    // The tiled floor, seen through moving water: the grid bends with the waves.
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = dark ? "rgba(160,215,235,0.2)" : "rgba(255,255,255,0.5)";
    const sz = Math.max(22, Math.min(W, H) * 0.14);
    const wob = 2.2 + S.sp * 2;
    const t = S.t;
    ctx.beginPath();
    for (let gx = sz; gx < W; gx += sz) {
      for (let y = 0; y <= H; y += 6) {
        const x = gx + Math.sin(y * 0.05 + t * 1.3 + gx * 0.01) * wob;
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    for (let gy = sz; gy < H; gy += sz) {
      for (let x = 0; x <= W; x += 6) {
        const y = gy + Math.sin(x * 0.045 - t * 1.1 + gy * 0.01) * wob;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
    // Sun glints by day, moon glints at night: short sparkles that come and go.
    const glints = dark ? 7 : 16;
    for (let i = 0; i < glints; i++) {
      const ph = (t * (0.35 + S.sp * 0.6) + rnd(i + 70)) % 1;
      const a = Math.sin(ph * Math.PI);
      const x = rnd(i * 3 + 1) * W;
      const y = rnd(i * 3 + 2) * H;
      ctx.fillStyle = dark ? `rgba(200,240,255,${0.35 * a})` : `rgba(255,255,255,${0.75 * a})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + a * 6, 1 + a * 1.5, 0.3, 0, TAU);
      ctx.fill();
    }
    // Depth: the far side is deeper and darker; a soft vignette on the edges.
    const vg = ctx.createRadialGradient(W * 0.45, H * 0.4, Math.min(W, H) * 0.3, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, dark ? "rgba(0,0,0,0.45)" : "rgba(8,40,60,0.22)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    // The light's glow in the water.
    if (S.lit && !spa) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const f of S.fx ?? fixtures(kind, W, H, S.sp)) {
        const px = f.x * W;
        const py = f.y * H;
        const g = ctx.createRadialGradient(px, py, 0, px, py, Math.max(W, H) * (kind === "pool" ? 0.55 : 0.35));
        g.addColorStop(0, rgb(S.lc, 0.45 * S.strength));
        g.addColorStop(0.4, rgb(S.lc, 0.15 * S.strength));
        g.addColorStop(1, rgb(S.lc, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }
    simRipples(S, (a) => `rgba(255,255,255,${a})`, 1.4);
  },
  theme(S) {
    const { ctx, W, H, dark } = S;
    const white = (a) => `rgba(255,255,255,${a})`;
    const shadowOn = (blur, ox, oy) => {
      ctx.shadowColor = dark ? "rgba(0,0,0,0.6)" : "rgba(30,40,50,0.32)";
      ctx.shadowBlur = blur;
      ctx.shadowOffsetX = ox;
      ctx.shadowOffsetY = oy;
    };
    const shadowOff = () => {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    };
    const foamAt = (x, y, rx, ry, a) => {
      const fm = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      fm.addColorStop(0, white(a));
      fm.addColorStop(1, white(0));
      ctx.fillStyle = fm;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
      ctx.fill();
    };
    return {
      poolEdge() {
        // Coping all round, with its shadow falling onto the water.
        const edge = ctx.createLinearGradient(0, 0, 0, 14);
        edge.addColorStop(0, dark ? "rgba(0,0,0,0.5)" : "rgba(8,40,60,0.35)");
        edge.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = edge;
        ctx.fillRect(0, 0, W, 14);
        ctx.lineWidth = 6;
        ctx.strokeStyle = dark ? "#55504a" : "#f1ebdf";
        ctx.strokeRect(3, 3, W - 6, H - 6);
        ctx.lineWidth = 1;
        ctx.strokeStyle = dark ? "rgba(255,255,255,0.12)" : "rgba(120,100,70,0.3)";
        ctx.strokeRect(6.5, 6.5, W - 13, H - 13);
      },
      streaks() {
        ctx.lineCap = "round";
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const ph = (S.t * (0.25 + S.sp * 0.9) + i / 6) % 1;
          const x0 = 18 + ph * (W * 0.55);
          const y0 = H * 0.3 + Math.sin(i * 1.3) * 8 + i * (H * 0.09);
          ctx.strokeStyle = white(0.35 * Math.sin(ph * Math.PI));
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + 22 + S.sp * 34, y0 + 2);
          ctx.stroke();
        }
      },
      fixture(x, y) {
        // A recessed niche light in the wall.
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, TAU);
        ctx.fillStyle = dark ? "#1b1f24" : "#9aa3a8";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, TAU);
        ctx.fillStyle = S.lit ? rgb(mix(S.lc, [255, 255, 255], 0.5)) : dark ? "#333" : "#d8dde0";
        ctx.fill();
      },
      deck(x, y, w, h) {
        deckBase(ctx, x, y, w, h, S.deck, dark);
      },
      coping(x0, y0, x1, y1) {
        ctx.save();
        shadowOn(10, x0 === x1 ? -4 : 0, x0 === x1 ? 0 : 5);
        ctx.lineCap = "butt";
        ctx.lineWidth = 8;
        ctx.strokeStyle = dark ? "#5d5850" : "#f4efe5";
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.restore();
      },
      copingPath(trace, w) {
        ctx.save();
        shadowOn(12, 0, 4);
        trace(ctx);
        ctx.lineJoin = "round";
        ctx.lineWidth = w;
        ctx.strokeStyle = dark ? "#5d5850" : "#f4efe5";
        ctx.stroke();
        ctx.restore();
        trace(ctx);
        ctx.lineWidth = 1;
        ctx.strokeStyle = dark ? "rgba(255,255,255,0.12)" : "rgba(120,100,70,0.3)";
        ctx.stroke();
      },
      rock(cx, cy, r, sd) {
        const stone = dark ? [104, 96, 84] : [196, 184, 162];
        ctx.save();
        shadowOn(10, 3, 4);
        ctx.beginPath();
        for (let i = 0; i <= 7; i++) {
          const a = (i / 7) * TAU + sd;
          const rr = r * (0.78 + rnd(sd * 10 + (i % 7)) * 0.34);
          if (i) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9);
          else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9);
        }
        ctx.closePath();
        const sh = 0.86 + rnd(sd) * 0.22;
        const gr = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        gr.addColorStop(0, `rgb(${stone.map((c) => Math.min(255, c * sh * 1.2) | 0)})`);
        gr.addColorStop(1, `rgb(${stone.map((c) => (c * sh * 0.68) | 0)})`);
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.restore();
      },
      steps(x, y, r, ang) {
        for (let k = 3; k >= 1; k--) {
          ctx.beginPath();
          ctx.arc(x, y, (r * k) / 3, ang - Math.PI / 2, ang + Math.PI / 2);
          ctx.closePath();
          ctx.fillStyle = white(0.1 + (3 - k) * 0.07);
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(8,50,64,0.3)";
          ctx.stroke();
        }
      },
      shelfDisc(x, y, r, ang) {
        ctx.beginPath();
        ctx.arc(x, y, r, ang - Math.PI / 2, ang + Math.PI / 2);
        ctx.closePath();
        ctx.fillStyle = white(dark ? 0.1 : 0.3);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = white(dark ? 0.2 : 0.7);
        ctx.stroke();
      },
      spaWall(g) {
        ctx.save();
        shadowOn(18, -5, 7);
        const gr = ctx.createRadialGradient(g.x - g.r * 0.4, g.y - g.r * 0.4, g.r * 0.2, g.x, g.y, g.r + g.wall);
        gr.addColorStop(0, dark ? "#7a7265" : "#e6dbc3");
        gr.addColorStop(1, dark ? "#55503f" : "#c9bb9e");
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r + g.wall, 0, TAU);
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.restore();
      },
      waterDisc(g) {
        const buf = S.caustic(S, true);
        ctx.drawImage(buf, 0, 0, W, H);
        // Tile ring below the water line and the light's glow.
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r * 0.86, 0, TAU);
        ctx.lineWidth = g.r * 0.24;
        ctx.strokeStyle = dark ? "rgba(160,220,235,0.08)" : "rgba(255,255,255,0.22)";
        ctx.stroke();
        if (S.lit) {
          ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
          const sl = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r * 1.1);
          sl.addColorStop(0, rgb(S.lc, 0.6 * S.strength));
          sl.addColorStop(1, rgb(S.lc, 0.2 * S.strength));
          ctx.fillStyle = sl;
          ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
          ctx.globalCompositeOperation = "source-over";
        }
        // Inner shadow of the wall on the water.
        const sh = ctx.createRadialGradient(g.x, g.y, g.r * 0.7, g.x, g.y, g.r);
        sh.addColorStop(0, "rgba(0,0,0,0)");
        sh.addColorStop(1, dark ? "rgba(0,0,0,0.5)" : "rgba(10,40,60,0.3)");
        ctx.fillStyle = sh;
        ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
      },
      froth(g) {
        const js = S.sp;
        const fr = ctx.createRadialGradient(g.x, g.y, g.r * 0.3, g.x, g.y, g.r);
        fr.addColorStop(0, white(0.03 + 0.06 * js));
        fr.addColorStop(1, white(0.14 + 0.36 * js));
        ctx.fillStyle = fr;
        ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
        for (let k = 0; k < 24 + js * 40; k++) {
          const a = rnd(k * 5 + 1) * TAU + S.wt * (0.3 + js * 0.6) * (k % 2 ? 1 : -1);
          const rr = g.r * (0.5 + rnd(k * 5 + 2) * 0.45);
          const life = (S.wt * (0.4 + rnd(k) * 0.4) + rnd(k * 5 + 3)) % 1;
          ctx.beginPath();
          ctx.arc(g.x + Math.cos(a) * rr, g.y + Math.sin(a) * rr, 1 + life * 2.4, 0, TAU);
          ctx.fillStyle = white(0.6 * (1 - life));
          ctx.fill();
        }
      },
      spaRim(g) {
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r, 0, TAU);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = dark ? "rgba(0,0,0,0.4)" : "rgba(120,100,70,0.3)";
        ctx.stroke();
      },
      lip(x0, y0, x1, y1) {
        ctx.lineCap = "round";
        ctx.lineWidth = 5;
        ctx.strokeStyle = dark ? "#9aa6a8" : "#c9d1d3";
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      },
      sheet(a, b, c, d, opts) {
        const gr = ctx.createLinearGradient(a[0], 0, b[0], 0);
        gr.addColorStop(0, "rgba(240,252,255,0.9)");
        gr.addColorStop(0.6, "rgba(235,250,255,0.5)");
        gr.addColorStop(1, "rgba(235,250,255,0.08)");
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fillStyle = gr;
        ctx.fill();
        if (S.lit) {
          ctx.fillStyle = rgb(S.lc, 0.35 * S.strength);
          ctx.fill();
        }
        sheetLines(S, a, b, c, d, opts, white, 1.5);
      },
      foam(x, y, rx, ry) {
        for (let k = 0; k < 3; k++) {
          const pulse = 0.85 + 0.15 * Math.sin((S.wt / [1.1, 1.5, 0.9][k]) * TAU + k);
          foamAt(x + k * 3, y + (k - 1) * ry * 0.3, rx * pulse, ry * pulse, 0.5);
        }
      },
      rings(x, y, R, alpha, arc) {
        expandingRings(S, x, y, R, alpha, white, 2, 2.6, arc, 1.2);
      },
      ledge(g) {
        const stone = dark ? [104, 96, 84] : [196, 184, 162];
        ctx.save();
        shadowOn(18, 6, 8);
        ledgePath(ctx, g, H);
        ctx.fillStyle = `rgb(${stone.map((c) => (c * 0.6) | 0)})`;
        ctx.fill();
        shadowOff();
        for (const rk of ROCKS) {
          const { cx, cy, r } = rockPath(ctx, rk, g);
          const sh = 0.86 + rnd(rk.s) * 0.22;
          const gr = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
          gr.addColorStop(0, `rgb(${stone.map((c) => Math.min(255, c * sh * 1.2) | 0)})`);
          gr.addColorStop(1, `rgb(${stone.map((c) => (c * sh * 0.68) | 0)})`);
          ctx.fillStyle = gr;
          ctx.fill();
          // Wet sheen where the water runs.
          if (S.on && Math.abs(cy - g.cy) < g.half * 1.4 && cx > g.depth * 0.4) {
            ctx.fillStyle = white(0.18);
            ctx.fill();
          }
        }
        ctx.restore();
      },
      nozzle(x, y) {
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, TAU);
        ctx.fillStyle = dark ? "#15161a" : "#8f8a80";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, TAU);
        ctx.fillStyle = S.lit ? rgb(S.lc) : dark ? "#555" : "#c9c4ba";
        ctx.fill();
      },
      arc(x0, y0, cx, cy, x1, y1, i) {
        ctx.lineCap = "round";
        ctx.lineWidth = 3;
        ctx.strokeStyle = dark ? "rgba(0,0,0,0.3)" : "rgba(8,50,64,0.2)";
        ctx.beginPath();
        ctx.moveTo(x0, y0 + 4);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        arcPath(ctx, x0, y0, cx, cy, x1, y1);
        ctx.lineWidth = 7 + 3 * S.sp;
        ctx.strokeStyle = S.lit ? rgb(S.lc, 0.85) : dark ? "rgba(200,240,255,0.45)" : "rgba(11,90,120,0.35)";
        if (S.lit) {
          ctx.shadowColor = rgb(S.lc, 1);
          ctx.shadowBlur = 14;
        }
        ctx.stroke();
        shadowOff();
        ctx.lineWidth = 2.2 + 1.2 * S.sp;
        ctx.strokeStyle = white(0.95);
        ctx.stroke();
        arcPulses(S, x0, y0, cx, cy, x1, y1, i, white(0.95), 1.6 + S.sp);
      },
      shelf(y) {
        const gr = ctx.createLinearGradient(0, y, 0, H);
        gr.addColorStop(0, dark ? "rgba(200,240,250,0.12)" : "rgba(255,255,255,0.4)");
        gr.addColorStop(1, dark ? "rgba(200,240,250,0.04)" : "rgba(255,255,255,0.18)");
        ctx.fillStyle = gr;
        ctx.fillRect(0, y, W, H - y);
        ctx.lineWidth = 2;
        ctx.strokeStyle = dark ? "rgba(200,240,250,0.2)" : white(0.75);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      },
      head(x, y) {
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, TAU);
        ctx.fillStyle = dark ? "rgba(0,0,0,0.45)" : "rgba(60,90,100,0.4)";
        ctx.fill();
      },
      dome(x, y, R, i) {
        if (S.lit) {
          foamAt(x, y, R * 1.6, R * 1.6, 0.5 * S.strength);
          ctx.fillStyle = rgb(S.lc, 0.35 * S.strength);
          ctx.beginPath();
          ctx.arc(x, y, R * 1.2, 0, TAU);
          ctx.fill();
        }
        foamAt(x, y, R, R, 0.95);
        ctx.beginPath();
        ctx.arc(x, y, R * 0.38, 0, TAU);
        ctx.fillStyle = white(0.9);
        ctx.fill();
        expandingRings(S, x, y, R * 2.6, 0.5, white, 2, 2, false, 1.2);
        for (let k = 0; k < 6; k++) {
          const a = rnd(i * 10 + k) * TAU + S.wt * 0.6;
          const u = (S.wt * (1 + S.sp) + rnd(k + i * 7)) % 1;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * R * 1.3 * u, y + Math.sin(a) * R * 1.3 * u, 1.4, 0, TAU);
          ctx.fillStyle = white(0.8 * (1 - u));
          ctx.fill();
        }
      },
    };
  },
};

/* ----- neon: a dark mirror, lit only by the lights ------------------------ */

const neon = {
  water(S) {
    const { ctx, W, H, dark, kind } = S;
    // Night is the native state; day only dims the glow.
    const glow = dark ? 1 : 0.55;
    const lc = S.lit ? S.lc : [34, 211, 230];
    const ls = S.lit ? S.strength : 0.22;
    ctx.fillStyle = dark ? "#04080f" : "#0b1420";
    ctx.fillRect(0, 0, W, H);
    // Reflections: soft vertical bars of the light's colour under each fixture.
    const fx = S.fx ?? fixtures(kind, W, H, S.sp);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < fx.length; i++) {
      const px = fx[i].x * W + Math.sin(S.t * 0.9 + i) * 6;
      const py = fx[i].y * H;
      const half = W * 0.08;
      const gr = ctx.createLinearGradient(px - half, 0, px + half, 0);
      gr.addColorStop(0, rgb(lc, 0));
      gr.addColorStop(0.5, rgb(lc, 0.22 * ls * glow));
      gr.addColorStop(1, rgb(lc, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(px - half, 0, half * 2, H);
      const halo = ctx.createRadialGradient(px, py, 0, px, py, Math.max(W, H) * 0.45);
      halo.addColorStop(0, rgb(lc, 0.5 * ls * glow));
      halo.addColorStop(0.3, rgb(lc, 0.16 * ls * glow));
      halo.addColorStop(1, rgb(lc, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    // Wave lines: thin horizontal ripples that drift with the pump.
    ctx.lineWidth = 1;
    const rows = 11;
    for (let i = 0; i < rows; i++) {
      const y0 = (i + 0.5) * (H / rows);
      const a = 0.14 + 0.26 * Math.abs(Math.sin(i * 1.7 + S.t * 0.5));
      ctx.strokeStyle = rgb(mix(lc, [120, 220, 240], S.lit ? 0.2 : 0.8), a * glow);
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = y0 + Math.sin((x + S.sim.flow * 2) * 0.03 + S.t * 1.4 + i) * (1.5 + S.sp * 3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    simRipples(S, (a) => rgb(lc, a * glow), 1.2);
  },
  theme(S) {
    const { ctx, W, H, dark } = S;
    const glow = dark ? 1 : 0.55;
    const lc = S.lit ? S.lc : [34, 211, 230];
    const edge = (a = 0.9) => rgb(lc, a * glow);
    const fill = "#0a0e14";
    const neonLine = (w = 1.5, a = 0.9) => {
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.strokeStyle = edge(a);
      ctx.shadowColor = rgb(lc, 0.9 * glow);
      ctx.shadowBlur = 10 * glow;
    };
    const off = () => {
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
    };
    const white = (a) => `rgba(235,250,255,${a})`;
    return {
      poolEdge() {
        neonLine(2);
        ctx.strokeRect(6, 6, W - 12, H - 12);
        off();
      },
      streaks() {
        neonLine(1.5, 0.7);
        for (let i = 0; i < 5; i++) {
          const ph = (S.t * (0.25 + S.sp * 0.9) + i / 5) % 1;
          const x0 = 20 + ph * (W * 0.6);
          const y0 = H * (0.25 + i * 0.13);
          ctx.globalAlpha = Math.sin(ph * Math.PI);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + 18 + S.sp * 30, y0);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        off();
      },
      fixture(x, y) {
        const r = S.lit ? 5 + S.strength * 2 : 4;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
        g.addColorStop(0, rgb(lc, (S.lit ? 0.9 : 0.3) * glow));
        g.addColorStop(1, rgb(lc, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = S.lit ? white(0.95) : rgb(lc, 0.5);
        ctx.fill();
      },
      deck(x, y, w, h) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
        deckPattern(ctx, x, y, w, h, S.deck, rgb(lc, 0.12 * glow));
      },
      coping(x0, y0, x1, y1) {
        neonLine(2);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        off();
      },
      copingPath(trace, w) {
        trace(ctx);
        ctx.lineJoin = "round";
        ctx.lineWidth = w;
        ctx.strokeStyle = "#141920";
        ctx.stroke();
        trace(ctx);
        neonLine(2);
        ctx.stroke();
        off();
      },
      rock(cx, cy, r, sd) {
        ctx.beginPath();
        for (let i = 0; i <= 7; i++) {
          const a = (i / 7) * TAU + sd;
          const rr = r * (0.78 + rnd(sd * 10 + (i % 7)) * 0.34);
          if (i) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9);
          else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9);
        }
        ctx.closePath();
        ctx.fillStyle = "#11161d";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgb(lc, 0.35 * glow);
        ctx.stroke();
      },
      steps(x, y, r, ang) {
        ctx.lineWidth = 1;
        for (let k = 1; k <= 3; k++) {
          ctx.strokeStyle = rgb(lc, 0.35 * glow);
          ctx.beginPath();
          ctx.arc(x, y, (r * k) / 3, ang - Math.PI / 2, ang + Math.PI / 2);
          ctx.stroke();
        }
      },
      shelfDisc(x, y, r, ang) {
        ctx.beginPath();
        ctx.arc(x, y, r, ang - Math.PI / 2, ang + Math.PI / 2);
        ctx.closePath();
        ctx.fillStyle = rgb(lc, 0.06 * glow);
        ctx.fill();
        neonLine(1.2, 0.5);
        ctx.stroke();
        off();
      },
      spaWall(g) {
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r + g.wall, 0, TAU);
        ctx.fillStyle = fill;
        ctx.fill();
        neonLine(1.5, 0.6);
        ctx.stroke();
        off();
      },
      waterDisc(g) {
        ctx.fillStyle = dark ? "#050b14" : "#0c1726";
        ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const halo = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
        halo.addColorStop(0, rgb(lc, (S.lit ? 0.7 * S.strength : 0.2) * glow));
        halo.addColorStop(1, rgb(lc, 0.05 * glow));
        ctx.fillStyle = halo;
        ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
        ctx.restore();
        ctx.lineWidth = 1;
        for (let k = 0; k < 4; k++) {
          const ph = (S.t * 0.18 * (0.5 + S.sp * 2) + k / 4) % 1;
          ctx.strokeStyle = rgb(lc, 0.5 * (1 - ph) * glow);
          ctx.beginPath();
          ctx.arc(g.x, g.y, g.r * ph, 0, TAU);
          ctx.stroke();
        }
      },
      froth(g) {
        for (let k = 0; k < 20 + S.sp * 40; k++) {
          const a = rnd(k * 5 + 1) * TAU + S.wt * (0.3 + S.sp * 0.6) * (k % 2 ? 1 : -1);
          const rr = g.r * (0.5 + rnd(k * 5 + 2) * 0.45);
          const life = (S.wt * (0.4 + rnd(k) * 0.4) + rnd(k * 5 + 3)) % 1;
          ctx.beginPath();
          ctx.arc(g.x + Math.cos(a) * rr, g.y + Math.sin(a) * rr, 1 + life * 2, 0, TAU);
          ctx.fillStyle = white(0.7 * (1 - life) * glow);
          ctx.fill();
        }
      },
      spaRim(g) {
        neonLine(2);
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r, 0, TAU);
        ctx.stroke();
        off();
      },
      lip(x0, y0, x1, y1) {
        neonLine(3, 0.8);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        off();
      },
      sheet(a, b, c, d, opts) {
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fillStyle = rgb(lc, 0.14 * glow);
        ctx.fill();
        ctx.shadowColor = rgb(lc, 0.9 * glow);
        ctx.shadowBlur = 8 * glow;
        sheetLines(S, a, b, c, d, opts, white, 1.4);
        off();
      },
      foam(x, y, rx, ry) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const fm = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
        fm.addColorStop(0, white(0.5 * glow));
        fm.addColorStop(0.5, rgb(lc, 0.3 * glow));
        fm.addColorStop(1, rgb(lc, 0));
        ctx.fillStyle = fm;
        ctx.beginPath();
        ctx.ellipse(x, y, rx * 1.3, ry * 1.3, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      },
      rings(x, y, R, alpha, arc) {
        expandingRings(S, x, y, R, alpha * glow, (a) => rgb(lc, a), 2, 2.6, arc, 1.2);
      },
      ledge(g) {
        ledgePath(ctx, g, H);
        ctx.fillStyle = fill;
        ctx.fill();
        neonLine(1.5, 0.7);
        ctx.stroke();
        off();
        for (const rk of ROCKS) {
          rockPath(ctx, rk, g);
          ctx.fillStyle = "#11161d";
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = rgb(lc, 0.35 * glow);
          ctx.stroke();
        }
      },
      nozzle(x, y) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, TAU);
        ctx.fillStyle = "#15161a";
        ctx.fill();
        neonLine(1.2, 0.8);
        ctx.stroke();
        off();
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, TAU);
        ctx.fillStyle = S.lit ? white(0.95) : rgb(lc, 0.6);
        ctx.fill();
      },
      arc(x0, y0, cx, cy, x1, y1, i) {
        neonLine(5 + 2 * S.sp, 0.5);
        ctx.shadowBlur = 16 * glow;
        arcPath(ctx, x0, y0, cx, cy, x1, y1);
        ctx.stroke();
        ctx.lineWidth = 1.6 + S.sp;
        ctx.strokeStyle = white(0.95);
        ctx.stroke();
        off();
        arcPulses(S, x0, y0, cx, cy, x1, y1, i, white(0.95), 1.8 + S.sp);
      },
      shelf(y) {
        ctx.fillStyle = rgb(lc, 0.05 * glow);
        ctx.fillRect(0, y, W, H - y);
        neonLine(1.5, 0.7);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        off();
      },
      head(x, y) {
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, TAU);
        ctx.fillStyle = S.lit ? white(0.9) : rgb(lc, 0.5);
        ctx.fill();
      },
      dome(x, y, R) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(x, y, 0, x, y, R * 1.8);
        g.addColorStop(0, white(0.7 * glow));
        g.addColorStop(0.35, rgb(lc, 0.45 * glow));
        g.addColorStop(1, rgb(lc, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, R * 1.8, 0, TAU);
        ctx.fill();
        ctx.restore();
        expandingRings(S, x, y, R * 2.6, 0.6 * glow, (a) => rgb(lc, a), 3, 2, false, 1.2);
      },
    };
  },
};

/* ----- poster: a mid-century pool postcard -------------------------------- */

function posterPalette(S) {
  const { dark } = S;
  const paper = dark ? [36, 40, 52] : [246, 236, 214];
  const navy = dark ? [200, 208, 224] : [31, 58, 95];
  const sand = dark ? [96, 86, 70] : [226, 190, 140];
  const water = flatWater(S.colors, S.lc, S.strength, dark);
  const accent = S.lit ? S.lc : dark ? [255, 150, 120] : [255, 107, 87];
  return { paper, navy, sand, water, accent };
}

const poster = {
  water(S) {
    const { ctx, W, H } = S;
    const P = posterPalette(S);
    // Three flat bands of water, each a touch deeper.
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = rgb(mix(P.water, [0, 0, 0], i * 0.09));
      ctx.fillRect(0, (H * i) / 3, W, H / 3 + 1);
    }
    // Bold concentric ripple rings, breathing slowly with the pump.
    const centres = S.centres ?? ringCentres(S.kind, W, H, S.model);
    const maxR = Math.min(W, H) * (S.kind === "pool" ? 0.55 : 0.32);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    for (let c = 0; c < centres.length; c++) {
      const [fx, fy] = centres[c];
      for (let k = 1; k <= 4; k++) {
        const breathe = 1 + 0.07 * Math.sin(S.t * 1.5 * (0.5 + S.sp) + k * 0.9 + c);
        const r = (maxR * k * breathe) / 4.6;
        ctx.strokeStyle = rgb(P.paper, 0.75 - k * 0.12);
        ctx.beginPath();
        ctx.ellipse(fx * W, fy * H, r, r * 0.62, 0, 0, TAU);
        ctx.stroke();
      }
    }
    // Flat highlights: a few paper-coloured bars where the sun catches the water.
    for (let i = 0; i < 5; i++) {
      const ph = (S.t * 0.08 * (0.5 + S.sp * 2) + i / 5) % 1;
      const x = ph * W;
      const y = H * (0.18 + i * 0.16);
      ctx.fillStyle = rgb(P.paper, 0.55);
      ctx.fillRect(x, y, 18 + S.sp * 20, 3);
    }
    simRipples(S, (a) => rgb(P.paper, a), 2.5);
  },
  theme(S) {
    const { ctx, W, H } = S;
    const P = posterPalette(S);
    const outline = (w = 2) => {
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = rgb(P.navy);
    };
    const flatCircle = (x, y, r, c, w = 2) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = rgb(c);
      ctx.fill();
      outline(w);
      ctx.stroke();
    };
    return {
      poolEdge() {
        outline(6);
        ctx.strokeStyle = rgb(P.paper);
        ctx.strokeRect(4, 4, W - 8, H - 8);
        outline(2);
        ctx.strokeRect(8, 8, W - 16, H - 16);
      },
      streaks() {
        // Stylised wave marks, three humps each, sliding with the pump.
        outline(2.5);
        ctx.strokeStyle = rgb(P.paper, 0.9);
        for (let i = 0; i < 4; i++) {
          const ph = (S.t * (0.12 + S.sp * 0.4) + i / 4) % 1;
          const x = ph * (W + 60) - 60;
          const y = H * (0.3 + i * 0.14);
          ctx.beginPath();
          for (let k = 0; k < 3; k++) ctx.arc(x + k * 14, y, 7, Math.PI, 0);
          ctx.stroke();
        }
      },
      fixture(x, y) {
        if (S.lit) {
          ctx.fillStyle = rgb(P.accent, 0.35);
          ctx.beginPath();
          ctx.arc(x, y, 26, 0, TAU);
          ctx.fill();
          // A sunburst of flat rays.
          outline(2);
          ctx.strokeStyle = rgb(P.accent, 0.8);
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * TAU + S.t * 0.3;
            ctx.beginPath();
            ctx.moveTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12);
            ctx.lineTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20);
            ctx.stroke();
          }
        }
        flatCircle(x, y, 6, S.lit ? P.accent : P.paper);
      },
      deck(x, y, w, h) {
        // The paper takes the finish's tone; the joints stay poster-bold.
        ctx.fillStyle = rgb(mix(P.paper, deckTone(S.deck, S.dark), 0.55));
        ctx.fillRect(x, y, w, h);
        deckPattern(ctx, x, y, w, h, S.deck, rgb(P.sand, 0.9), 1.3);
      },
      coping(x0, y0, x1, y1) {
        outline(7);
        ctx.strokeStyle = rgb(P.sand);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        outline(2);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      },
      copingPath(trace, w) {
        trace(ctx);
        outline(w);
        ctx.strokeStyle = rgb(P.sand);
        ctx.stroke();
        trace(ctx);
        outline(2.5);
        ctx.stroke();
      },
      rock(cx, cy, r, sd) {
        ctx.beginPath();
        for (let i = 0; i <= 7; i++) {
          const a = (i / 7) * TAU + sd;
          const rr = r * (0.78 + rnd(sd * 10 + (i % 7)) * 0.34);
          if (i) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9);
          else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9);
        }
        ctx.closePath();
        ctx.fillStyle = rgb(mix(P.sand, P.paper, 0.3 + rnd(sd) * 0.4));
        ctx.fill();
        outline(2);
        ctx.stroke();
      },
      steps(x, y, r, ang) {
        for (let k = 3; k >= 1; k--) {
          ctx.beginPath();
          ctx.arc(x, y, (r * k) / 3, ang - Math.PI / 2, ang + Math.PI / 2);
          ctx.closePath();
          ctx.fillStyle = rgb(P.paper, 0.18 + (3 - k) * 0.14);
          ctx.fill();
          outline(2);
          ctx.stroke();
        }
      },
      shelfDisc(x, y, r, ang) {
        ctx.beginPath();
        ctx.arc(x, y, r, ang - Math.PI / 2, ang + Math.PI / 2);
        ctx.closePath();
        ctx.fillStyle = rgb(P.paper, 0.35);
        ctx.fill();
        outline(2.5);
        ctx.stroke();
      },
      spaWall(g) {
        flatCircle(g.x, g.y, g.r + g.wall, P.sand, 2.5);
      },
      waterDisc(g) {
        const w = flatWater(S.colors, S.lc, S.strength * 1.4, S.dark);
        ctx.fillStyle = rgb(w);
        ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
        ctx.lineWidth = 2.5;
        for (let k = 1; k <= 3; k++) {
          const breathe = 1 + 0.07 * Math.sin(S.t * 1.5 * (0.5 + S.sp) + k);
          ctx.strokeStyle = rgb(P.paper, 0.8 - k * 0.15);
          ctx.beginPath();
          ctx.arc(g.x, g.y, (g.r * k * breathe) / 3.6, 0, TAU);
          ctx.stroke();
        }
      },
      froth(g) {
        // Flat bubbles, a ring of paper dots turning with the jets.
        const n = 10 + Math.round(S.sp * 8);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + S.wt * (0.5 + S.sp);
          const rr = g.r * (0.55 + 0.3 * rnd(i));
          ctx.beginPath();
          ctx.arc(g.x + Math.cos(a) * rr, g.y + Math.sin(a) * rr, 2.5 + rnd(i + 20) * 2.5, 0, TAU);
          ctx.fillStyle = rgb(P.paper, 0.9);
          ctx.fill();
        }
      },
      spaRim(g) {
        outline(2.5);
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r, 0, TAU);
        ctx.stroke();
      },
      lip(x0, y0, x1, y1) {
        outline(5);
        ctx.strokeStyle = rgb(P.paper);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        outline(1.5);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      },
      sheet(a, b, c, d, opts) {
        // A flat white sheet with a scalloped falling edge.
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        const n = 5;
        for (let k = 0; k <= n; k++) {
          const u = k / n;
          const x = b[0] + (c[0] - b[0]) * u;
          const y = b[1] + (c[1] - b[1]) * u;
          const bulge = opts.dir * 5 * (k % 2 ? 1 : 0.2);
          ctx.quadraticCurveTo(x + bulge, y, x, y + (c[1] - b[1]) / n / 2);
        }
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fillStyle = rgb(P.paper, 0.92);
        ctx.fill();
        outline(1.5);
        ctx.stroke();
        sheetLines(S, a, b, c, d, opts, (al) => rgb(P.navy, al * 0.5), 1.5);
      },
      foam(x, y, rx, ry) {
        // Cloud of flat circles.
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU;
          flatCircle(x + Math.cos(a) * rx * 0.5, y + Math.sin(a) * ry * 0.5, Math.max(3, rx * 0.5), P.paper, 1.5);
        }
      },
      rings(x, y, R, alpha, arc) {
        expandingRings(S, x, y, R, alpha, (a) => rgb(P.paper, a), 2, 3, arc, 2.5);
      },
      ledge(g) {
        ledgePath(ctx, g, H);
        ctx.fillStyle = rgb(P.sand);
        ctx.fill();
        outline(2.5);
        ctx.stroke();
        for (const rk of ROCKS) {
          rockPath(ctx, rk, g);
          ctx.fillStyle = rgb(mix(P.sand, P.paper, 0.3 + rnd(rk.s) * 0.4));
          ctx.fill();
          outline(2);
          ctx.stroke();
        }
      },
      nozzle(x, y) {
        flatCircle(x, y, 5.5, S.lit ? P.accent : P.navy, 2);
      },
      arc(x0, y0, cx, cy, x1, y1, i) {
        arcPath(ctx, x0, y0, cx, cy, x1, y1);
        outline(9 + 3 * S.sp);
        ctx.stroke();
        ctx.lineWidth = 5 + 3 * S.sp;
        ctx.strokeStyle = rgb(P.paper);
        ctx.stroke();
        arcPulses(S, x0, y0, cx, cy, x1, y1, i, rgb(S.lit ? P.accent : P.navy), 2.2 + S.sp);
      },
      shelf(y) {
        ctx.fillStyle = rgb(P.paper, 0.22);
        ctx.fillRect(0, y, W, H - y);
        outline(2.5);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      },
      head(x, y) {
        flatCircle(x, y, 4, S.lit ? S.lc : P.navy, 1.5);
      },
      dome(x, y, R) {
        // A stack of flat semicircles, like a fountain on a poster.
        for (let k = 3; k >= 1; k--) {
          const r = (R * 1.1 * k) / 3;
          ctx.beginPath();
          ctx.arc(x, y, r, Math.PI, 0);
          ctx.closePath();
          ctx.fillStyle = rgb(k % 2 ? P.paper : S.lit ? P.accent : P.water, 0.95);
          ctx.fill();
          outline(2);
          ctx.stroke();
        }
      },
    };
  },
  finish(S) {
    // Paper grain over everything.
    const { ctx, W, H } = S;
    ctx.save();
    ctx.globalAlpha = S.dark ? 0.1 : 0.16;
    ctx.fillStyle = S.paperGrain();
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  },
};

/* ----- caustic, as a painter (the overview needs the engine) --------------- */

const caustic = {
  water(S) {
    const { ctx, W, H, kind } = S;
    const buf = S.caustic(S, kind !== "spa");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(buf, 0, 0, W, H);
    if (S.lit && kind !== "spa") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const f of S.fx ?? fixtures(kind, W, H, S.sp)) {
        const px = f.x * W;
        const py = f.y * H;
        const g = ctx.createRadialGradient(px, py, 0, px, py, Math.max(W, H) * (kind === "pool" ? 0.55 : 0.35));
        g.addColorStop(0, rgb(S.lc, 0.4 * S.strength));
        g.addColorStop(0.4, rgb(S.lc, 0.14 * S.strength));
        g.addColorStop(1, rgb(S.lc, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }
  },
  theme: (S) => depth.theme(S),
};

/* ----- overview: the whole pool from above --------------------------------- */

/** Deck padding around the water, in pixels. */
export function overviewPad(W, H) {
  return Math.round(Math.min(W, H) * 0.17) + 4;
}

/** The overview's geometry: the laid-out shape and every part's position. */
export function overviewGeo(W, H, model) {
  const L = layoutShape(model.shape, W, H, overviewPad(W, H));
  const d = L.def;
  const m = Math.min(L.box.w, L.box.h);
  const spaEdge = L.at(d.spa.t);
  const spaR = d.spa.r * m * 0.78;
  const spaWall = Math.max(8, spaR * 0.2);
  // Outside the outline, but never off the picture: slide it inward if needed.
  const keep = spaR + spaWall + 3;
  const spa = {
    x: Math.min(W - keep, Math.max(keep, spaEdge.x - spaEdge.nx * spaR * 0.56)),
    y: Math.min(H - keep, Math.max(keep, spaEdge.y - spaEdge.ny * spaR * 0.56)),
    r: spaR,
    wall: spaWall,
    edge: spaEdge,
    land: [spaEdge.x + spaEdge.nx * spaR * 0.9, spaEdge.y + spaEdge.ny * spaR * 0.9],
  };
  const stepsEdge = L.at(d.steps.t);
  const steps = { x: stepsEdge.x, y: stepsEdge.y, r: d.steps.r * m, ang: Math.atan2(stepsEdge.ny, stepsEdge.nx) };
  const ledgeEdge = L.at(d.ledge.t);
  const ledge = { x: ledgeEdge.x, y: ledgeEdge.y, r: d.ledge.r * m, ang: Math.atan2(ledgeEdge.ny, ledgeEdge.nx) };
  const heads = [-0.5, 0, 0.5].map((k) => {
    const a = ledge.ang + k * 0.9;
    return [ledge.x + Math.cos(a) * ledge.r * 0.55, ledge.y + Math.sin(a) * ledge.r * 0.55];
  });
  const fallsMid = L.at((d.falls.t0 + d.falls.t1) / 2);
  const rocks = [];
  for (let i = 0; i < 7; i++) {
    const t = d.falls.t0 + ((d.falls.t1 - d.falls.t0) * (i + 0.5)) / 7;
    const e = L.at(t);
    const r = m * (0.055 + rnd(i + 11) * 0.03);
    const out = r * (0.5 + (i % 2) * 0.5);
    rocks.push({ cx: e.x - e.nx * out, cy: e.y - e.ny * out, r, s: i + 1 });
  }
  const falls = { edge: fallsMid, half: m * 0.06, rocks };
  const jets = [0, 1, 2].map((i) => {
    const e = L.at(d.deck.t0 + ((d.deck.t1 - d.deck.t0) * (i + 0.5)) / 3);
    return { edge: e, i };
  });
  const lights = d.lights.map((t) => L.at(t));
  return { L, m, spa, steps, ledge, heads, falls, jets, lights };
}

/** Ripple sources for the overview: wherever water falls into the pool. */
export function overviewLandings(W, H, model) {
  const g = overviewGeo(W, H, model);
  const f = model.parts;
  const out = [];
  if (f.falls?.on) out.push([g.falls.edge.x + g.falls.edge.nx * (g.m * 0.16 + f.falls.speed * g.m * 0.1), g.falls.edge.y + g.falls.edge.ny * (g.m * 0.16 + f.falls.speed * g.m * 0.1)]);
  if (f.spa && model.spilling) out.push(g.spa.land);
  if (f.deck?.on) for (const j of g.jets) out.push([j.edge.x + j.edge.nx * g.m * (0.2 + 0.25 * f.deck.speed), j.edge.y + j.edge.ny * g.m * (0.2 + 0.25 * f.deck.speed)]);
  if (f.bub?.on) out.push(...g.heads);
  return out;
}

/** A sub-state for one part: its own pump speed and light. */
function partState(S, part) {
  const p = S.model.parts[part] ?? { on: false, speed: 0, lightOn: false, hex: null };
  const lc = p.lightOn && p.rgb ? p.rgb : S.lc;
  const lit = p.lightOn ? true : S.lit;
  const strength = p.lightOn ? (S.dark ? 1 : 0.7) : S.strength;
  return { ...S, on: p.on, sp: p.on ? p.speed : 0, lc, lit, strength, spilling: S.spilling, ownLight: Boolean(p.lightOn) };
}

function overview(S, painter) {
  const { ctx, W, H } = S;
  const g = overviewGeo(W, H, S.model);
  const show = S.model.show;
  const trace = (c) => {
    c.beginPath();
    g.L.points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
  };
  const T = painter.theme(S);
  // Deck everywhere, then the water inside the outline.
  T.deck(0, 0, W, H);
  const fx = g.lights.map((l) => ({ x: (l.x + l.nx * g.m * 0.12) / W, y: (l.y + l.ny * g.m * 0.12) / H }));
  const centres = fx.map((f) => [f.x, f.y]);
  const SW = { ...S, kind: "pool", fx, centres };
  ctx.save();
  trace(ctx);
  ctx.clip();
  painter.water(SW);
  // Shallow end at the steps, deep end opposite.
  const sh = ctx.createRadialGradient(g.steps.x, g.steps.y, 0, g.steps.x, g.steps.y, Math.max(W, H));
  sh.addColorStop(0, S.dark ? "rgba(120,200,220,0.14)" : "rgba(255,255,255,0.22)");
  sh.addColorStop(0.35, "rgba(0,0,0,0)");
  sh.addColorStop(1, S.dark ? "rgba(0,0,0,0.35)" : "rgba(8,40,60,0.2)");
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, W, H);
  if (show.ledge) T.shelfDisc(g.ledge.x, g.ledge.y, g.ledge.r, g.ledge.ang);
  if (show.steps) T.steps(g.steps.x, g.steps.y, g.steps.r, g.steps.ang);
  if (show.bub) {
    const B = partState(S, "bub");
    const TB = painter.theme(B);
    g.heads.forEach(([x, y], i) => {
      TB.head(x, y);
      if (!B.on) return;
      const pulse = 0.88 + 0.12 * Math.sin(S.wt * (6 + B.sp * 6) + i * 1.7);
      TB.dome(x, y, (g.m * 0.04 + g.m * 0.07 * B.sp) * pulse, i);
    });
  }
  for (const l of g.lights) T.fixture(l.x + l.nx * 3, l.y + l.ny * 3);
  ctx.restore();
  T.copingPath(trace, Math.max(6, g.m * 0.05));

  // Waterfall: rocks on the deck, a sheet into the pool.
  if (show.falls) {
    const F = partState(S, "falls");
    const TF = painter.theme(F);
    for (const r of g.falls.rocks) TF.rock(r.cx, r.cy, r.r, r.s);
    // The waterfall's own light: a fixture under the lip, shining up the sheet.
    if (F.ownLight) {
      const e = g.falls.edge;
      TF.fixture(e.x + e.nx * 7, e.y + e.ny * 7);
    }
    if (F.on) {
      const e = g.falls.edge;
      const run = g.m * (0.14 + 0.1 * F.sp);
      const half = g.falls.half * (0.7 + 0.6 * F.sp);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(Math.atan2(e.ny, e.nx));
      TF.lip(-3, -half * 1.3, -3, half * 1.3);
      TF.sheet([0, -half], [run, -half * 1.1], [run, half * 1.1], [0, half], { len: run, dir: 1, lines: 8, speed: 0.45 + F.sp * 0.9 });
      TF.foam(run + 3, 0, half * 0.9, half * 1.4);
      TF.rings(run + 4, 0, half * 2.6, 0.5, true);
      ctx.restore();
    }
  }
  // Attached spa on the deck, spilling over its lip into the pool.
  if (show.spa) {
    const P = partState(S, "spa");
    const TP = painter.theme(P);
    const sg = { x: g.spa.x, y: g.spa.y, r: g.spa.r, wall: g.spa.wall };
    TP.spaWall(sg);
    ctx.save();
    ctx.beginPath();
    ctx.arc(sg.x, sg.y, sg.r, 0, TAU);
    ctx.clip();
    TP.waterDisc(sg);
    if (P.on) TP.froth(sg);
    ctx.restore();
    TP.spaRim(sg);
    const e = g.spa.edge;
    const half = sg.r * 0.3;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.atan2(e.ny, e.nx));
    TP.lip(sg.r * 0.26, -half, sg.r * 0.26, half);
    if (S.spilling) {
      const run = sg.r * 0.9;
      TP.sheet([sg.r * 0.26, -half], [run, -half * 1.15], [run, half * 1.15], [sg.r * 0.26, half], { len: run - sg.r * 0.26, dir: 1, lines: 6, speed: 0.9 });
      TP.foam(run + 2, 0, half * 0.9, half * 1.5);
      TP.rings(run + 3, 0, half * 2.4, 0.5, true);
    }
    ctx.restore();
  }
  // Deck jets: nozzles in the coping, arcs into the pool.
  if (show.deck) {
    const D = partState(S, "deck");
    const TD = painter.theme(D);
    for (const j of g.jets) {
      const e = j.edge;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(Math.atan2(e.ny, e.nx));
      TD.nozzle(-g.m * 0.03, 0);
      if (D.on) {
        const reach = g.m * (0.2 + 0.25 * D.sp);
        const drift = (j.i - 1) * g.m * 0.08;
        const cx = reach * 0.5;
        const cy = drift * 0.5 - reach * 0.35;
        TD.arc(-g.m * 0.03, 0, cx, cy, reach, drift, j.i);
        TD.foam(reach, drift, 5 + 4 * D.sp, 4 + 3 * D.sp);
      }
      ctx.restore();
    }
  }
}

export const PAINTERS = { caustic, blueprint, depth, neon, poster };

/* ----- Entry point --------------------------------------------------------- */

/**
 * A scene renderer for `style`. `caustic` is the original renderer; the rest
 * share the engine above. Throws on an unknown style, like an unknown scene.
 */
export function makeStyledScene(cv, kind, style = DEFAULT_STYLE, getModel, getColors, rng = Math.random) {
  if (!STYLES.includes(style)) {
    throw new Error(`controlfreak-picture: set "style" to one of ${STYLES.join(", ")}`);
  }
  if (style === "caustic" && kind !== "overview") return makeScene(cv, kind, getModel, getColors, rng);
  return makeEngine(cv, kind, PAINTERS[style], getModel, getColors, rng);
}
