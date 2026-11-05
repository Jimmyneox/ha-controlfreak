// node --test tests/frontend/*.test.mjs
//
// The picture styles, drawn into a recording 2D context: every style draws
// every scene by day and by night without throwing and paints something, the
// pump and the light change what is painted, and an unknown style is refused.
// Real pixels are checked by the Playwright render check
// (harness.html?shape=styles-day / styles-night).

import assert from "node:assert/strict";
import { test } from "node:test";

import { SCENES, WHITE } from "../../custom_components/controlfreak/frontend/controlfreak-picture.js";
import {
  DEFAULT_STYLE,
  flatWater,
  makeStyledScene,
  PAINTERS,
  ringCentres,
  STYLE_LABELS,
  STYLES,
} from "../../custom_components/controlfreak/frontend/controlfreak-picture-styles.js";

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
  assert.deepEqual(Object.keys(PAINTERS), ["blueprint", "depth", "neon", "poster"]);
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
