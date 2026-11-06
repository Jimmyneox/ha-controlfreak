/**
 * Tile card features for Control Freak equipment. Loaded by the integration
 * next to the strategy and the picture card; the strategy puts them on its
 * tiles, and any tile card can carry them by hand:
 *
 *   type: tile
 *   entity: fan.filter_pump
 *   features:
 *     - type: custom:controlfreak-pump-speed   # a slider in the pump's own range (40–100 %) and an Off button
 *
 *   type: tile
 *   entity: light.pool_light
 *   features:
 *     - type: custom:controlfreak-light-colors # a bar of colour swatches, one per colour effect
 *     - type: custom:controlfreak-light-shows  # a dropdown of the light shows (SAM Mode, Party Mode, ...)
 *
 * A Control Freak light's colours and shows are both Home Assistant effects.
 * The colours are the ones the picture card knows (EFFECT_COLORS); anything
 * named "... Mode" or "... Show" is a show; a CSS colour name is a colour.
 *
 * Pure helpers (splitEffects, speedRange, the isSupported checks) are exported
 * for tests and run in Node; the elements themselves need a browser.
 */

import { EFFECT_COLORS, SHOW } from "./controlfreak-picture.js";

export const PUMP_SPEED = "controlfreak-pump-speed";
export const LIGHT_COLORS = "controlfreak-light-colors";
export const LIGHT_SHOWS = "controlfreak-light-shows";
export const FEATURE_TYPES = [PUMP_SPEED, LIGHT_COLORS, LIGHT_SHOWS];

const FAN_SET_SPEED = 1;
const LIGHT_EFFECT = 4;

/** CSS colour names a panel might use for an effect that the table doesn't know. */
const CSS_COLORS = {
  blue: "#2f7dff",
  green: "#34d07b",
  red: "#ff4d4d",
  white: "#f4f7ff",
  magenta: "#e04bd6",
  cyan: "#29d6ff",
  aqua: "#29d6ff",
  teal: "#1fb3a6",
  purple: "#8a4dff",
  violet: "#8a4dff",
  pink: "#ff6fb5",
  orange: "#ff9a3c",
  yellow: "#ffd23f",
  amber: "#ffbf2a",
  lime: "#b6f03c",
  gold: "#ffcc4d",
  turquoise: "#36d6c3",
  lavender: "#b9a6ff",
  indigo: "#4b4dff",
  warm: "#ffd9a0",
  cool: "#dfeeff",
};

/**
 * Colour effects and show effects from a light's effect_list, in its order.
 * Returns { colors: [{ name, hex }], shows: [name] }.
 */
export function splitEffects(effectList) {
  const colors = [];
  const shows = [];
  for (const raw of Array.isArray(effectList) ? effectList : []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const name = raw.trim();
    const known = EFFECT_COLORS[name];
    if (typeof known === "string" && known !== SHOW) {
      colors.push({ name, hex: known });
      continue;
    }
    if (known === SHOW || /\b(mode|show|cycle|fade|party|romance|sunset)\b/i.test(name)) {
      shows.push(name);
      continue;
    }
    const css = CSS_COLORS[name.toLowerCase().replace(/[^a-z]/g, "")];
    if (css) colors.push({ name, hex: css });
    else shows.push(name);
  }
  return { colors, shows };
}

/**
 * The slider's range for a pump: the pump's own speed_min/speed_max when the
 * entity reports them (the integration does), else Home Assistant's 1–100.
 */
export function speedRange(stateObj) {
  const a = stateObj?.attributes ?? {};
  const min = Number(a.speed_min);
  const max = Number(a.speed_max);
  const ok = Number.isFinite(min) && Number.isFinite(max) && min >= 1 && max > min && max <= 100;
  return ok ? { min: Math.round(min), max: Math.round(max) } : { min: 1, max: 100 };
}

const stateOf = (hass, context) => (context?.entity_id ? hass?.states?.[context.entity_id] : undefined);
const domainOf = (id) => String(id ?? "").split(".")[0];
const hasBit = (st, bit) => ((Number(st?.attributes?.supported_features) || 0) & bit) !== 0;

export function supportsPumpSpeed(hass, context) {
  const st = stateOf(hass, context);
  return Boolean(st) && domainOf(context.entity_id) === "fan" && hasBit(st, FAN_SET_SPEED);
}

