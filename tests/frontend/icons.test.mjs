// node --test tests/frontend/*.test.mjs
//
// The cf: icon set: every icon builds, is one valid filled path inside the
// box, and every name the integration emits is drawn.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  getIcon,
  ICON_NAMES,
  ICON_VIEW_BOX,
  iconPath,
} from "../../custom_components/controlfreak/frontend/controlfreak-icons.js";

const PY = new URL("../../custom_components/controlfreak/", import.meta.url);

test("every icon is a closed, finite path drawn inside the 24-unit box", () => {
  assert.ok(ICON_NAMES.length >= 20);
  for (const name of ICON_NAMES) {
    const d = iconPath(name);
    assert.match(d, /^(M[-\d. L]+Z)+$/, `${name}: move/line/close only`);
    assert.ok(!d.includes("NaN"), name);
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    for (const n of nums) assert.ok(n >= 1 && n <= 23, `${name}: ${n} inside the box`);
    assert.ok(d.length > 80, `${name}: has some shape`);
    assert.equal(iconPath(name), d, "cached");
  }
  assert.equal(iconPath("nothing"), null);
});

test("getIcon answers Home Assistant's custom icon hook", async () => {
  assert.deepEqual(await getIcon("pump"), { path: iconPath("pump"), viewBox: ICON_VIEW_BOX });
  assert.equal(await getIcon("nothing"), undefined);
  assert.equal(ICON_VIEW_BOX, "1.5 1.5 21 21");
});

test("every cf: icon the integration emits is drawn", () => {
  const emitted = new Set();
  for (const f of readdirSync(PY).filter((f) => f.endsWith(".py"))) {
    for (const m of readFileSync(new URL(f, PY), "utf8").matchAll(/"cf:([a-z-]+)"/g)) emitted.add(m[1]);
  }
  assert.ok(emitted.size >= 15, [...emitted]);
  for (const name of emitted) assert.ok(ICON_NAMES.includes(name), `cf:${name} is drawn`);
});
