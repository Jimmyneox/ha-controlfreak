// node --test tests/frontend/*.test.mjs
//
// The pure half of the picture card: the effect table, entity state -> scene
// model, the motion gate, the simulation step and the water buffer. The canvas
// half is exercised by the Playwright render check (harness.html?shape=pictures).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_ROWS,
  DEFAULT_SHAPE,
  EFFECT_COLORS,
  PALETTE,
  POOL_SHAPES,
  ROWS_MAX,
  ROWS_MIN,
  SCENES,
  SHAPE_LABELS,
  SHAPE_NAMES,
  SHOW,
  WHITE,
  addRipple,
  advance,
  createSim,
  deckGeo,
  editorSchema,
  effectHex,
  fallGeo,
  fixtures,
  flowOf,
  frameStyle,
  gridOptions,
  hexToRgb,
  isDarkMode,
  landings,
  lightOf,
  modelOf,
  poolOutline,
  renderWater,
  shouldAnimate,
  spillingOf,
  stepLights,
} from "../../custom_components/controlfreak/frontend/controlfreak-picture.js";

const PENTAIR = [
  "Blue",
  "Green",
  "Red",
  "White",
  "Magenta",
  "SAM Mode",
  "Party Mode",
  "Romance Mode",
  "Carribbean Mode",
  "American Mode",
  "California Sunset Mode",
  "Royal Mode",
];

