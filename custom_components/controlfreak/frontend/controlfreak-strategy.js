/**
 * Control Freak dashboard strategy (dashboard, view and section).
 *
 * Served by the integration and loaded on every frontend page, so nothing has
 * to be added as a dashboard resource. Usage:
 *
 *   strategy:
 *     type: custom:controlfreak        # whole dashboard
 *
 *   sections:
 *     - strategy:
 *         type: custom:controlfreak    # one section in an existing view
 *         equipment: pumps
 *         pictures: false              # tiles only, no animated pictures
 *         picture_shape: kidney        # the overview's outline (default freeform)
 *         picture_style: depth         # caustic (default), blueprint, depth, neon, poster
 *         picture_deck: pavers         # the surround: concrete (default), pavers, travertine, wood, stone
 *         controls: core               # Home Assistant's own tile features and the 0.2.1 layout
 *
 * Core cards are generated (heading, tile, markdown), plus the integration's
 * own picture card (custom:controlfreak-picture, served next to this file) at
 * the top of the pumps section: one overview of the whole pool from above,
 * with every water-moving pump and matching light the panel reports bound to
 * its part of the picture. `pictures: features` gives one picture per feature
 * instead; `pictures: false` leaves them out, which gives exactly the v0.2.1
 * output. `picture_shape` picks the overview's outline and `picture_style` one
 * of the card's five looks. Sections exist only for equipment the panel actually reports:
 * entities are found through hass.entities (platform "controlfreak") and
 * grouped by translation key, never by entity id. Anything this file does not
 * recognise lands in "Other equipment" rather than being dropped.
 *
 * The generator below is pure (plain objects in, plain objects out) and is
 * unit-tested with `node --test` against fixtures in tests/frontend/.
 */

export const PLATFORM = "controlfreak";

/** Equipment types, in default order. */
export const EQUIPMENT_TYPES = [
  "pumps",
  "heating",
  "lights",
  "valves",
  "sensors",
  "controller",
  "other",
];
/** The default layout: the water readings right of the pool. `controls: core` keeps the 0.2.1 order. */
export const DEFAULT_ORDER = ["pumps", "sensors", "heating", "lights", "valves", "controller", "other"];

export const DEFAULT_TITLES = {
  pumps: "Pumps",
  heating: "Heating and cooling",
  lights: "Lights and relays",
  valves: "Valves",
  sensors: "Temperature and flow",
  controller: "Controller health",
  other: "Other equipment",
};

const ICONS = {
  pumps: "mdi:pump",
  heating: "mdi:thermostat",
  lights: "mdi:lightbulb-group",
  valves: "mdi:valve",
  sensors: "mdi:thermometer-water",
  controller: "mdi:chip",
  other: "mdi:dots-horizontal-circle-outline",
};

// translation_key -> [equipment type, role]. Roles decide the card.
import { splitEffects } from "./controlfreak-features.js";

const KNOWN = {
  pump: ["pumps", "pump"],
  pump_speed: ["pumps", "redundant"], // shown on the pump tile already
  pump_mode: ["pumps", "mode"], // read-only: the mode command is not confirmed
  light: ["lights", "light"],
  relay: ["lights", "relay"],
  // Any relay the panel runs as a heater or chiller (its configured role,
  // never its port) gets its own section.
  heater: ["heating", "relay"],
  chiller: ["heating", "relay"],
  valve: ["valves", "valve"],
  temperature: ["sensors", "temperature"],
  flow: ["sensors", "flow"],
  pressure: ["sensors", "pressure"], // no entity yet; the panel publishes it
  connectivity: ["controller", "health"],
  freeze_protection: ["controller", "health"],
  cpu_temperature: ["controller", "health"],
  firmware: ["controller", "health"],
};

const CONTROLLER_ORDER = ["connectivity", "freeze_protection", "cpu_temperature", "firmware"];

export const PICTURE_CARD = "custom:controlfreak-picture";

