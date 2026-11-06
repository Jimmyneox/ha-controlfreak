/**
 * Pool shapes for the overview picture (custom:controlfreak-picture, scene "overview").
 *
 * Each shape is a closed outline drawn from a few control points, smoothed
 * into a spline, plus anchors along it (as fractions 0..1 of the outline)
 * for the parts a pool has: an attached spa, the steps, a tanning ledge with
 * bubblers, the waterfall rocks, the deck jets and the lights. Everything is
 * pure: points in, points out. The painting lives in controlfreak-picture-styles.js.
 */

export const SHAPES = [
  "rectangle",
  "roman",
  "grecian",
  "oval",
  "round",
  "kidney",
  "figure8",
  "lazy-l",
  "true-l",
  "mountain-lake",
  "freeform",
  "lagoon",
];
export const DEFAULT_SHAPE = "rectangle";
export const SHAPE_LABELS = {
  rectangle: "Rectangle",
  roman: "Roman",
  grecian: "Grecian",
  oval: "Oval",
  round: "Round",
  kidney: "Kidney",
  figure8: "Figure 8",
  "lazy-l": "Lazy L",
  "true-l": "True L",
  "mountain-lake": "Mountain lake",
  freeform: "Freeform",
  lagoon: "Lagoon",
};

/** The parts an overview can show, besides the water. */
export const PARTS = ["spa", "falls", "deck", "bub", "steps", "ledge"];

/**
 * Control points (x, y in 0..1 of the water's bounding box, y down) and
 * anchors. `t` runs clockwise from the first point. `tension` 0 keeps the
 * outline straight between points (rectangle); 1 is a full spline.
 */