export function supportsLightColors(hass, context) {
  const st = stateOf(hass, context);
  if (!st || domainOf(context.entity_id) !== "light" || !hasBit(st, LIGHT_EFFECT)) return false;
  return splitEffects(st.attributes.effect_list).colors.length > 0;
}

export function supportsLightShows(hass, context) {
  const st = stateOf(hass, context);
  if (!st || domainOf(context.entity_id) !== "light" || !hasBit(st, LIGHT_EFFECT)) return false;
  return splitEffects(st.attributes.effect_list).shows.length > 0;
}

/* ----- Elements ---------------------------------------------------------- */

const Base = globalThis.HTMLElement ?? class {};

const COMMON_CSS = `
  :host { display: block; }
  .row { display: flex; gap: var(--feature-button-spacing, 12px); align-items: stretch; height: var(--feature-height, 42px); }
  button { font: inherit; color: inherit; cursor: pointer; border: 0; padding: 0; margin: 0; background: none; }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--feature-color, var(--primary-color)); outline-offset: 2px; }
  .off { flex: 0 0 var(--feature-height, 42px); border-radius: var(--feature-border-radius, 12px);
         background: var(--control-button-background-color, var(--disabled-color, #9e9e9e));
         opacity: var(--control-button-background-opacity, 0.2); color: var(--primary-text-color); display: grid; place-items: center; }
  .off:hover { opacity: 0.35; }
  .off svg { width: 20px; height: 20px; fill: currentColor; opacity: 1; }
`;

class Feature extends Base {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._context = null;
    this._stateObj = null;
    this._key = null;
    if (this.attachShadow) this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error(`${this.constructor.TYPE}: invalid configuration`);
    this._config = config;
    this._key = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  get hass() {
    return this._hass;
  }

  set context(context) {
    this._context = context;
    this._key = null;
    this._render();
  }

  get context() {
    return this._context;
  }

  get entityId() {
    return this._context?.entity_id ?? this._stateObj?.entity_id ?? this._config?.entity ?? null;
  }

  /**
   * The tile card assigns `stateObj` itself (and `color` and `position`) on
   * every render, so this has to be a settable property; without a hass it
   * is the only state the feature has. Assigning it with the getter alone
   * throws "Cannot set property stateObj ... which has only a getter" and
   * the feature renders blank.
   */
  set stateObj(stateObj) {
    this._stateObj = stateObj ?? null;
    this._render();
  }

  get stateObj() {
    if (this._stateObj) return this._stateObj;
    return this.entityId ? this._hass?.states?.[this.entityId] : undefined;
  }

  /** Rebuild only when what the control shows has changed. */
  _render() {
    if (!this.shadowRoot || !this._config) return;
    const key = this._renderKey();
    if (key === this._key) return;
    this._key = key;
    this.shadowRoot.replaceChildren();
    const style = document.createElement("style");
    style.textContent = COMMON_CSS + this.constructor.CSS;
    this.shadowRoot.append(style);
    this._draw(this.shadowRoot);
  }

  _call(domain, service, data) {
    if (!this._hass?.callService || !this.entityId) return;
    this._hass.callService(domain, service, { entity_id: this.entityId, ...data });
  }

  _svgPower() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(ns, "path");
    p.setAttribute(
      "d",
      "M16.56 5.44l-1.45 1.45A5.97 5.97 0 0 1 18 12a6 6 0 0 1-12 0c0-2.17 1.16-4.06 2.88-5.12L7.44 5.44A7.96 7.96 0 0 0 4 12a8 8 0 0 0 16 0c0-2.72-1.36-5.12-3.44-6.56M13 3h-2v10h2"
    );
    svg.append(p);
    return svg;
  }
}

/** A slider in the pump's own speed range, an Off button beside it. */
export class PumpSpeedFeature extends Feature {
  static TYPE = PUMP_SPEED;
  static CSS = `
    .slider { flex: 1; position: relative; border-radius: var(--feature-border-radius, 12px); overflow: hidden;
              background: var(--control-slider-background, var(--disabled-color, #9e9e9e)); }
    .slider::before { content: ""; position: absolute; inset: 0; background: currentColor; opacity: 0.2; }
    .fill { position: absolute; inset: 0; width: var(--fill, 0%); background: var(--feature-color, var(--tile-color, var(--primary-color)));
            opacity: 0.9; pointer-events: none; transition: width 80ms linear; }
    :host([off]) .fill { opacity: 0.35; }
    input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
    .val { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 6px;
           pointer-events: none; font-weight: 500; color: var(--primary-text-color); letter-spacing: 0.02em; }
    .val small { font-weight: 400; opacity: 0.7; }
    .min, .max { position: absolute; top: 50%; transform: translateY(-50%); font-size: 11px; opacity: 0.55; pointer-events: none; }
    .min { left: 10px; } .max { right: 10px; }
  `;