/** Picture styles the card knows (see controlfreak-picture-styles.js). */
export const PICTURE_STYLES = ["caustic", "blueprint", "depth", "neon", "poster"];
/** Pool shapes the overview knows (see controlfreak-pool-shapes.js). */
export const PICTURE_SHAPES = ["rectangle", "roman", "kidney", "freeform", "lagoon", "figure8"];
/** The surround finishes (controlfreak-picture-styles.js DECKS), in order. */
export const PICTURE_DECKS = ["concrete", "pavers", "travertine", "wood", "stone"];
/** Tile features: Control Freak's own (default) or Home Assistant's core ones. */
export const CONTROLS = ["controlfreak", "core"];
export const PUMP_SPEED_FEATURE = "custom:controlfreak-pump-speed";
export const LIGHT_COLORS_FEATURE = "custom:controlfreak-light-colors";
export const LIGHT_SHOWS_FEATURE = "custom:controlfreak-light-shows";
const coreControls = (options) => options.controls === "core";

/** Picture scenes in display order. */
export const SCENES = ["pool", "spa", "falls", "deck", "bub"];

/**
 * Which picture a pump (or light) gets, from its own name, first match wins.
 * Cleaners, boosters and solar pumps move water nobody sees: no picture. A
 * name that matches nothing gets none either; the strategy never guesses.
 * Exported for tests.
 */
export const SCENE_RULES = [
  [/cleaner|booster|vacuum|sweep|solar|heat|chlor|salt/, null],
  [/bubbler|bubbles?\b/, "bub"],
  [/deck|laminar/, "deck"],
  [/waterfall|falls|sheer|cascade|fountain|scupper|curtain/, "falls"],
  [/jet|spa|hot tub/, "spa"],
  [/filter|circulat|main|pool/, "pool"],
];

export function sceneFor(name) {
  const lower = String(name ?? "").toLowerCase();
  for (const [pattern, scene] of SCENE_RULES) if (pattern.test(lower)) return scene;
  return null;
}

const FAN_SET_SPEED = 1;
const FAN_PRESET_MODE = 8;
const LIGHT_EFFECT = 4;

const domainOf = (entityId) => entityId.split(".", 1)[0];

const friendlyName = (hass, entityId) =>
  hass.states?.[entityId]?.attributes?.friendly_name ?? entityId;

/**
 * The tile name: the entity's own name without its device's name in front.
 * Entities use has_entity_name, so the friendly name starts with the device
 * name ("Control Freak Automated Pool System Pool Lights") and a narrow tile
 * would show nothing but that prefix. Exported for tests.
 */
export function shortName(hass, entityId) {
  const full = friendlyName(hass, entityId);
  const device = hass.devices?.[hass.entities?.[entityId]?.device_id];
  const prefix = device?.name_by_user || device?.name;
  if (!prefix || !full.startsWith(`${prefix} `)) return full;
  return full.slice(prefix.length + 1).trim() || full;
}

const supports = (hass, entityId, bit) =>
  ((hass.states?.[entityId]?.attributes?.supported_features ?? 0) & bit) !== 0;

const byName = (hass) => (a, b) =>
  friendlyName(hass, a.entity_id).localeCompare(friendlyName(hass, b.entity_id), undefined, {
    numeric: true,
  });

/**
 * Classify one registry display entry: which equipment type and which role.
 * Exported for tests.
 */
export function classify(entry) {
  const known = KNOWN[entry.translation_key];
  if (!known) return ["other", "other"];
  const [type, role] = known;
  // A future native valve entity (domain "valve") gets open/close controls.
  if (role === "valve" && domainOf(entry.entity_id) === "valve") return [type, "native_valve"];
  return known;
}

/** Every visible Control Freak entity, optionally limited to one device. */
export function findEntities(hass, options = {}) {
  return Object.values(hass.entities ?? {}).filter(
    (e) =>
      e.platform === PLATFORM &&
      !e.hidden &&
      hass.states?.[e.entity_id] !== undefined &&
      (!options.device_id || e.device_id === options.device_id)
  );
}

