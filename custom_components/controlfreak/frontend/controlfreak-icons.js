/**
 * Control Freak icon set: `cf:<name>` icons for the pool equipment.
 *
 * Home Assistant resolves an icon prefix through `window.customIcons[prefix]
 * .getIcon(name)`, which returns `{ path, viewBox }` for `ha-svg-icon`. The
 * glyphs here are built from a few filled primitives (discs, rings, rounded
 * boxes and thick "bands" along sampled curves) so every icon is one solid
 * path the tile card fills with its state colour, like a Material icon.
 *
 * They are drawn edge to edge in the 24-unit box (Material glyphs keep a
 * two-unit margin), so they read about a fifth larger in the same 36 px
 * tile disc, which is as large as the tile card lets an icon be.
 *
 * Served by the integration and loaded on every page (see __init__.py); the
 * entities use the names below as their icons. `ICON_NAMES` and `iconPath`
 * are exported for the tests, which check every name the integration emits.
 */

const VIEW_BOX = "1.5 1.5 21 21";
const TAU = Math.PI * 2;
const f = (n) => (Math.round(n * 100) / 100).toString();

/* ----- primitives -------------------------------------------------------- */

/** A closed polygon, oriented clockwise (screen axes) unless it is a hole. */
function poly(points, hole = false) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  // nonzero fill: every solid shape winds the same way, holes the other way.
  const pts = (area < 0) !== hole ? points : [...points].reverse();
  return `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}Z`;
}

function circlePoints(cx, cy, r, n = 28) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([cx + Math.cos((i / n) * TAU) * r, cy + Math.sin((i / n) * TAU) * r]);
  return pts;
}

const disc = (cx, cy, r) => poly(circlePoints(cx, cy, r));
const ring = (cx, cy, r, w) => disc(cx, cy, r) + poly(circlePoints(cx, cy, r - w), true);

function box(x, y, w, h, r = 0) {
  if (!r) return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return poly(pts);
}

/** A thick stroke along a polyline, round caps, as one filled polygon. */
function band(points, width) {
  const hw = width / 2;
  const n = points.length;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = points[i];
    const [ax, ay] = points[Math.max(0, i - 1)];
    const [bx, by] = points[Math.min(n - 1, i + 1)];
    let dx = bx - ax;
    let dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    left.push([px - dy * hw, py + dx * hw]);
    right.push([px + dy * hw, py - dx * hw]);
  }
  const cap = (p, q, side) => {
    // a half circle from q around p, on the far side
    const a0 = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const pts = [];
    for (let i = 1; i < 8; i++) {
      const a = a0 + side * (i / 8) * Math.PI;
      pts.push([p[0] + Math.cos(a) * hw, p[1] + Math.sin(a) * hw]);
    }
    return pts;
  };
  const endCap = cap(points[n - 1], left[n - 1], -1);
  const startCap = cap(points[0], right[0], -1);
  return poly([...left, ...endCap, ...right.reverse(), ...startCap]);
}

const line = (x1, y1, x2, y2, w) => band([[x1, y1], [x2, y2]], w);

/** Points along a cubic Bézier. */
function bezier(p0, p1, p2, p3, n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return pts;
}

/** Points along an arc of a circle. */
function arc(cx, cy, r, a0, a1, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** A horizontal wave from x0 to x1 at y: `periods` crests of height `amp`. */
function wave(x0, x1, y, amp, periods, width, phase = 0) {
  const pts = [];
  const n = Math.max(12, Math.round(periods * 10));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x0 + (x1 - x0) * t, y + Math.sin(t * periods * TAU + phase) * amp]);
  }
  return band(pts, width);
}

/** A vertical wave (falling water) from y0 to y1 at x. */
function fall(x, y0, y1, amp, periods, width, phase = 0) {
  const pts = [];
  const n = Math.max(12, Math.round(periods * 10));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x + Math.sin(t * periods * TAU + phase) * amp, y0 + (y1 - y0) * t]);
  }
  return band(pts, width);
}

/** A teardrop, point up, filled; `k` sets how round the belly is. */
function drop(cx, cy, w, h, hole = false) {
  const top = [cx, cy - h / 2];
  const bottom = cy + h / 2 - w / 2;
  const right = bezier(top, [cx + w * 0.05, cy - h * 0.1], [cx + w / 2, cy + h * 0.05], [cx + w / 2, bottom], 10);
  const belly = arc(cx, bottom, w / 2, 0, Math.PI, 16);
  const left = bezier([cx - w / 2, bottom], [cx - w / 2, cy + h * 0.05], [cx - w * 0.05, cy - h * 0.1], top, 10);
  return poly([...right, ...belly, ...left], hole);
}

function triangle(ax, ay, bx, by, cx, cy) {
  return poly([[ax, ay], [bx, by], [cx, cy]]);
}