export const SHAPE_DEFS = {
  rectangle: {
    tension: 0,
    points: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    spa: { t: 0.72, r: 0.2 },
    steps: { t: 0.14, r: 0.26 },
    ledge: { t: 0.44, r: 0.3 },
    falls: { t0: 0.1, t1: 0.22 },
    deck: { t0: 0.56, t1: 0.7 },
    lights: [0.04, 0.3],
  },
  roman: {
    // Straight long sides (a point mid-edge keeps the spline flat) and
    // semicircular ends.
    tension: 1,
    points: [
      [0.12, 0],
      [0.5, 0],
      [0.88, 0],
      [0.97, 0.15],
      [1, 0.5],
      [0.97, 0.85],
      [0.88, 1],
      [0.5, 1],
      [0.12, 1],
      [0.03, 0.85],
      [0, 0.5],
      [0.03, 0.15],
    ],
    spa: { t: 0.84, r: 0.2 },
    steps: { t: 0.33, r: 0.22 },
    ledge: { t: 0.67, r: 0.26 },
    falls: { t0: 0.09, t1: 0.2 },
    deck: { t0: 0.54, t1: 0.66 },
    lights: [0.02, 0.29],
  },
  grecian: {
    // A rectangle with the corners cut at 45 degrees.
    tension: 0,
    points: [
      [0.1, 0],
      [0.9, 0],
      [1, 0.18],
      [1, 0.82],
      [0.9, 1],
      [0.1, 1],
      [0, 0.82],
      [0, 0.18],
    ],
    spa: { t: 0.62, r: 0.2 },
    steps: { t: 0.09, r: 0.24 },
    ledge: { t: 0.33, r: 0.28 },
    falls: { t0: 0.01, t1: 0.06 },
    deck: { t0: 0.52, t1: 0.6 },
    lights: [0.95, 0.2],
  },
  oval: {
    tension: 1,
    points: [
      [0.0, 0.5],
      [0.067, 0.25],
      [0.25, 0.067],
      [0.5, 0.0],
      [0.75, 0.067],
      [0.933, 0.25],
      [1.0, 0.5],
      [0.933, 0.75],
      [0.75, 0.933],
      [0.5, 1.0],
      [0.25, 0.933],
      [0.067, 0.75],
    ],
    spa: { t: 0.85, r: 0.19 },
    steps: { t: 0.2, r: 0.24 },
    ledge: { t: 0.55, r: 0.26 },
    falls: { t0: 0.3, t1: 0.4 },
    deck: { t0: 0.65, t1: 0.75 },
    lights: [0.05, 0.45],
  },
  round: {
    // The same points on a square box: layoutShape keeps the aspect 1:1.
    uniform: true,
    tension: 1,
    points: [
      [0.0, 0.5],
      [0.067, 0.25],
      [0.25, 0.067],
      [0.5, 0.0],
      [0.75, 0.067],
      [0.933, 0.25],
      [1.0, 0.5],
      [0.933, 0.75],
      [0.75, 0.933],
      [0.5, 1.0],
      [0.25, 0.933],
      [0.067, 0.75],
    ],
    spa: { t: 0.85, r: 0.19 },
    steps: { t: 0.2, r: 0.24 },
    ledge: { t: 0.55, r: 0.26 },
    falls: { t0: 0.3, t1: 0.4 },
    deck: { t0: 0.65, t1: 0.75 },
    lights: [0.05, 0.45],
  },
  kidney: {
    tension: 1,
    points: [
      [0.08, 0.3],
      [0.3, 0.06],
      [0.62, 0.1],
      [0.9, 0.3],
      [0.98, 0.62],
      [0.78, 0.94],
      [0.5, 0.78],
      [0.22, 0.96],
      [0.02, 0.7],
    ],
    spa: { t: 0.74, r: 0.19 },
    steps: { t: 0.09, r: 0.24 },
    ledge: { t: 0.45, r: 0.26 },
    falls: { t0: 0.18, t1: 0.3 },
    deck: { t0: 0.52, t1: 0.63 },
    lights: [0.01, 0.38],
  },
  freeform: {
    tension: 1,
    points: [
      [0.04, 0.42],
      [0.2, 0.12],
      [0.5, 0.04],
      [0.72, 0.16],
      [0.96, 0.3],
      [0.94, 0.66],
      [0.72, 0.9],
      [0.46, 0.96],
      [0.26, 0.82],
      [0.08, 0.86],
    ],
    spa: { t: 0.9, r: 0.19 },
    steps: { t: 0.12, r: 0.25 },
    ledge: { t: 0.42, r: 0.28 },
    falls: { t0: 0.2, t1: 0.33 },
    deck: { t0: 0.52, t1: 0.66 },
    lights: [0.03, 0.74],
  },
  lagoon: {
    tension: 1,
    points: [
      [0.1, 0.22],
      [0.34, 0.08],
      [0.46, 0.22],
      [0.66, 0.04],
      [0.9, 0.18],
      [0.98, 0.5],
      [0.84, 0.74],
      [0.92, 0.94],
      [0.6, 0.98],
      [0.42, 0.84],
      [0.18, 0.96],
      [0.02, 0.62],
    ],
    spa: { t: 0.48, r: 0.18 },
    steps: { t: 0.86, r: 0.24 },
    ledge: { t: 0.68, r: 0.24 },
    falls: { t0: 0.06, t1: 0.2 },
    deck: { t0: 0.3, t1: 0.42 },
    lights: [0.96, 0.58],
  },
  "lazy-l": {
    // A wide shallow end; the deep leg meets it at an angle.
    tension: 0,
    points: [
      [0, 0],
      [0.6, 0],
      [0.6, 0.3],
      [0.76, 0.5],
      [1, 0.5],
      [1, 1],
      [0, 1],
    ],
    spa: { t: 0.8, r: 0.18 },
    steps: { t: 0.07, r: 0.24 },
    ledge: { t: 0.2, r: 0.24 },
    falls: { t0: 0.88, t1: 0.97 },
    deck: { t0: 0.6, t1: 0.68 },
    lights: [0.95, 0.48],
  },
  "true-l": {
    // An L with a square inner corner.
    tension: 0,
    points: [
      [0, 0],
      [0.6, 0],
      [0.6, 0.54],
      [1, 0.54],
      [1, 1],
      [0, 1],
    ],
    spa: { t: 0.75, r: 0.18 },
    steps: { t: 0.08, r: 0.24 },
    ledge: { t: 0.25, r: 0.22 },
    falls: { t0: 0.86, t1: 0.95 },
    deck: { t0: 0.55, t1: 0.63 },
    lights: [0.97, 0.45],
  },
  "mountain-lake": {
    // An oblong with gently curved sides.
    tension: 1,
    points: [
      [0.08, 0.3],
      [0.3, 0.08],
      [0.56, 0.06],
      [0.82, 0.1],
      [0.98, 0.34],
      [0.94, 0.64],
      [0.78, 0.92],
      [0.5, 0.94],
      [0.26, 0.9],
      [0.06, 0.7],
    ],
    spa: { t: 0.84, r: 0.19 },
    steps: { t: 0.1, r: 0.24 },
    ledge: { t: 0.46, r: 0.26 },
    falls: { t0: 0.22, t1: 0.32 },
    deck: { t0: 0.58, t1: 0.68 },
    lights: [0.02, 0.4],
  },
  figure8: {
    tension: 1,
    points: [
      [0.14, 0.04],
      [0.36, 0.14],
      [0.5, 0.38],
      [0.66, 0.1],
      [0.92, 0.2],
      [0.98, 0.6],
      [0.8, 0.96],
      [0.58, 0.9],
      [0.5, 0.62],
      [0.36, 0.9],
      [0.1, 0.9],
      [0.02, 0.5],
    ],
    spa: { t: 0.86, r: 0.17 },
    steps: { t: 0.12, r: 0.22 },
    ledge: { t: 0.42, r: 0.24 },
    falls: { t0: 0.26, t1: 0.36 },
    deck: { t0: 0.6, t1: 0.72 },
    lights: [0.0, 0.5],
  },
};

