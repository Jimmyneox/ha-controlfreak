// node --test tests/frontend/*.test.mjs
//
// The picture styles, drawn into a recording 2D context: every style draws
// every scene by day and by night without throwing and paints something, the
// pump and the light change what is painted, and an unknown style is refused.
// Real pixels are checked by the Playwright render check
// (harness.html?shape=styles-day / styles-night).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OVERVIEW,
  OVERVIEW_PARTS,
  overviewModelOf,
  SCENES,
  WHITE,
} from "../../custom_components/controlfreak/frontend/controlfreak-picture.js";
import {
  DECK_LABELS,
  DECKS,
  deckBase,
  deckPattern,
  deckTone,
  DEFAULT_DECK,
  DEFAULT_STYLE,
  flatWater,
  NIGHT_DIM,
  makeStyledScene,
  overviewGeo,
  overviewLandings,
  overviewPad,
  PAINTERS,
  ringCentres,
  STYLE_LABELS,
  STYLES,
} from "../../custom_components/controlfreak/frontend/controlfreak-picture-styles.js";
import {
  DEFAULT_SHAPE,
  layoutShape,
  outlinePoints,
  PARTS,
  partsOf,
  SHAPE_DEFS,
  SHAPE_LABELS,
  SHAPES,
} from "../../custom_components/controlfreak/frontend/controlfreak-pool-shapes.js";

const PAINT_OPS = new Set(["fill", "stroke", "fillRect", "strokeRect", "drawImage", "putImageData"]);

/** A CanvasRenderingContext2D stand-in that records every call. */
function recordingContext(log) {
  const gradient = { addColorStop() {} };
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      if (prop === "createPattern") return () => "pattern";
      if (prop === "createImageData" || prop === "getImageData") {
        return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      }
      if (prop === "measureText") return () => ({ width: 10 });
      if (typeof prop === "symbol") return undefined;
      return (...args) => {
        log.push([prop, args]);
      };
    },
    set(t, prop, value) {
      t[prop] = value;
      log.push(["set", [prop, String(value)]]); // fillStyle and friends count as drawing decisions
      return true;
    },
  });
}

function fakeCanvas(width = 600, height = 220, log = []) {
  return {
    width: 0,
    height: 0,
    log,
    getContext: () => recordingContext(log),
    getBoundingClientRect: () => ({ width, height }),
  };
}

// The engine creates offscreen canvases through `document`.
const log = [];
globalThis.document = { createElement: () => fakeCanvas(96, 96, log), hidden: false };
globalThis.requestAnimationFrame = () => 0;

const still = { on: false, speed: 0, lightOn: false, effect: null, hex: WHITE, spilling: false, dark: false };
const colors = { a: [76, 195, 214], b: [29, 143, 176], hi: [255, 255, 255] };
const paints = (cv) => cv.log.filter(([op]) => PAINT_OPS.has(op)).length;

function drawOnce(style, scene, model) {
  const cv = fakeCanvas();
  const s = makeStyledScene(cv, scene, style, () => model, () => colors, () => 0.5);
  s.kick(); // before layout: nothing to draw yet, must not throw
  s.resize(); // layout -> first frame
  return { cv, s };
}

test("every style draws every scene by day and by night and paints something", () => {
  assert.deepEqual(STYLES, ["caustic", "blueprint", "depth", "neon", "poster"]);
  assert.equal(DEFAULT_STYLE, "caustic");
  assert.deepEqual(Object.keys(PAINTERS), ["caustic", "blueprint", "depth", "neon", "poster"]);
  for (const style of STYLES) assert.equal(typeof STYLE_LABELS[style], "string", style);
  let cases = 0;
  for (const style of STYLES) {
    for (const scene of SCENES) {
      for (const dark of [false, true]) {
        const model = { ...still, on: true, speed: 0.6, lightOn: true, hex: "#2f7dff", spilling: scene === "spa", dark };
        const { cv, s } = drawOnce(style, scene, model);
        assert.equal(s.frames, 1, `${style}/${scene}/${dark ? "night" : "day"} drew one frame`);
        assert.ok(paints(cv) > 5, `${style}/${scene}/${dark ? "night" : "day"} painted (${paints(cv)} ops)`);
        assert.ok(cv.width > 0 && cv.height > 0, "canvas sized");
        cases++;
      }
    }
  }
  assert.equal(cases, 50);
});

