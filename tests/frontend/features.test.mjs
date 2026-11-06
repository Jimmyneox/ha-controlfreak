// node --test tests/frontend/*.test.mjs
//
// The tile features: pump speed slider, light colour bar, light show dropdown.
// The pure helpers are tested here; the elements render in the Playwright harness.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  FEATURE_TYPES,
  LIGHT_COLORS,
  LIGHT_SHOWS,
  PUMP_SPEED,
  speedRange,
  splitEffects,
  supportsLightColors,
  supportsLightShows,
  supportsPumpSpeed,
} from "../../custom_components/controlfreak/frontend/controlfreak-features.js";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

// The effect list the Control Freak panel publishes for a colour light (captured live).
const PENTAIR = [
  "SAM Mode", "Party Mode", "Romance Mode", "Carribbean Mode", "American Mode",
  "California Sunset Mode", "Royal Mode", "Blue", "Green", "Red", "White", "Magenta",
];

test("the live effect list splits into five colours and seven shows, in the panel's order", () => {
  const { colors, shows } = splitEffects(PENTAIR);
  assert.deepEqual(colors.map((c) => c.name), ["Blue", "Green", "Red", "White", "Magenta"]);
  for (const c of colors) assert.match(c.hex, /^#[0-9a-f]{6}$/i, c.name);
  assert.deepEqual(shows, [
    "SAM Mode", "Party Mode", "Romance Mode", "Carribbean Mode", "American Mode",
    "California Sunset Mode", "Royal Mode",
  ]);
});

test("unknown names: CSS colour words are colours, anything else is a show; empty lists split empty", () => {
  const { colors, shows } = splitEffects(["Teal", "Orange", "Sunset Fade", "Disco", "Cycle"]);
  assert.deepEqual(colors.map((c) => c.name), ["Teal", "Orange"]);
  assert.deepEqual(shows, ["Sunset Fade", "Disco", "Cycle"]);
  assert.deepEqual(splitEffects([]), { colors: [], shows: [] });
  assert.deepEqual(splitEffects(undefined), { colors: [], shows: [] });
});

test("the pump's range comes from its attributes, else the whole percentage scale", () => {
  assert.deepEqual(speedRange({ attributes: { speed_min: 40, speed_max: 100 } }), { min: 40, max: 100 });
  assert.deepEqual(speedRange({ attributes: {} }), { min: 1, max: 100 });
  assert.deepEqual(speedRange(undefined), { min: 1, max: 100 });
});

test("isSupported: a fan with speed control, a light with colours, a light with shows", () => {
  const hass = fixture("full-pool");
  const fan = Object.keys(hass.states).find((e) => e.startsWith("fan."));
  const light = Object.keys(hass.states).find((e) => e.startsWith("light.") && hass.states[e].attributes.effect_list);
  assert.ok(fan && light, "fixture has a fan and a colour light");
  assert.equal(supportsPumpSpeed(hass, { entity_id: fan }), true);
  assert.equal(supportsPumpSpeed(hass, { entity_id: light }), false);
  assert.equal(supportsLightColors(hass, { entity_id: light }), true);
  assert.equal(supportsLightShows(hass, { entity_id: light }), true);
  assert.equal(supportsLightColors(hass, { entity_id: fan }), false);
  assert.equal(supportsLightShows(hass, { entity_id: "light.missing" }), false);
  // A light whose effects are all colours offers no show dropdown, and the reverse.
  const only = (list) => ({ states: { "light.x": { state: "on", attributes: { effect_list: list } } } });
  assert.equal(supportsLightShows(only(["Blue", "Red"]), { entity_id: "light.x" }), false);
  assert.equal(supportsLightColors(only(["Party Mode"]), { entity_id: "light.x" }), false);
});

test("the three feature tags are what the strategy writes as custom:<tag>", () => {
  assert.deepEqual(FEATURE_TYPES, [PUMP_SPEED, LIGHT_COLORS, LIGHT_SHOWS]);
  assert.deepEqual(FEATURE_TYPES, ["controlfreak-pump-speed", "controlfreak-light-colors", "controlfreak-light-shows"]);
});