/** Catmull-Rom through the closed control polygon, sampled into N points. */
export function outlinePoints(def, N = 180) {
  const P = def.points;
  const n = P.length;
  const out = [];
  const k = def.tension;
  for (let i = 0; i < N; i++) {
    const u = (i / N) * n;
    const seg = Math.floor(u);
    const t = u - seg;
    const p0 = P[(seg - 1 + n) % n];
    const p1 = P[seg % n];
    const p2 = P[(seg + 1) % n];
    const p3 = P[(seg + 2) % n];
    const pt = [0, 1].map((c) => {
      const lin = p1[c] + (p2[c] - p1[c]) * t;
      const spl =
        0.5 *
        (2 * p1[c] +
          (-p0[c] + p2[c]) * t +
          (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t * t +
          (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t * t * t);
      return lin + (spl - lin) * k;
    });
    out.push(pt);
  }
  return out;
}

/**
 * The shape laid into a W x H canvas with `pad` pixels of deck around it:
 * outline points in pixels, the water's bounding box, and a function giving
 * the point and inward normal at any fraction of the outline.
 */
export function layoutShape(name, W, H, pad) {
  const def = SHAPE_DEFS[name];
  if (!def) throw new Error(`controlfreak-picture: set "shape" to one of ${SHAPES.join(", ")}`);
  const pts = outlinePoints(def);
  const box = { x: pad, y: pad, w: Math.max(1, W - pad * 2), h: Math.max(1, H - pad * 2) };
  if (def.uniform) {
    // A round pool stays round: a square box centred in the picture.
    const side = Math.min(box.w, box.h);
    box.x += (box.w - side) / 2;
    box.y += (box.h - side) / 2;
    box.w = box.h = side;
  }
  const px = pts.map(([x, y]) => [box.x + x * box.w, box.y + y * box.h]);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const at = (t) => {
    const N = px.length;
    const f = ((t % 1) + 1) % 1;
    const i = Math.floor(f * N) % N;
    const p = px[i];
    const a = px[(i - 2 + N) % N];
    const b = px[(i + 2) % N];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    // Point the normal into the water (toward the centre of the box).
    if ((cx - p[0]) * nx + (cy - p[1]) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x: p[0], y: p[1], nx, ny };
  };
  return { name, def, points: px, box, at, centre: [cx, cy] };
}

/**
 * Which parts to draw. A part with a pump or a light bound is shown; `show`
 * adds parts without one (a spa with no jets, say). Steps are always shown
 * unless `show` is given and leaves them out; a ledge comes with bubblers.
 */
export function partsOf(config) {
  const show = Array.isArray(config.show) ? new Set(config.show) : null;
  const pumps = config.pumps ?? {};
  const lights = config.lights ?? {};
  const has = (k) => Boolean(show?.has(k)) || pumps[k] != null || lights[k] != null;
  return {
    spa: has("spa"),
    falls: has("falls"),
    deck: has("deck"),
    bub: has("bub"),
    steps: show ? show.has("steps") : true,
    ledge: has("bub") || Boolean(show?.has("ledge")),
  };
}