  static getStubConfig() {
    return { type: `custom:${PUMP_SPEED}` };
  }

  _renderKey() {
    const st = this.stateObj;
    if (this._dragging) return this._key; // never rebuild under the finger
    const { min, max } = speedRange(st);
    return JSON.stringify([st?.state, st?.attributes?.percentage, min, max, this._config.off_button]);
  }

  _draw(root) {
    const st = this.stateObj;
    const row = document.createElement("div");
    row.className = "row";
    if (!st) {
      root.append(row);
      return;
    }
    const { min, max } = speedRange(st);
    const on = st.state === "on";
    const pct = Number(st.attributes?.percentage);
    const value = on && Number.isFinite(pct) ? Math.min(max, Math.max(min, Math.round(pct))) : min;
    this.toggleAttribute("off", !on);

    if (this._config.off_button !== false) {
      const off = document.createElement("button");
      off.className = "off";
      off.type = "button";
      off.title = "Off";
      off.setAttribute("aria-label", "Pump off");
      off.append(this._svgPower());
      off.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._call("fan", "turn_off", {});
      });
      row.append(off);
    }

    const slider = document.createElement("div");
    slider.className = "slider";
    const fill = document.createElement("div");
    fill.className = "fill";
    const val = document.createElement("div");
    val.className = "val";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = String(value);
    input.setAttribute("aria-label", "Pump speed");
    input.setAttribute("aria-valuetext", on ? `${value}%` : "off");
    const lo = document.createElement("span");
    lo.className = "min";
    lo.textContent = `${min}`;
    const hi = document.createElement("span");
    hi.className = "max";
    hi.textContent = `${max}`;
    const show = (v, isOn) => {
      const f = max > min ? ((v - min) / (max - min)) * 100 : 100;
      slider.style.setProperty("--fill", `${isOn ? Math.max(6, f) : 0}%`);
      val.replaceChildren();
      val.append(isOn ? `${v} %` : "Off");
      if (isOn) {
        const s = document.createElement("small");
        s.textContent = "speed";
        val.append(s);
      }
    };
    show(value, on);
    input.addEventListener("pointerdown", () => {
      this._dragging = true;
    });
    input.addEventListener("input", () => show(Number(input.value), true));
    const commit = () => {
      this._dragging = false;
      this._key = null;
      this._call("fan", "set_percentage", { percentage: Number(input.value) });
    };
    input.addEventListener("change", commit);
    input.addEventListener("pointerup", () => {
      this._dragging = false;
    });
    input.addEventListener("pointercancel", () => {
      this._dragging = false;
    });
    input.addEventListener("click", (ev) => ev.stopPropagation());
    slider.append(fill, lo, hi, val, input);
    row.append(slider);
    root.append(row);
  }
}

/** A bar of colour swatches: tap one and the light takes that colour. */
export class LightColorsFeature extends Feature {
  static TYPE = LIGHT_COLORS;
  static CSS = `
    .bar { display: flex; gap: 6px; height: var(--feature-height, 42px); }
    .swatch { flex: 1; border-radius: var(--feature-border-radius, 12px); background: var(--c); position: relative;
              box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12); transition: transform 120ms ease, box-shadow 120ms ease; }
    .swatch:hover { transform: translateY(-1px); }
    .swatch[aria-pressed="true"] { box-shadow: inset 0 0 0 3px var(--card-background-color, #fff), inset 0 0 0 5px var(--c), 0 0 0 2px var(--c); }
    .swatch[aria-pressed="true"]::after { content: ""; position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; margin: -4px 0 0 -4px;
              border-radius: 50%; background: var(--card-background-color, #fff); }
    :host([off]) .swatch { opacity: 0.55; }
    :host([off]) .swatch[aria-pressed="true"] { opacity: 0.85; }
    .swatch.white { box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25); }
    .swatch.white[aria-pressed="true"] { box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25), inset 0 0 0 3px var(--card-background-color, #fff), inset 0 0 0 5px #9aa3a8, 0 0 0 2px #9aa3a8; }
    .swatch.white::after { background: #9aa3a8; }
  `;

