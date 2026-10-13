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
 *
 * Only core cards are generated (heading, tile, markdown). Sections exist only
 * for equipment the panel actually reports: entities are found through
 * hass.entities (platform "controlfreak") and grouped by translation key, never
 * by entity id. Anything this file does not recognise lands in "Other
 * equipment" rather than being dropped.
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
const KNOWN = {
  pump: ["pumps", "pump"],
  pump_mode_select: ["pumps", "mode_select"],
  pump_speed: ["pumps", "redundant"], // shown on the pump tile already
  pump_mode: ["pumps", "redundant"], // shown by the mode select already
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

const FAN_SET_SPEED = 1;
const FAN_PRESET_MODE = 8;
const LIGHT_EFFECT = 4;

const domainOf = (entityId) => entityId.split(".", 1)[0];

const friendlyName = (hass, entityId) =>
  hass.states?.[entityId]?.attributes?.friendly_name ?? entityId;

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

function pumpCards(hass, items) {
  const pumps = items.filter((i) => i.role === "pump").map((i) => i.entry);
  const selects = items.filter((i) => i.role === "mode_select").map((i) => i.entry);
  pumps.sort(byName(hass));
  // A pump's mode select is named "<pump name> mode": pair it by longest
  // matching name prefix so the select sits right under its own pump.
  const paired = new Map(pumps.map((p) => [p.entity_id, []]));
  const unpaired = [];
  for (const select of selects) {
    const name = friendlyName(hass, select.entity_id);
    let best = null;
    for (const pump of pumps) {
      const pumpName = friendlyName(hass, pump.entity_id);
      if (name.startsWith(pumpName) && (!best || pumpName.length > best.length)) {
        best = { id: pump.entity_id, length: pumpName.length };
      }
    }
    if (best) paired.get(best.id).push(select);
    else unpaired.push(select);
  }
  const cards = [];
  for (const pump of pumps) {
    const features = [];
    if (supports(hass, pump.entity_id, FAN_SET_SPEED)) features.push({ type: "fan-speed" });
    const presets = hass.states[pump.entity_id]?.attributes?.preset_modes;
    if (supports(hass, pump.entity_id, FAN_PRESET_MODE) && presets?.length) {
      features.push({ type: "fan-preset-modes", style: "icons" });
    }
    cards.push(tile(pump.entity_id, features));
    for (const select of paired.get(pump.entity_id)) {
      cards.push(tile(select.entity_id, [{ type: "select-options", style: "buttons" }]));
    }
  }
  for (const select of unpaired.sort(byName(hass))) {
    cards.push(tile(select.entity_id, [{ type: "select-options", style: "buttons" }]));
  }
  return cards;
}

function lightCards(hass, items) {
  return items
    .map((i) => i.entry)
    .sort(byName(hass))
    .map((e) =>
      domainOf(e.entity_id) === "light" && supports(hass, e.entity_id, LIGHT_EFFECT)
        ? tile(e.entity_id, [{ type: "light-effect" }])
        : tile(e.entity_id, domainOf(e.entity_id) === "switch" ? [{ type: "toggle" }] : [])
    );
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
  const items = groupEntities(findEntities(hass, options))[type] ?? [];
  const cards = CARD_BUILDERS[type](hass, items);
  if (!cards.length) return null;
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
  for (const type of EQUIPMENT_TYPES) if (!order.includes(type)) order.push(type);
  return order.filter((type, i) => !hide.has(type) && order.indexOf(type) === i && CARD_BUILDERS[type]);
}

/** Every section for the panel's equipment, in order. Pure. */
export function buildSections(hass, options = {}) {
  const sectionOptions = { titles: options.titles, device_id: options.device_id };
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