/** Group entries by equipment type: { pumps: [{entry, role}], ... }. */
export function groupEntities(entries) {
  const groups = {};
  for (const entry of entries) {
    const [type, role] = classify(entry);
    (groups[type] ??= []).push({ entry, role });
  }
  return groups;
}

const tile = (entityId, features) => {
  const card = { type: "tile", entity: entityId };
  if (features?.length) {
    card.features = features;
    card.features_position = "bottom";
  }
  return card;
};

/**
 * A pump's mode sensor is named "<pump name> current mode": pair it by longest
 * matching name prefix so it sits right under its own pump. Returns the sorted
 * pumps, a Map pump id -> [mode entries] and the modes that matched no pump.
 */
function pairModes(hass, items) {
  const pumps = items.filter((i) => i.role === "pump").map((i) => i.entry);
  const modes = items.filter((i) => i.role === "mode").map((i) => i.entry);
  pumps.sort(byName(hass));
  const paired = new Map(pumps.map((p) => [p.entity_id, []]));
  const unpaired = [];
  for (const mode of modes) {
    const name = friendlyName(hass, mode.entity_id);
    let best = null;
    for (const pump of pumps) {
      const pumpName = friendlyName(hass, pump.entity_id);
      if (name.startsWith(pumpName) && (!best || pumpName.length > best.length)) {
        best = { id: pump.entity_id, length: pumpName.length };
      }
    }
    if (best) paired.get(best.id).push(mode);
    else unpaired.push(mode);
  }
  return { pumps, paired, unpaired };
}

/**
 * One animated picture per water-moving pump, in scene order: the filter pump
 * is the pool, the spa jets the spa, and so on (see SCENE_RULES). Each picture
 * binds the first light whose name points at the same scene, and the spa
 * picture the pool pump's mode sensor, so a spillover pours into the pool.
 * Exported for tests.
 */
export function pictureCards(hass, items, options = {}) {
  const bound = bindPictures(hass, items, options);
  if (options.pictures === "features") return featureCards(bound, options);
  return overviewCard(bound, options);
}

/** Pump, light and spillover sensor per scene, from names. Exported for tests. */
export function bindPictures(hass, items, options = {}) {
  const { pumps, paired } = pairModes(hass, items);
  const pumpFor = {};
  for (const pump of pumps) {
    const scene = sceneFor(shortName(hass, pump.entity_id));
    if (scene && !pumpFor[scene]) pumpFor[scene] = pump;
  }
  const lights = findEntities(hass, options)
    .filter((e) => classify(e)[1] === "light" && domainOf(e.entity_id) === "light")
    .sort(byName(hass));
  const lightFor = {};
  for (const light of lights) {
    const scene = sceneFor(shortName(hass, light.entity_id));
    if (scene && !lightFor[scene]) lightFor[scene] = light;
  }
  const poolModes = pumpFor.pool ? paired.get(pumpFor.pool.entity_id) : [];
  return { pumpFor, lightFor, spillover: poolModes.length ? poolModes[0].entity_id : null };
}

/** One picture per water-moving pump, in scene order (the 0.3.0 layout). */
function featureCards({ pumpFor, lightFor, spillover }, options) {
  const cards = [];
  for (const scene of SCENES) {
    const pump = pumpFor[scene];
    if (!pump) continue;
    const card = { type: PICTURE_CARD, scene, pump: pump.entity_id };
    if (options.picture_style != null) card.style = options.picture_style;
    if (options.picture_deck != null) card.deck = options.picture_deck;
    if (lightFor[scene]) card.light = lightFor[scene].entity_id;
    if (scene === "spa" && spillover) card.spillover = spillover;
    card.grid_options = { columns: "full" };
    cards.push(card);
  }
  return cards;
}