/* ----- the icons --------------------------------------------------------- */

const ICONS = {
  // A pump: round housing, three impeller blades, outlet up, feet.
  pump() {
    const blades = [0, 1, 2]
      .map((i) => {
        const a = (i / 3) * TAU - Math.PI / 2;
        const pts = arc(12.5, 13, 0.1, a, a, 1).concat(
          bezier([12.5, 13], [12.5 + Math.cos(a) * 2, 13 + Math.sin(a) * 2],
            [12.5 + Math.cos(a + 0.9) * 3.6, 13 + Math.sin(a + 0.9) * 3.6],
            [12.5 + Math.cos(a + 1.3) * 4.2, 13 + Math.sin(a + 1.3) * 4.2], 8)
        );
        return band(pts, 1.7);
      })
      .join("");
    return ring(12.5, 13, 7.3, 2.1) + blades + disc(12.5, 13, 1.5) +
      box(14.6, 3.2, 7.6, 4.2, 1.6) + box(14.6, 5.4, 3.6, 4.4) +
      box(4.2, 19.4, 5, 2.4, 1) + box(15.8, 19.4, 5, 2.4, 1);
  },
  // Spa jets: a tub with three columns of rising steam.
  "spa-jets"() {
    const tub = poly([[2.6, 12.4], [21.4, 12.4], [20.4, 18.6], [19, 20.2], [5, 20.2], [3.6, 18.6]]) +
      box(1.8, 11.2, 20.4, 2.4, 1.2) + box(6, 20, 2.4, 2, 0.6) + box(15.6, 20, 2.4, 2, 0.6);
    const steam = [6.6, 12, 17.4].map((x, i) => fall(x, 3.2, 9.6, 1.2, 0.9, 1.9, i * 1.2)).join("");
    return tub + steam;
  },
  // A waterfall: the ledge, three sheets falling, the splash below.
  waterfall() {
    return box(2, 2.4, 20, 3.6, 1.4) +
      [6.2, 12, 17.8].map((x, i) => fall(x, 6.4, 17.4, 0.9, 1.1, 2.2, i * 0.8)).join("") +
      wave(2.2, 21.8, 20.2, 1, 2, 2.2) + disc(4, 16.6, 1.1) + disc(20, 16.2, 1.1);
  },
  // Deck jets: one jet arcing from its nozzle on the deck into the water.
  "deck-jets"() {
    const jet = band(bezier([4.6, 14.6], [4.2, 2.4], [16.8, 1.6], [18.6, 14.2], 18), 2.3);
    return jet + box(2.4, 13.6, 4.8, 3.2, 1) + box(2, 16.2, 5.6, 2.2, 1) +
      wave(9.6, 20.8, 19.6, 1, 1.3, 2.3) + disc(16.2, 15.4, 1.1) + disc(20.6, 14.6, 1.1) + disc(18.8, 17.6, 0.9);
  },
  // A bubbler: bubbles rising out of a swell of water.
  bubbler() {
    return wave(3.2, 20.8, 19.6, 1.2, 1.5, 2.6) + ring(12, 6.2, 3.8, 1.9) + ring(6.4, 12.6, 2.6, 1.6) +
      ring(17.2, 12.2, 2.9, 1.7) + disc(12, 14.8, 1.6);
  },
  // A pool cleaner: a round puck on its hose.
  cleaner() {
    const hose = band(bezier([17.6, 14.2], [23, 12], [22.6, 4.4], [16.4, 4.2], 16), 2);
    return hose + poly([...arc(12, 15.4, 8.2, Math.PI, TAU, 18), [20.2, 17.4], [3.8, 17.4]]) +
      box(2.6, 17, 18.8, 2.6, 1.3) + box(6, 19.8, 3.2, 2.2, 0.8) + box(14.8, 19.8, 3.2, 2.2, 0.8) +
      ring(12, 11.4, 2.6, 1.4);
  },
  // Solar: a sun over the water.
  solar() {
    const rays = [0, 1, 2, 3, 4, 5, 6, 7]
      .map((i) => {
        const a = (i / 8) * TAU;
        return line(12 + Math.cos(a) * 6.2, 10.4 + Math.sin(a) * 6.2, 12 + Math.cos(a) * 8.4, 10.4 + Math.sin(a) * 8.4, 2);
      })
      .join("");
    return disc(12, 10.4, 4.2) + rays + wave(3.2, 20.8, 20, 1, 2, 2.3);
  },
  // An underwater flood light: a lens throwing light down into the water.
  "pool-light"() {
    return ring(12, 7, 4.4, 1.9) + disc(12, 7, 1.7) +
      line(9.6, 10.8, 5.2, 17.4, 2.1) + line(12, 11.6, 12, 17.6, 2.1) + line(14.4, 10.8, 18.8, 17.4, 2.1) +
      wave(2.2, 21.8, 20.4, 0.9, 2, 2.2);
  },
  // The spa's light: the lens inside a ring of water.
  "spa-light"() {
    const rays = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * TAU + Math.PI / 6;
      return line(12 + Math.cos(a) * 7.6, 12 + Math.sin(a) * 7.6, 12 + Math.cos(a) * 9.8, 12 + Math.sin(a) * 9.8, 2.1);
    }).join("");
    return ring(12, 12, 6.2, 2) + disc(12, 12, 2.6) + rays;
  },
  // An outdoor lamp on its post.
  "outdoor-lamp"() {
    return poly([[8.2, 4.6], [15.8, 4.6], [18.6, 11.4], [5.4, 11.4]]) + box(10.4, 2, 3.2, 3, 1) +
      box(4.4, 10.6, 15.2, 2.4, 1.2) + box(10.9, 13, 2.2, 7) + box(6.4, 19.6, 11.2, 2.4, 1.2) +
      line(4.6, 8, 2.4, 6.6, 1.6) + line(19.4, 8, 21.6, 6.6, 1.6) + line(4.2, 4.2, 2.6, 2.8, 1.5) + line(19.8, 4.2, 21.4, 2.8, 1.5);
  },
  // A heater: a flame with its hot core.
  heater() {
    return drop(12, 12.6, 15.4, 19.6) + drop(12.4, 15.6, 6.2, 8.6, true);
  },
  // A heat pump: a boxed fan.
  "heat-pump"() {
    const blades = [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * TAU;
      return band(bezier([12, 12], [12 + Math.cos(a) * 2.4, 12 + Math.sin(a) * 2.4],
        [12 + Math.cos(a + 0.7) * 4.6, 12 + Math.sin(a + 0.7) * 4.6],
        [12 + Math.cos(a + 1.1) * 5.4, 12 + Math.sin(a + 1.1) * 5.4], 8), 1.9);
    }).join("");
    return box(2, 2, 20, 20, 3) + poly(circlePoints(12, 12, 7.6), true) + blades + disc(12, 12, 1.6);
  },
  // A chiller: a bold snowflake.
  chiller() {
    const arms = [0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let d = line(12 - dx * 9.6, 12 - dy * 9.6, 12 + dx * 9.6, 12 + dy * 9.6, 2.2);
      for (const s of [-1, 1]) {
        const tx = 12 + dx * 6.2 * s;
        const ty = 12 + dy * 6.2 * s;
        const b = a + s * 2.3;
        const c = a - s * 2.3;
        d += line(tx, ty, tx + Math.cos(b) * 3.2, ty + Math.sin(b) * 3.2, 1.9);
        d += line(tx, ty, tx + Math.cos(c) * 3.2, ty + Math.sin(c) * 3.2, 1.9);
      }
      return d;
    }).join("");
    return arms + disc(12, 12, 2.2);
  },
  // A valve: the pipe, the bow-tie body, the handle.
  valve() {
    return box(2, 13.2, 20, 4.4, 2.2) + triangle(5.2, 9.4, 12, 15.4, 5.2, 21.4) + triangle(18.8, 9.4, 12, 15.4, 18.8, 21.4) +
      box(10.8, 5.2, 2.4, 9) + box(6.2, 2.4, 11.6, 3.2, 1.6);
  },
  // Water temperature: a thermometer standing in the water.
  "thermometer-water"() {
    return ring(10, 15.6, 4.6, 2) + disc(10, 15.6, 2.2) + box(8.2, 2.4, 3.6, 10.4, 1.8) + box(9.2, 7, 1.6, 7.4) +
      wave(15.2, 21.6, 10.4, 0.9, 1.2, 2) + wave(15.2, 21.6, 15.4, 0.9, 1.2, 2) + wave(15.2, 21.6, 20.2, 0.9, 1.2, 2);
  },
  // Air temperature: a thermometer in the sun.
  "thermometer-air"() {
    const rays = [0, 1, 2, 3, 4].map((i) => {
      const a = -Math.PI * 0.95 + (i / 4) * Math.PI * 0.9;
      return line(16.2 + Math.cos(a) * 3.8, 8.2 + Math.sin(a) * 3.8, 16.2 + Math.cos(a) * 5.4, 8.2 + Math.sin(a) * 5.4, 1.6);
    }).join("");
    return ring(8.6, 17, 4.4, 1.9) + disc(8.6, 17, 2.1) + box(6.9, 2.4, 3.4, 11.4, 1.7) + box(7.9, 7, 1.4, 7.6) +
      disc(16.2, 8.2, 2.5) + rays;
  },
  // Flow: three waves, strong.
  flow() {
    return wave(3.2, 20.8, 6, 1.5, 1.5, 2.6) + wave(3.2, 20.8, 12, 1.5, 1.5, 2.6, 0.9) + wave(3.2, 20.8, 18, 1.5, 1.5, 2.6, 1.8);
  },
  // The controller: a panel with its indicator and antenna.
  controller() {
    return box(3, 6.4, 18, 15.4, 2.4) + poly([[5.4, 8.8], [18.6, 8.8], [18.6, 14.6], [5.4, 14.6]], true) +
      disc(7.6, 18, 1.3) + disc(12, 18, 1.3) + disc(16.4, 18, 1.3) + box(10.9, 2, 2.2, 5) + disc(12, 2.8, 1.5) +
      box(6.6, 10.2, 6.6, 2.2, 0.6);
  },
  // Freeze protection: a snowflake inside a shield.
  freeze() {
    const shield = poly([...bezier([12, 2.2], [17, 3.6], [20.4, 4.2], [20.6, 5.4], 6), ...bezier([20.6, 5.4], [20.8, 15.4], [16, 19.6], [12, 21.8], 10),
      ...bezier([12, 21.8], [8, 19.6], [3.2, 15.4], [3.4, 5.4], 10), ...bezier([3.4, 5.4], [3.6, 4.2], [7, 3.6], [12, 2.2], 6)]);
    const flake = [0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI + Math.PI / 2;
      return line(12 - Math.cos(a) * 5, 11.6 - Math.sin(a) * 5, 12 + Math.cos(a) * 5, 11.6 + Math.sin(a) * 5, 1.9);
    }).join("");
    return shield + poly(circlePoints(12, 11.6, 6.6), true) + flake;
  },
  // Firmware: a chip with legs.
  firmware() {
    let legs = "";
    for (const t of [7.2, 12, 16.8]) {
      legs += box(t - 1, 2, 2, 3.6, 0.6) + box(t - 1, 18.4, 2, 3.6, 0.6) + box(2, t - 1, 3.6, 2, 0.6) + box(18.4, t - 1, 3.6, 2, 0.6);
    }
    return legs + box(5.2, 5.2, 13.6, 13.6, 2) + poly([[8.6, 8.6], [15.4, 8.6], [15.4, 15.4], [8.6, 15.4]], true) + disc(12, 12, 1.6);
  },
  // The processor's temperature: a chip with a thermometer on it.
  cpu() {
    let legs = "";
    for (const t of [7, 12, 17]) legs += box(t - 1, 2, 2, 3, 0.6) + box(t - 1, 19, 2, 3, 0.6) + box(2, t - 1, 3, 2, 0.6) + box(19, t - 1, 3, 2, 0.6);
    return legs + box(4.6, 4.6, 14.8, 14.8, 2.2) + poly([[7.4, 7.4], [16.6, 7.4], [16.6, 16.6], [7.4, 16.6]], true) +
      box(10.9, 8.2, 2.2, 5.2, 1.1) + disc(12, 14.2, 2.1);
  },
  // Pump mode: two arrows chasing each other.
  mode() {
    const a1 = band(arc(12, 12, 7.4, Math.PI * 1.05, Math.PI * 1.9, 14), 2.3);
    const a2 = band(arc(12, 12, 7.4, Math.PI * 0.05, Math.PI * 0.9, 14), 2.3);
    return a1 + a2 + triangle(21.8, 7.4, 16.2, 6.2, 19.4, 11.8) + triangle(2.2, 16.6, 7.8, 17.8, 4.6, 12.2);
  },
  // Pump speed: a gauge.
  speed() {
    return band(arc(12, 14, 8.6, Math.PI * 1.02, Math.PI * 1.98, 18), 2.6) + box(2.2, 16.4, 19.6, 2.6, 1.3) +
      band([[12, 14], [16.6, 7.6]], 2.2) + disc(12, 14, 2.3);
  },
  // A plain relay: a toggle.
  switch() {
    return box(2, 7, 20, 10, 5) + poly(circlePoints(16.8, 12, 3.4), true) + disc(16.8, 12, 1.5);
  },
};

export const ICON_NAMES = Object.keys(ICONS);
const cache = new Map();

/** The path data for `name`, or null for an unknown icon. */
export function iconPath(name) {
  if (!ICONS[name]) return null;
  if (!cache.has(name)) cache.set(name, ICONS[name]());
  return cache.get(name);
}

export function getIcon(name) {
  const path = iconPath(name);
  return Promise.resolve(path ? { path, viewBox: VIEW_BOX } : undefined);
}

export const ICON_VIEW_BOX = VIEW_BOX;

if (typeof window !== "undefined") {
  window.customIcons = window.customIcons || {};
  window.customIcons.cf = { getIcon };
  window.customIconsets = window.customIconsets || {};
  window.customIconsets.cf = getIcon;
}