test("the pump and the light change what a style paints; a still frame draws when the pump is off", () => {
  for (const style of STYLES) {
    for (const scene of SCENES) {
      const off = drawOnce(style, scene, still);
      const on = drawOnce(style, scene, { ...still, on: true, speed: 1 });
      const lit = drawOnce(style, scene, { ...still, lightOn: true, hex: "#ff4d4d" });
      assert.ok(paints(off.cv) > 0, `${style}/${scene} off still paints`);
      assert.notEqual(JSON.stringify(on.cv.log), JSON.stringify(off.cv.log), `${style}/${scene}: the pump changes the picture`);
      assert.notEqual(JSON.stringify(lit.cv.log), JSON.stringify(off.cv.log), `${style}/${scene}: the light changes the picture`);
    }
  }
});

test("a splash ripple and a kick redraw without the frame loop", () => {
  for (const style of STYLES) {
    const { cv, s } = drawOnce(style, "pool", still);
    const before = cv.log.length;
    s.splash(0.5, 0.5);
    assert.equal(s.frames, 2);
    assert.ok(cv.log.length > before);
    s.kick();
    assert.equal(s.frames, 3);
    assert.equal(s.running, false);
    s.start();
    assert.equal(s.running, true);
    s.stop();
    assert.equal(s.running, false);
  }
});

test("an unknown style is refused the way an unknown scene is", () => {
  assert.throws(() => makeStyledScene(fakeCanvas(), "pool", "sepia", () => still, () => colors), /set "style" to one of caustic, blueprint, depth, neon, poster/);
  assert.throws(() => makeStyledScene(fakeCanvas(), "pool", "", () => still, () => colors), /set "style"/);
  // The default style is the caustic renderer.
  const { s } = drawOnce(undefined, "pool", still);
  assert.equal(s.frames, 1);
});

test("flat water: the light tints it and night darkens it", () => {
  const day = flatWater(colors, [255, 77, 77], 0, false);
  const lit = flatWater(colors, [255, 77, 77], 1, false);
  const night = flatWater(colors, [255, 77, 77], 0, true);
  assert.ok(lit[0] > day[0] + 40, "red light reddens");
  assert.ok(lit[2] < day[2], "less blue once lit red");
  assert.ok(night[0] + night[1] + night[2] < day[0] + day[1] + day[2], "night is darker");
});