/** One overview of the whole pool, every bound pump and light in its place. */
function overviewCard({ pumpFor, lightFor, spillover }, options) {
  const pumps = {};
  const lights = {};
  for (const scene of SCENES) {
    if (pumpFor[scene]) pumps[scene] = pumpFor[scene].entity_id;
    if (lightFor[scene]) lights[scene] = lightFor[scene].entity_id;
  }
  if (!Object.keys(pumps).length) return [];
  const card = { type: PICTURE_CARD, scene: "overview" };
  if (options.picture_shape != null) card.shape = options.picture_shape;
  if (options.picture_style != null) card.style = options.picture_style;
  if (options.picture_deck != null) card.deck = options.picture_deck;
  card.pumps = pumps;
  if (Object.keys(lights).length) card.lights = lights;
  if (pumps.spa && spillover) card.spillover = spillover;
  card.grid_options = { columns: "full" };
  return [card];
}

function pumpCards(hass, items, options = {}) {
  const { pumps, paired, unpaired } = pairModes(hass, items);
  const core = coreControls(options);
  const cards = [];
  let poolPlaced = false;
  for (const pump of pumps) {
    const features = [];
    if (supports(hass, pump.entity_id, FAN_SET_SPEED)) {
      features.push(core ? { type: "fan-speed" } : { type: PUMP_SPEED_FEATURE });
    }
    const presets = hass.states[pump.entity_id]?.attributes?.preset_modes;
    if (supports(hass, pump.entity_id, FAN_PRESET_MODE) && presets?.length) {
      features.push({ type: "fan-preset-modes", style: "icons" });
    }
    const group = [tile(pump.entity_id, features), ...paired.get(pump.entity_id).map((m) => tile(m.entity_id))];
    // The pool's own pump goes first, full width: its speed sits right under the
    // picture, and the pool's lights (their colour bars) right under that.
    if (!core && !poolPlaced && features.length && sceneFor(shortName(hass, pump.entity_id)) === "pool") {
      group[0].grid_options = { columns: "full" };
      const lights = poolLights(hass, options).map((id) => {
        const t = lightTile(hass, id, options);
        t.grid_options = { columns: "full" };
        return t;
      });
      cards.unshift(...group, ...lights);
      poolPlaced = true;
    } else {
      cards.push(...group);
    }
  }
  for (const mode of unpaired.sort(byName(hass))) cards.push(tile(mode.entity_id));
  return cards;
}

function lightTile(hass, entityId, options = {}) {
  if (domainOf(entityId) !== "light" || !supports(hass, entityId, LIGHT_EFFECT)) {
    return tile(entityId, domainOf(entityId) === "switch" ? [{ type: "toggle" }] : []);
  }
  if (coreControls(options)) return tile(entityId, [{ type: "light-effect" }]);
  // The colours as a bar of swatches, the shows as a dropdown; the core
  // dropdown only when the light's effects are not known yet.
  const { colors, shows } = splitEffects(hass.states[entityId]?.attributes?.effect_list);
  const features = [];
  if (colors.length) features.push({ type: LIGHT_COLORS_FEATURE });
  if (shows.length) features.push({ type: LIGHT_SHOWS_FEATURE });
  return tile(entityId, features.length ? features : [{ type: "light-effect" }]);
}

/**
 * The lights that light the picture (pool, spa, falls), in that order. With
 * the default controls they sit under the pool's pump in the pumps section,
 * their colour bars right under the picture, and leave the lights section.
 */
export function poolLights(hass, options = {}) {
  if (coreControls(options)) return [];
  const pumps = groupEntities(findEntities(hass, options)).pumps ?? [];
  const { pumpFor, lightFor } = bindPictures(hass, pumps, options);
  // Only when there is a pool pump with a speed slider for them to sit under;
  // a lighting-only panel keeps its lights in the lights section.
  if (!pumpFor.pool || !supports(hass, pumpFor.pool.entity_id, FAN_SET_SPEED)) return [];
  const ids = [];
  for (const scene of ["pool", "spa", "falls", "deck", "bub"]) {
    const light = lightFor[scene];
    if (light && !ids.includes(light.entity_id)) ids.push(light.entity_id);
  }
  return ids;
}

function lightCards(hass, items, options = {}) {
  const moved = new Set(poolLights(hass, options));
  return items
    .map((i) => i.entry)
    .filter((e) => !moved.has(e.entity_id))
    .sort(byName(hass))
    .map((e) => lightTile(hass, e.entity_id, options));
}