  static getStubConfig() {
    return { type: `custom:${LIGHT_COLORS}` };
  }

  _renderKey() {
    const st = this.stateObj;
    return JSON.stringify([st?.state, st?.attributes?.effect, st?.attributes?.effect_list, this._config.effects]);
  }

  _draw(root) {
    const st = this.stateObj;
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Light colour");
    if (!st) {
      root.append(bar);
      return;
    }
    let { colors } = splitEffects(st.attributes?.effect_list);
    if (Array.isArray(this._config.effects)) {
      const want = new Set(this._config.effects);
      colors = colors.filter((c) => want.has(c.name));
    }
    const on = st.state === "on";
    const current = st.attributes?.effect;
    this.toggleAttribute("off", !on);
    for (const c of colors) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `swatch${isLight(c.hex) ? " white" : ""}`;
      b.style.setProperty("--c", c.hex);
      b.title = c.name;
      b.setAttribute("aria-label", c.name);
      b.setAttribute("aria-pressed", on && current === c.name ? "true" : "false");
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._call("light", "turn_on", { effect: c.name });
      });
      bar.append(b);
    }
    root.append(bar);
  }
}

/** A dropdown of the light shows. */
export class LightShowsFeature extends Feature {
  static TYPE = LIGHT_SHOWS;
  static CSS = `
    .wrap { position: relative; height: var(--feature-height, 42px); }
    select { appearance: none; -webkit-appearance: none; width: 100%; height: 100%; margin: 0; padding: 0 36px 0 14px;
             font: inherit; color: var(--primary-text-color); cursor: pointer;
             border: 0; border-radius: var(--feature-border-radius, 12px);
             background: var(--control-select-background, var(--disabled-color, #9e9e9e)); }
    .wrap::before { content: ""; position: absolute; inset: 0; border-radius: var(--feature-border-radius, 12px);
             background: var(--card-background-color, #fff); opacity: 0.8; pointer-events: none; }
    .wrap::after { content: ""; position: absolute; right: 14px; top: 50%; width: 8px; height: 8px; margin-top: -6px;
             border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg);
             opacity: 0.7; pointer-events: none; }
    select { position: relative; background: transparent; }
    select.active { font-weight: 600; }
  `;

  static getStubConfig() {
    return { type: `custom:${LIGHT_SHOWS}` };
  }

  _renderKey() {
    const st = this.stateObj;
    return JSON.stringify([st?.state, st?.attributes?.effect, st?.attributes?.effect_list, this._config.label]);
  }

  _draw(root) {
    const st = this.stateObj;
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    if (!st) {
      root.append(wrap);
      return;
    }
    const { shows } = splitEffects(st.attributes?.effect_list);
    const on = st.state === "on";
    const current = on ? st.attributes?.effect : null;
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Light show");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = this._config.label ?? "Light show";
    placeholder.disabled = true;
    select.append(placeholder);
    let active = false;
    for (const name of shows) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name.replace(/\s+Mode$/i, "");
      if (name === current) {
        o.selected = true;
        active = true;
      }
      select.append(o);
    }
    if (!active) placeholder.selected = true;
    select.classList.toggle("active", active);
    select.addEventListener("click", (ev) => ev.stopPropagation());
    select.addEventListener("change", () => {
      if (select.value) this._call("light", "turn_on", { effect: select.value });
    });
    wrap.append(select);
    root.append(wrap);
  }
}

function isLight(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = n >> 16;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 200;
}

const FEATURES = [
  { cls: PumpSpeedFeature, name: "Control Freak pump speed", isSupported: supportsPumpSpeed },
  { cls: LightColorsFeature, name: "Control Freak light colours", isSupported: supportsLightColors },
  { cls: LightShowsFeature, name: "Control Freak light shows", isSupported: supportsLightShows },
];

if (globalThis.customElements) {
  globalThis.customCardFeatures = globalThis.customCardFeatures || [];
  for (const { cls, name, isSupported } of FEATURES) {
    if (!customElements.get(cls.TYPE)) customElements.define(cls.TYPE, cls);
    if (!globalThis.customCardFeatures.some((f) => f.type === cls.TYPE)) {
      globalThis.customCardFeatures.push({ type: cls.TYPE, name, isSupported, configurable: false });
    }
  }
}