test("ring centres: landings when water falls, else the fixtures or the pool's own spots", () => {
  const W = 600;
  const H = 220;
  assert.equal(ringCentres("pool", W, H, still).length, 2);
  assert.equal(ringCentres("spa", W, H, still).length, 1);
  assert.equal(ringCentres("falls", W, H, { ...still, on: true, speed: 0.5 }).length, 1);
  assert.equal(ringCentres("deck", W, H, { ...still, on: true, speed: 0.5 }).length, 3);
  assert.equal(ringCentres("bub", W, H, still).length, 3, "bubbler heads when off");
  for (const kind of SCENES) {
    for (const [x, y] of ringCentres(kind, W, H, { ...still, on: true, speed: 1, spilling: true })) {
      assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${kind} centre inside the picture`);
    }
  }
});

/* ----- The overview ------------------------------------------------------ */

/** An overview model the way overviewModelOf builds it: every part bound, pumps on, lights lit. */
function overviewModel({ shape = DEFAULT_SHAPE, on = true, lit = true, dark = false, spilling = true, show } = {}) {
  const part = (hex) => ({ on, speed: on ? 0.6 : 0, lightOn: lit, effect: lit ? "Blue" : null, hex, rgb: [47, 125, 255] });
  const parts = Object.fromEntries(OVERVIEW_PARTS.map((p) => [p, part("#2f7dff")]));
  const config = { pumps: Object.fromEntries(OVERVIEW_PARTS.map((p) => [p, `fan.${p}`])) };
  if (show) config.show = show;
  return { ...still, on, speed: on ? 0.6 : 0, lightOn: lit, hex: "#2f7dff", spilling, dark, shape, parts, show: partsOf(config) };
}

test("every style draws every shape by day and by night and paints something", () => {
  assert.deepEqual(SHAPES, ["rectangle", "roman", "kidney", "freeform", "lagoon", "figure8"]);
  assert.equal(DEFAULT_SHAPE, "freeform");
  for (const shape of SHAPES) assert.equal(typeof SHAPE_LABELS[shape], "string", shape);
  let cases = 0;
  for (const style of STYLES) {
    for (const shape of SHAPES) {
      for (const dark of [false, true]) {
        const { cv, s } = drawOnce(style, OVERVIEW, overviewModel({ shape, dark }));
        const tag = `${style}/${shape}/${dark ? "night" : "day"}`;
        assert.equal(s.frames, 1, `${tag} drew one frame`);
        assert.ok(paints(cv) > 20, `${tag} painted (${paints(cv)} ops)`);
        cases++;
      }
    }
  }
  assert.equal(cases, 60);
  // The caustic style has no separate renderer for the overview: it goes through the engine too.
  const { s } = drawOnce("caustic", OVERVIEW, overviewModel());
  assert.equal(s.frames, 1);
  assert.equal(typeof s.splash, "function");
});

test("each part has its own pump and light in the overview; the shape changes the picture", () => {
  for (const style of STYLES) {
    const base = drawOnce(style, OVERVIEW, overviewModel({ on: false, lit: false, spilling: false }));
    const logOf = (m) => JSON.stringify(drawOnce(style, OVERVIEW, m).cv.log);
    const baseLog = JSON.stringify(base.cv.log);
    // overviewModelOf mirrors the pool part onto the model's own fields: do the same.
    const sync = (m) => Object.assign(m, { on: m.parts.pool.on, speed: m.parts.pool.speed, lightOn: m.parts.pool.lightOn, hex: m.parts.pool.hex });
    for (const part of OVERVIEW_PARTS) {
      const pumped = overviewModel({ on: false, lit: false, spilling: false });
      pumped.parts[part] = { ...pumped.parts[part], on: true, speed: 1 };
      assert.notEqual(logOf(sync(pumped)), baseLog, `${style}: the ${part} pump changes the picture`);
      const litOne = overviewModel({ on: false, lit: false, spilling: false });
      litOne.parts[part] = { ...litOne.parts[part], lightOn: true, hex: "#ff4d4d", rgb: [255, 77, 77] };
      assert.notEqual(logOf(sync(litOne)), baseLog, `${style}: the ${part} light changes the picture`);
    }
    // A part the panel doesn't run is left out of the drawing.
    const bare = overviewModel({ on: false, lit: false, spilling: false });
    bare.show = partsOf({ pumps: { pool: "fan.pool" } });
    assert.notEqual(logOf(bare), baseLog, `${style}: unbound parts are not drawn`);
    // Two outlines never draw the same.
    const seen = new Set(SHAPES.map((shape) => logOf(overviewModel({ shape, on: false, lit: false, spilling: false }))));
    assert.equal(seen.size, SHAPES.length, `${style}: every shape draws differently`);
  }
});

test("overview geometry: every part lands inside the picture, the spa on the rim", () => {
  const W = 900;
  const H = 400;
  assert.ok(overviewPad(W, H) > 0 && overviewPad(W, H) < H / 3);
  for (const shape of SHAPES) {
    const model = overviewModel({ shape });
    const g = overviewGeo(W, H, model);
    const inside = ([x, y]) => x >= -1 && x <= W + 1 && y >= -1 && y <= H + 1;
    assert.ok(inside([g.spa.x, g.spa.y]), `${shape}: spa inside`);
    assert.ok(g.spa.r > 10, `${shape}: spa big enough to read`);
    for (const [x, y] of g.L.points) assert.ok(inside([x, y]), `${shape}: outline inside`);
    const landings = overviewLandings(W, H, model);
    assert.ok(landings.length >= 3, `${shape}: falls, spillover, jets and bubblers land (${landings.length})`);
    for (const l of landings) assert.ok(inside(l), `${shape}: landing inside`);
    // Nothing falls when nothing runs.
    assert.deepEqual(overviewLandings(W, H, overviewModel({ shape, on: false, spilling: false })), []);
  }
  assert.throws(() => overviewGeo(W, H, overviewModel({ shape: "oval" })), /set "shape" to one of/);
});

/* ----- Pool shapes (pure) ------------------------------------------------ */

test("every shape definition is complete and its outline is a closed curve inside the unit square", () => {
  assert.deepEqual(PARTS, ["spa", "falls", "deck", "bub", "steps", "ledge"]);
  for (const shape of SHAPES) {
    const d = SHAPE_DEFS[shape];
    assert.ok(d.points.length >= 4, `${shape}: a polygon`);
    for (const key of ["spa", "steps", "ledge"]) assert.ok(d[key].t >= 0 && d[key].t < 1 && d[key].r > 0, `${shape}.${key}`);
    for (const key of ["falls", "deck"]) assert.ok(d[key].t0 >= 0 && d[key].t1 <= 1, `${shape}.${key}`);
    assert.ok(d.lights.length >= 2, `${shape}: lights`);
    assert.ok(d.tension >= 0 && d.tension <= 1, `${shape}: tension`);
    const pts = outlinePoints(d, 240);
    assert.equal(pts.length, 240);
    for (const [x, y] of pts) assert.ok(x >= -0.02 && x <= 1.02 && y >= -0.02 && y <= 1.02, `${shape}: outline in the unit square`);
    // Consecutive samples are close: no jumps, so the curve is continuous and closes.
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.08, `${shape}: step ${i} is small`);
    }
  }
  // A rectangle stays a rectangle: no tension, straight edges.
  assert.equal(SHAPE_DEFS.rectangle.tension, 0);
});

test("layoutShape: pixels with padding, inward normals, and a refusal for unknown shapes", () => {
  const L = layoutShape("rectangle", 800, 400, 40);
  assert.equal(L.name, "rectangle");
  assert.deepEqual(L.box, { x: 40, y: 40, w: 720, h: 320 });
  assert.deepEqual(L.centre, [400, 200]);
  for (const [x, y] of L.points) assert.ok(x >= 40 && x <= 760 && y >= 40 && y <= 360, "inside the box");
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
    const p = L.at(t);
    assert.ok(Math.abs(Math.hypot(p.nx, p.ny) - 1) < 1e-6, "unit normal");
    // Stepping along the normal moves toward the centre.
    const before = Math.hypot(p.x - 400, p.y - 200);
    const after = Math.hypot(p.x + p.nx * 5 - 400, p.y + p.ny * 5 - 200);
    assert.ok(after < before, `t=${t}: normal points into the water`);
  }
  assert.deepEqual(L.at(1.25), L.at(0.25), "t wraps");
  assert.deepEqual(L.at(-0.75), L.at(0.25), "t wraps backwards");
  // A tiny canvas never produces a zero-size box.
  assert.ok(layoutShape("kidney", 10, 10, 40).box.w >= 1);
  assert.throws(() => layoutShape("oval", 800, 400, 40), /set "shape" to one of rectangle, roman, kidney, freeform, lagoon, figure8/);
  assert.throws(() => layoutShape(undefined, 800, 400, 40), /set "shape"/);
});

test("partsOf: a part shows with a pump or a light; show adds parts; steps default on; a ledge comes with bubblers", () => {
  assert.deepEqual(partsOf({}), { spa: false, falls: false, deck: false, bub: false, steps: true, ledge: false });
  assert.deepEqual(partsOf({ pumps: { pool: "fan.p", spa: "fan.s" } }).spa, true);
  assert.deepEqual(partsOf({ lights: { falls: "light.f" } }).falls, true);
  const bub = partsOf({ pumps: { bub: "fan.b" } });
  assert.equal(bub.bub, true);
  assert.equal(bub.ledge, true, "bubblers sit on the ledge");
  const shown = partsOf({ show: ["spa", "ledge"] });
  assert.deepEqual(shown, { spa: true, falls: false, deck: false, bub: false, steps: false, ledge: true });
  assert.equal(partsOf({ show: ["steps"] }).steps, true);
  assert.equal(partsOf({ show: [] }).steps, false, "an explicit show without steps hides them");
});

test("overviewModelOf: each part reads its own pump and light; the pool part is the picture's own", () => {
  const hass = {
    states: {
      "fan.pool": { state: "on", attributes: { percentage: 50 } },
      "fan.spa": { state: "off", attributes: { percentage: 0 } },
      "light.spa": { state: "on", attributes: { effect: "Magenta" } },
      "sensor.mode": { state: "Spillover" },
    },
  };
  const config = {
    scene: OVERVIEW,
    shape: "roman",
    pumps: { pool: "fan.pool", spa: "fan.spa" },
    lights: { spa: "light.spa" },
    spillover: "sensor.mode",
    show: ["ledge"],
  };
  const m = overviewModelOf(hass, config);
  assert.equal(m.shape, "roman");
  assert.equal(m.on, true);
  assert.equal(m.speed, 0.5);
  assert.equal(m.lightOn, false, "the pool has no light bound");
  assert.equal(m.parts.spa.on, false);
  assert.equal(m.parts.spa.lightOn, true);
  assert.deepEqual(m.parts.spa.rgb, [0xe0, 0x4b, 0xd6]);
  assert.equal(m.parts.spa.hex, "#e04bd6");
  assert.equal(m.parts.falls.on, false, "unbound parts are still");
  assert.equal(m.spilling, true);
  assert.deepEqual(m.show, { spa: true, falls: false, deck: false, bub: false, steps: false, ledge: true });
  assert.equal(overviewModelOf(hass, { scene: OVERVIEW }).shape, DEFAULT_SHAPE);
});

/* ----- Deck finishes ----------------------------------------------------- */

test("every style draws every deck finish by day and by night, and the finish changes the picture", () => {
  assert.deepEqual(DECKS, ["concrete", "pavers", "travertine", "wood", "stone"]);
  assert.equal(DEFAULT_DECK, "concrete");
  for (const d of DECKS) assert.equal(typeof DECK_LABELS[d], "string", d);
  let cases = 0;
  for (const style of STYLES) {
    const logs = new Set();
    for (const deck of DECKS) {
      for (const dark of [false, true]) {
        const { cv, s } = drawOnce(style, OVERVIEW, { ...overviewModel({ dark }), deck });
        const tag = `${style}/${deck}/${dark ? "night" : "day"}`;
        assert.equal(s.frames, 1, `${tag} drew one frame`);
        assert.ok(paints(cv) > 20, `${tag} painted (${paints(cv)} ops)`);
        logs.add(JSON.stringify(cv.log));
        cases++;
      }
    }
    assert.equal(logs.size, DECKS.length * 2, `${style}: every finish and time of day paints differently`);
  }
  assert.equal(cases, 50);
  // No deck in the model: the default finish, the same picture as asking for it by name.
  const bare = drawOnce("depth", OVERVIEW, overviewModel());
  const named = drawOnce("depth", OVERVIEW, { ...overviewModel(), deck: DEFAULT_DECK });
  assert.equal(JSON.stringify(bare.cv.log), JSON.stringify(named.cv.log));
  // The per-feature scenes with a deck strip (spa, deck jets) take the finish too.
  for (const scene of ["spa", "deck"]) {
    const a = drawOnce("depth", scene, { ...still, on: true, speed: 0.6, deck: "concrete" });
    const b = drawOnce("depth", scene, { ...still, on: true, speed: 0.6, deck: "wood" });
    assert.notEqual(JSON.stringify(a.cv.log), JSON.stringify(b.cv.log), `depth/${scene}: the finish shows`);
  }
});

test("deck helpers: a light day tone for concrete, a pattern per finish, and an unknown finish falls back to concrete", () => {
  const [r, g, b] = deckTone("concrete", false);
  assert.ok(r > 200 && g > 200 && b > 200, "concrete by day is light grey");
  // Night is the day colour, only a little darker: same hue, every channel scaled alike.
  assert.ok(NIGHT_DIM >= 0.7 && NIGHT_DIM <= 0.85, "slightly darker, not a different deck");
  for (const d of DECKS) {
    const day = deckTone(d, false);
    const night = deckTone(d, true);
    for (let i = 0; i < 3; i++) assert.equal(night[i], Math.round(day[i] * NIGHT_DIM), `${d} channel ${i}`);
  }
  assert.deepEqual(deckTone("lawn", false), deckTone("concrete", false));
  const patterns = new Set();
  for (const d of DECKS) {
    const log = [];
    deckPattern(recordingContext(log), 0, 0, 300, 200, d, "#000");
    assert.ok(log.some(([op]) => op === "stroke" || op === "fillRect"), `${d} draws joints`);
    patterns.add(JSON.stringify(log));
  }
  assert.equal(patterns.size, DECKS.length, "each finish has its own pattern");
  const log = [];
  deckBase(recordingContext(log), 0, 0, 300, 200, "pavers", false);
  assert.ok(log.some(([op]) => op === "fillRect"), "the base fills the deck");
});