function valveCards(hass, items) {
  return items
    .slice()
    .sort((a, b) => byName(hass)(a.entry, b.entry))
    .map(({ entry, role }) =>
      role === "native_valve"
        ? tile(entry.entity_id, [{ type: "valve-open-close" }])
        : // Valves are read-only switches today: show state, open more-info.
          { ...tile(entry.entity_id), icon_tap_action: { action: "more-info" } }
    );
}

function sensorCards(hass, items) {
  const temps = items.filter((i) => i.role === "temperature").map((i) => i.entry);
  const flows = items.filter((i) => i.role === "flow").map((i) => i.entry);
  const pressures = items.filter((i) => i.role === "pressure").map((i) => i.entry);
  return [
    ...temps.sort(byName(hass)).map((e) => tile(e.entity_id, [{ type: "trend-graph" }])),
    ...pressures.sort(byName(hass)).map((e) => tile(e.entity_id, [{ type: "trend-graph" }])),
    ...flows.sort(byName(hass)).map((e) => tile(e.entity_id)),
  ];
}

function controllerCards(hass, items) {
  const rank = (e) => {
    const i = CONTROLLER_ORDER.indexOf(e.translation_key);
    return i < 0 ? CONTROLLER_ORDER.length : i;
  };
  return items
    .map((i) => i.entry)
    .sort((a, b) => rank(a) - rank(b) || byName(hass)(a, b))
    .map((e) => tile(e.entity_id));
}

function otherCards(hass, items) {
  return items
    .map((i) => i.entry)
    .sort(byName(hass))
    .map((e) => tile(e.entity_id));
}

const CARD_BUILDERS = {
  pumps: pumpCards,
  heating: lightCards, // heaters and chillers: tile + toggle
  lights: lightCards,
  valves: valveCards,
  sensors: sensorCards,
  controller: controllerCards,
  other: otherCards,
};

const titleFor = (type, options) =>
  options.title ?? options.titles?.[type] ?? DEFAULT_TITLES[type] ?? type;

/** One grid section for one equipment type, or null when there is nothing. */
export function buildSection(hass, type, options = {}) {
  if (!CARD_BUILDERS[type]) {
    throw new Error(
      `Unknown Control Freak equipment type "${type}". Use one of: ${EQUIPMENT_TYPES.join(", ")}`
    );
  }
  if (options.controls != null && !CONTROLS.includes(options.controls)) {
    throw new Error(`Control Freak "controls" is "controlfreak" (default) or "core", not "${options.controls}"`);
  }
  const items = groupEntities(findEntities(hass, options))[type] ?? [];
  const cards = CARD_BUILDERS[type](hass, items, options);
  if (!cards.length) return null;
  if (type === "pumps" && options.pictures !== false) {
    if (options.picture_deck != null && !PICTURE_DECKS.includes(options.picture_deck)) {
      throw new Error(
        `Unknown Control Freak picture_deck "${options.picture_deck}". Use one of: ${PICTURE_DECKS.join(", ")}`
      );
    }
    if (options.picture_style != null && !PICTURE_STYLES.includes(options.picture_style)) {
      throw new Error(
        `Unknown Control Freak picture_style "${options.picture_style}". Use one of: ${PICTURE_STYLES.join(", ")}`
      );
    }
    if (options.picture_shape != null && !PICTURE_SHAPES.includes(options.picture_shape)) {
      throw new Error(
        `Unknown Control Freak picture_shape "${options.picture_shape}". Use one of: ${PICTURE_SHAPES.join(", ")}`
      );
    }
    if (![undefined, true, "features"].includes(options.pictures)) {
      throw new Error(`Control Freak "pictures" is true, false or "features", not "${options.pictures}"`);
    }
    cards.unshift(...pictureCards(hass, items, options));
  }
  for (const card of cards) {
    if (!card.entity) continue; // picture cards carry no entity of their own
    const name = shortName(hass, card.entity);
    if (name !== friendlyName(hass, card.entity)) card.name = name;
  }
  return {
    type: "grid",
    cards: [
      { type: "heading", heading: titleFor(type, options), heading_style: "title", icon: ICONS[type] },
      ...cards,
    ],
  };
}