test("effect table: the captured Pentair set, colours are hex, modes are shows", () => {
  assert.deepEqual(Object.keys(EFFECT_COLORS), PENTAIR);
  for (const [name, value] of Object.entries(EFFECT_COLORS)) {
    if (name.endsWith("Mode")) assert.equal(value, SHOW, name);
    else assert.match(value, /^#[0-9a-f]{6}$/, name);
  }
  assert.equal(effectHex("Blue"), "#2f7dff");
  assert.equal(effectHex("Party Mode"), SHOW);
});

test("effect names a panel lists itself fall back on their wording, else white", () => {
  assert.equal(effectHex("Deep Blue"), EFFECT_COLORS.Blue);
  assert.equal(effectHex("Twilight Show"), SHOW);
  assert.equal(effectHex("Sunset Mode"), SHOW);
  assert.equal(effectHex("Vivid Teal"), "#22d3e6");
  assert.equal(effectHex("Setting 7"), WHITE);
  assert.equal(effectHex(null), WHITE);
  assert.equal(effectHex(""), WHITE);
});

test("hex parsing: six and three digits", () => {
  assert.deepEqual(hexToRgb("#2f7dff"), [47, 125, 255]);
  assert.deepEqual(hexToRgb(" #fff "), [255, 255, 255]);
  assert.deepEqual(hexToRgb("#000"), [0, 0, 0]);
});

test("water speed follows the fan percentage, 0 when off", () => {
  assert.deepEqual(flowOf({ state: "off", attributes: { percentage: 80 } }), { on: false, speed: 0 });
  assert.deepEqual(flowOf({ state: "on", attributes: { percentage: 50 } }), { on: true, speed: 0.5 });
  assert.deepEqual(flowOf({ state: "on", attributes: { percentage: "75" } }), { on: true, speed: 0.75 });
  assert.deepEqual(flowOf({ state: "on", attributes: { percentage: 150 } }), { on: true, speed: 1 });
  // A fan that is on but reports no percentage runs at full flow.
  assert.deepEqual(flowOf({ state: "on", attributes: {} }), { on: true, speed: 1 });
  assert.deepEqual(flowOf(undefined), { on: false, speed: 0 });
  assert.deepEqual(flowOf({ state: "unavailable", attributes: { percentage: 50 } }), { on: false, speed: 0 });
});

test("light colour follows the effect; off keeps the tint for the fade-out", () => {
  assert.deepEqual(lightOf({ state: "on", attributes: { effect: "Red" } }), {
    on: true,
    effect: "Red",
    hex: "#ff4d4d",
  });
  assert.deepEqual(lightOf({ state: "off", attributes: { effect: "Red" } }), {
    on: false,
    effect: "Red",
    hex: "#ff4d4d",
  });
  assert.deepEqual(lightOf({ state: "on", attributes: {} }), { on: true, effect: null, hex: WHITE });
  assert.equal(lightOf(undefined).on, false);
});

test("spillover reads the pump mode sensor", () => {
  assert.equal(spillingOf({ state: "spillover" }), true);
  assert.equal(spillingOf({ state: "Spillover" }), true);
  assert.equal(spillingOf({ state: "pool" }), false);
  assert.equal(spillingOf(undefined), false);
});

test("night follows the Home Assistant dark theme, else the browser", () => {
  const dark = () => ({ matches: true });
  const light = () => ({ matches: false });
  assert.equal(isDarkMode({ themes: { darkMode: true } }, light), true);
  assert.equal(isDarkMode({ themes: { darkMode: false } }, dark), false);
  assert.equal(isDarkMode({}, dark), true);
  assert.equal(isDarkMode({}, light), false);
  assert.equal(isDarkMode(undefined, undefined), false);
});

test("the scene model binds pump, light and spillover by entity id", () => {
  const hass = {
    themes: { darkMode: true },
    states: {
      "fan.jets": { state: "on", attributes: { percentage: 60 } },
      "light.spa": { state: "on", attributes: { effect: "Magenta" } },
      "sensor.mode": { state: "spillover", attributes: {} },
    },
  };
  assert.deepEqual(modelOf(hass, { scene: "spa", pump: "fan.jets", light: "light.spa", spillover: "sensor.mode" }), {
    on: true,
    speed: 0.6,
    lightOn: true,
    effect: "Magenta",
    hex: "#e04bd6",
    spilling: true,
    dark: true,
  });
  // Unbound: still water, no light, no spillover.
  const bare = modelOf(hass, { scene: "pool" });
  assert.deepEqual([bare.on, bare.speed, bare.lightOn, bare.spilling], [false, 0, false, false]);
  assert.equal(modelOf(undefined, { scene: "pool", pump: "fan.jets" }).on, false);
});

test("reduced motion, off-screen and hidden tabs stop the frame loop", () => {
  assert.equal(shouldAnimate(), true);
  assert.equal(shouldAnimate({ reduced: true }), false);
  assert.equal(shouldAnimate({ visible: false }), false);
  assert.equal(shouldAnimate({ hidden: true }), false);
  assert.equal(shouldAnimate({ reduced: false, visible: true, hidden: false }), true);
});

const still = { on: false, speed: 0, lightOn: false, effect: null, hex: WHITE, spilling: false, dark: false };

test("the pool's water travels with pump speed and stands still when the pump is off", () => {
  const a = createSim();
  advance(a, 0.5, { ...still, on: true, speed: 1 }, "pool");
  assert.equal(a.flow, 13); // 26 px/s at full speed
  assert.ok(Math.abs(a.t - 0.5 * 2.2) < 1e-9);
  const b = createSim();
  advance(b, 0.5, { ...still, on: true, speed: 0.5 }, "pool");
  assert.equal(b.flow, 6.5);
  const c = createSim();
  advance(c, 0.5, still, "pool");
  assert.equal(c.flow, 0);
  assert.ok(Math.abs(c.t - 0.4) < 1e-9); // the caustics still drift slowly
  // Other scenes move their water through geometry, not lateral flow.
  const d = createSim();
  advance(d, 0.5, { ...still, on: true, speed: 1 }, "falls");
  assert.equal(d.flow, 0);
  assert.equal(d.wt, 0.5);
});

test("ripples fade and die", () => {
  const sim = createSim();
  addRipple(sim, 0.5, 0.5, 1);
  advance(sim, 1, still, "pool");
  assert.equal(sim.ripples.length, 1);
  assert.ok(sim.ripples[0].amp < 1);
  for (let i = 0; i < 4; i++) advance(sim, 1, still, "pool");
  assert.equal(sim.ripples.length, 0);
  for (let i = 0; i < 12; i++) addRipple(sim, 0, 0, 1);
  assert.equal(sim.ripples.length, 10, "capped");
});

test("the light snaps for a static frame and eases when animating", () => {
  const sim = createSim();
  stepLights(sim, null, { ...still, lightOn: true, hex: "#ff4d4d" });
  assert.equal(sim.lit.level, 1);
  assert.deepEqual(sim.lit.cur, [255, 77, 77]);
  stepLights(sim, 0.1, { ...still, lightOn: false, hex: "#ff4d4d" });
  assert.ok(sim.lit.level < 1 && sim.lit.level > 0.5);
  // A show cycles: the target hue depends on the clock.
  const show = createSim();
  stepLights(show, null, { ...still, lightOn: true, hex: SHOW });
  const first = [...show.lit.cur];
  show.t = 3;
  stepLights(show, null, { ...still, lightOn: true, hex: SHOW });
  assert.notDeepEqual(show.lit.cur, first);
});

const BW = 24;
const BH = 16;
const colors = (pal) => ({ a: hexToRgb(pal.a), b: hexToRgb(pal.b), hi: hexToRgb(pal.hi) });
const buffer = (sim, env) => {
  const data = new Uint8ClampedArray(BW * BH * 4);
  renderWater(data, BW, BH, sim, {
    kind: "pool",
    dark: false,
    colors: colors(PALETTE.day),
    fx: fixtures("pool", 120, 80, 0),
    strength: 0,
    ...env,
  });
  return data;
};
const mean = (data, channel) => {
  let sum = 0;
  for (let i = channel; i < data.length; i += 4) sum += data[i];
  return sum / (data.length / 4);
};

test("water buffer: deterministic, opaque, and moving water changes the picture", () => {
  const sim = createSim();
  const a = buffer(sim);
  assert.deepEqual(buffer(sim), a, "same sim, same pixels");
  for (let i = 3; i < a.length; i += 4) assert.equal(a[i], 255);
  const moved = createSim();
  moved.flow = 9;
  assert.notDeepEqual(buffer(moved), a, "flow moves the caustics");
  const later = createSim();
  later.t = 1;
  assert.notDeepEqual(buffer(later), a, "time moves the caustics");
});

test("water buffer: a red light reddens the water, night darkens it", () => {
  const off = buffer(createSim());
  const lit = createSim();
  lit.lit.level = 1;
  lit.lit.cur = [255, 77, 77];
  const red = buffer(lit, { strength: 1 });
  assert.ok(mean(red, 0) > mean(off, 0) + 40, `red ${mean(red, 0)} vs ${mean(off, 0)}`);
  assert.ok(mean(red, 2) < mean(off, 2), "less blue once lit red");
  const night = buffer(createSim(), { dark: true, colors: colors(PALETTE.night) });
  const dayLum = mean(off, 0) + mean(off, 1) + mean(off, 2);
  const nightLum = mean(night, 0) + mean(night, 1) + mean(night, 2);
  assert.ok(nightLum < dayLum * 0.6, `night ${nightLum} vs day ${dayLum}`);
});

test("geometry: falls and deck jets reach further with speed; ripples land only when water falls", () => {
  const W = 600;
  const H = 220;
  assert.ok(fallGeo(W, H, 1).half > fallGeo(W, H, 0).half);
  assert.ok(fallGeo(W, H, 1).run > fallGeo(W, H, 0).run);
  assert.ok(deckGeo(W, H, 1).jets[0].land[1] > deckGeo(W, H, 0.2).jets[0].land[1]);
  for (const kind of SCENES) assert.deepEqual(landings(kind, W, H, still), [], kind);
  assert.equal(landings("falls", W, H, { ...still, on: true, speed: 0.5 }).length, 1);
  assert.equal(landings("deck", W, H, { ...still, on: true, speed: 0.5 }).length, 3);
  assert.equal(landings("bub", W, H, { ...still, on: true, speed: 0.5 }).length, 3);
  assert.equal(landings("spa", W, H, { ...still, on: true, speed: 1 }).length, 0, "jets alone do not spill");
  assert.equal(landings("spa", W, H, { ...still, spilling: true }).length, 1);
  assert.deepEqual(landings("pool", W, H, { ...still, on: true, speed: 1 }), []);
  for (const kind of SCENES) {
    for (const f of fixtures(kind, W, H, 0.5)) {
      assert.ok(f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1, `${kind} fixture inside the picture`);
    }
  }
});

/* ----- Pool shapes and sizes ---------------------------------------------- */

// Walk SVG path data and collect every coordinate pair (absolute commands only,
// which is all the shape table uses), to check the outlines stay in the unit square.
function pathPoints(d) {
  const nums = d.replace(/[A-Za-z]/g, " $& ").trim().split(/[\s,]+/);
  const pts = [];
  let cmd = null;
  let buf = [];
  for (const tok of nums) {
    if (/^[A-Za-z]$/.test(tok)) {
      cmd = tok;
      buf = [];
      continue;
    }
    buf.push(Number(tok));
    if (cmd === "H" || cmd === "V") {
      pts.push(cmd === "H" ? [buf[0], null] : [null, buf[0]]);
      buf = [];
    } else if ((cmd === "M" || cmd === "L") && buf.length === 2) {
      pts.push(buf);
      buf = [];
    } else if (cmd === "Q" && buf.length === 4) {
      pts.push(buf.slice(0, 2), buf.slice(2));
      buf = [];
    } else if (cmd === "C" && buf.length === 6) {
      pts.push(buf.slice(0, 2), buf.slice(2, 4), buf.slice(4));
      buf = [];
    } else if (cmd === "A" && buf.length === 7) {
      pts.push(buf.slice(5));
      buf = [];
    }
  }
  return pts;
}

test("pool shapes: the standard set, each a closed path inside the unit square", () => {
  assert.deepEqual(SHAPE_NAMES, [
    "rectangle",
    "roman",
    "grecian",
    "oval",
    "round",
    "kidney",
    "figure-8",
    "lazy-l",
    "true-l",
    "mountain-lake",
    "freeform",
    "custom",
  ]);
  assert.equal(DEFAULT_SHAPE, "rectangle");
  for (const name of SHAPE_NAMES) assert.equal(typeof SHAPE_LABELS[name], "string", `${name} has a label`);
  for (const [name, def] of Object.entries(POOL_SHAPES)) {
    const d = def.path;
    assert.match(d, /^M/, name);
    assert.match(d, /Z$/, name);
    const pts = pathPoints(d);
    assert.ok(pts.length >= 3, `${name} has points`);
    for (const [x, y] of pts) {
      if (x != null) assert.ok(x >= 0 && x <= 1, `${name} x ${x}`);
      if (y != null) assert.ok(y >= 0 && y <= 1, `${name} y ${y}`);
    }
    assert.ok(/[ACQ]/.test(d) || name === "grecian", `${name} is drawn with curves or cut corners`);
    // Steps at the shallow end on the left, the drain at the deep end on the right.
    for (const key of ["steps", "deep"]) {
      assert.equal(def[key].length, 2, `${name} ${key}`);
      for (const n of def[key]) assert.ok(n >= 0 && n <= 1, `${name} ${key} ${n}`);
    }
    assert.ok(def.steps[0] < 0.2, `${name} steps at the left wall`);
    assert.ok(def.deep[0] > 0.8, `${name} deep end at the right`);
  }
});

test("poolOutline: a named shape, the default, round keeps 1:1, custom takes a path", () => {
  assert.deepEqual(poolOutline(), {
    shape: "rectangle",
    path: POOL_SHAPES.rectangle.path,
    uniform: false,
    steps: POOL_SHAPES.rectangle.steps,
    deep: POOL_SHAPES.rectangle.deep,
  });
  assert.deepEqual(poolOutline({ scene: "pool" }), poolOutline({}));
  assert.equal(poolOutline({ shape: "kidney" }).path, POOL_SHAPES.kidney.path);
  assert.equal(poolOutline({ shape: "round" }).uniform, true);
  assert.equal(poolOutline({ shape: "oval" }).uniform, false);
  const custom = poolOutline({ shape: "custom", path: " M0 0 H1 V1 H0 Z " });
  assert.deepEqual(custom, {
    shape: "custom",
    path: "M0 0 H1 V1 H0 Z",
    uniform: false,
    steps: [0.06, 0.5],
    deep: [0.94, 0.5],
  });
  const placed = poolOutline({ shape: "custom", path: "M0 0 Z", steps: [0.5, "1.4"], deep: [-1, 0.2] });
  assert.deepEqual([placed.steps, placed.deep], [[0.5, 1], [0, 0.2]], "custom points are clamped to the square");
  assert.deepEqual(poolOutline({ shape: "custom", path: "M0 0 Z", steps: "left" }).steps, [0.06, 0.5]);
  assert.throws(() => poolOutline({ shape: "custom" }), /needs "path"/);
  assert.throws(() => poolOutline({ shape: "custom", path: "H1 V1" }), /starting with M/);
  assert.throws(() => poolOutline({ shape: "octagon" }), /unknown shape "octagon".*rectangle.*custom/);
});

test("gridOptions: full width and 4 rows by default, rows clamped, resizable 2..12", () => {
  assert.deepEqual(gridOptions(), {
    columns: "full",
    rows: DEFAULT_ROWS,
    min_rows: ROWS_MIN,
    max_rows: ROWS_MAX,
    min_columns: 3,
  });
  assert.equal(DEFAULT_ROWS, 4);
  assert.equal(gridOptions({ rows: 6 }).rows, 6);
  assert.equal(gridOptions({ rows: "7.4" }).rows, 7);
  assert.equal(gridOptions({ rows: 1 }).rows, ROWS_MIN);
  assert.equal(gridOptions({ rows: 99 }).rows, ROWS_MAX);
  assert.equal(gridOptions({ rows: "tall" }).rows, DEFAULT_ROWS);
  assert.equal(gridOptions({ columns: 6 }).columns, 6);
  assert.equal(gridOptions({ columns: 40 }).columns, 12);
  assert.equal(gridOptions({ columns: "full" }).columns, "full");
  assert.equal(gridOptions({ columns: 0 }).columns, "full");
});

test("frameStyle: grid-driven by default, else a fixed height or an aspect ratio", () => {
  assert.equal(frameStyle(), "");
  assert.equal(frameStyle({ rows: 6 }), "");
  assert.equal(frameStyle({ height: 260 }), "height: 260px; min-height: 0;");
  assert.equal(frameStyle({ height: "180px" }), "height: 180px; min-height: 0;");
  assert.equal(frameStyle({ height: "tall" }), "");
  assert.equal(frameStyle({ height: -5 }), "");
  assert.equal(frameStyle({ aspect_ratio: "16:9" }), "aspect-ratio: 16 / 9; height: auto; min-height: 0;");
  assert.equal(frameStyle({ aspect_ratio: "21/9", height: 100 }), "aspect-ratio: 21 / 9; height: auto; min-height: 0;");
  assert.equal(frameStyle({ aspect_ratio: "16:0" }), "");
  assert.equal(frameStyle({ aspect_ratio: "wide" }), "");
});

test("editor schema: shape only for the pool, path only for custom, spillover only for the spa", () => {
  const names = (cfg) => editorSchema(cfg).map((f) => f.name);
  assert.deepEqual(names({}), ["scene", "shape", "pump", "light", "rows"]);
  assert.deepEqual(names({ scene: "pool", shape: "custom" }), ["scene", "shape", "path", "pump", "light", "rows"]);
  assert.deepEqual(names({ scene: "spa" }), ["scene", "pump", "light", "spillover", "rows"]);
  assert.deepEqual(names({ scene: "falls" }), ["scene", "pump", "light", "rows"]);
  const shape = editorSchema({}).find((f) => f.name === "shape");
  assert.deepEqual(
    shape.selector.select.options.map((o) => o.value),
    SHAPE_NAMES
  );
  const rows = editorSchema({}).find((f) => f.name === "rows");
  assert.deepEqual(rows.selector.number, { min: ROWS_MIN, max: ROWS_MAX, mode: "slider" });
});