/** The ordered list of equipment types to render, honouring hide/order. */
export function sectionOrder(options = {}) {
  const hide = new Set(options.hide ?? []);
  const order = [...(options.order ?? [])];
  for (const type of coreControls(options) ? EQUIPMENT_TYPES : DEFAULT_ORDER) if (!order.includes(type)) order.push(type);
  return order.filter((type, i) => !hide.has(type) && order.indexOf(type) === i && CARD_BUILDERS[type]);
}

/** Every section for the panel's equipment, in order. Pure. */
export function buildSections(hass, options = {}) {
  const sectionOptions = {
    titles: options.titles,
    device_id: options.device_id,
    pictures: options.pictures,
    picture_style: options.picture_style,
    picture_shape: options.picture_shape,
    picture_deck: options.picture_deck,
    controls: options.controls,
  };
  return sectionOrder(options)
    .map((type) => buildSection(hass, type, sectionOptions))
    .filter(Boolean);
}

export const EMPTY_SECTION = {
  type: "grid",
  cards: [
    {
      type: "markdown",
      content:
        "**No Control Freak equipment found.**\n\n" +
        "Add the Control Freak integration under **Settings → Devices & services**, " +
        "then reload this dashboard.",
    },
  ],
};

/** The view: a sections view with one section per equipment type. Pure. */
export function buildView(hass, options = {}) {
  const sections = buildSections(hass, options);
  return {
    type: "sections",
    title: options.view_title ?? "Pool",
    path: options.path ?? "pool",
    icon: "mdi:pool",
    max_columns: options.max_columns ?? 4,
    sections: sections.length ? sections : [EMPTY_SECTION],
  };
}

/** The dashboard: one view. Pure. */
export function buildDashboard(hass, options = {}) {
  return { title: options.title ?? "Pool", views: [buildView(hass, options)] };
}

/* ----- Custom elements (browser only) ------------------------------------ */

const Base = globalThis.HTMLElement ?? class {};
// Regenerate only when the entity registry changes (equipment added/removed).
const DEPENDENCIES = ["entities"];

export class ControlFreakDashboardStrategy extends Base {
  static registryDependencies = DEPENDENCIES;

  static getCreateSuggestions() {
    return { title: "Pool", icon: "mdi:pool" };
  }

  static async generate(config, hass) {
    return buildDashboard(hass, config);
  }
}

export class ControlFreakViewStrategy extends Base {
  static registryDependencies = DEPENDENCIES;

  static async generate(config, hass) {
    return buildView(hass, config);
  }
}

export class ControlFreakSectionStrategy extends Base {
  static registryDependencies = DEPENDENCIES;

  static async generate(config, hass) {
    if (!config.equipment) {
      throw new Error(`Set "equipment" to one of: ${EQUIPMENT_TYPES.join(", ")}`);
    }
    return (
      buildSection(hass, config.equipment, config) ?? {
        type: "grid",
        cards: [
          {
            type: "markdown",
            content: `No Control Freak equipment of type **${config.equipment}** found.`,
          },
        ],
      }
    );
  }
}

if (globalThis.customElements) {
  const define = (tag, cls) => {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  };
  define("ll-strategy-dashboard-controlfreak", ControlFreakDashboardStrategy);
  define("ll-strategy-view-controlfreak", ControlFreakViewStrategy);
  define("ll-strategy-section-controlfreak", ControlFreakSectionStrategy);

  globalThis.customStrategies = globalThis.customStrategies || [];
  if (!globalThis.customStrategies.some((s) => s.type === "controlfreak")) {
    globalThis.customStrategies.push({
      type: "controlfreak",
      strategyType: "dashboard",
      name: "Control Freak pool",
      description: "Pumps, lights, valves and sensors from your Control Freak panel.",
      documentationURL:
        "https://github.com/Jimmyneox/ha-controlfreak/blob/main/docs/controlfreak.md",
    });
  }
}
