# Changelog

## 0.3.0 — unreleased

- **Pool controls as tile features.** The pump tiles carry `custom:controlfreak-pump-speed`,
  a slider over the pump's real range (40–100 on a typical variable-speed pump) with an Off
  button; the pool's own pump sits first in the section, full width, right under the
  picture, with the pool's lights (their colour bars) right under it; the water readings
  are the next section, right of the pool. Colour lights carry
  `custom:controlfreak-light-colors` (a bar of swatches) and
  `custom:controlfreak-light-shows` (a dropdown of the shows) in place of one long effect
  dropdown. `controls: core` restores Home Assistant's `fan-speed` and `light-effect`.
  The features live in `controlfreak-features.js`, loaded beside the strategy.
- **The fan percentage is the pump's speed.** `fan.*` reports and takes the pump's own
  speed (0 off, else within its range), not a fraction of the range: a 40–100 pump reads
  40 at its floor where it used to read 1. The range is published as `speed_min` and
  `speed_max` attributes. A dashboard or automation that set `percentage: 1` to mean the
  floor still gets the floor; one that mapped the old 1–100 scale should send speeds now.
- **Control Freak's own icons.** A `cf:` icon set drawn for pool equipment, served and
  registered by the integration (`controlfreak-icons.js`): pump, spa jets, waterfall, deck
  jets, bubbler, cleaner, solar, pool and spa lights, outdoor lamp, heater, heat pump,
  chiller, valve, water and air thermometers, flow, controller, freeze, firmware, cpu, mode,
  speed, switch. Every entity picks its icon from its name in the panel, so every
  dashboard shows what a tile controls. The glyphs fill the icon box edge to edge, so they
  read larger than Material icons in the same tile.
- **Deck finishes.** The surround is a light concrete grey by default (the earlier deck
  was too dark); `picture_deck` on the strategy and `deck` on the picture card pick
  `pavers`, `travertine`, `wood` or `stone` instead. Every style draws the finish its own
  way, by day and by night.

- **The pool from above.** The pumps section opens with one animated overview of the whole
  pool: the water inside one of six outlines (`picture_shape`: rectangle, roman, kidney,
  freeform, lagoon, figure8), deck and coping around it, and the parts the controller runs
  in their places (attached spa with spillover, steps, tanning ledge with bubblers,
  waterfall over rocks, deck jets, lights), each following its own pump and light.
  `pictures: features` gives the per-feature pictures below instead. Shapes live in
  `controlfreak-pool-shapes.js`, imported by the card and served beside it.
- **Animated pictures per water feature** (`pictures: features`): a canvas picture per
  water feature the controller runs: pool, spa, waterfall, deck jets, bubblers. The water
  moves with the pump's speed (still when it is off), takes the colour of the matching
  light's effect (colour shows cycle), darkens with the Home Assistant dark theme, and the
  spa pours into the pool while the filter pump reports spillover. Pictures are chosen from
  the pump's name; cleaner, booster and solar pumps and unrecognised names get none.
  `pictures: false` on the dashboard, view or section strategy restores the 0.2.1 output
  exactly. Reduced motion gives a still frame; off-screen and hidden-tab pictures pause.
- New card `custom:controlfreak-picture` (`scene`, optional `pump`, `light`, `spillover`;
  scene `overview` takes `shape`, `pumps`, `lights`, `spillover`, `show`),
  served by the integration next to the strategy with the same version cache-buster, listed in
  the card picker. No dependencies, no dashboard resource to add.
- **Five picture styles.** `style` on the picture card and `picture_style` on the dashboard,
  view and section strategies pick the look: `caustic` (the default, unchanged), `blueprint`
  (flat plan view, ink lines, drifting rings), `depth` (refracted tile floor, glints, shadowed
  edges), `neon` (dark mirror lit only by the lights; day dims the glow) and `poster`
  (mid-century postcard, flat colours, paper grain). Every style draws all five scenes by day
  and by night from the same pump and light state. Left out, the output is unchanged. The
  styles live in `controlfreak-picture-styles.js`, imported by the card and served beside it.
- The effect-to-colour table lives once in `mapping.py` (`EFFECT_COLORS`; `DEFAULT_EFFECTS`
  derives from it) and is mirrored in the card; a test keeps the two identical.
- Tests: `node --test` for the card's pure helpers and the strategy's picture placement,
  including a byte-for-byte comparison with 0.2.1 dashboards; the Playwright render check
  draws every scene by day and by night and fails on any script error; `styles-day` and
  `styles-night` contact sheets (styles down, scenes across) are kept as workflow artifacts.

## 0.2.1 — 2026-10-24

Changes from the Home Assistant community store review (hacs/default#11967).

- **Removed the pump mode select.** Its spa and spillover commands were inferred, never
  captured from a real controller, so they are no longer sent to pool equipment. The
  current mode stays visible as a read-only sensor, and the dashboard shows it under each
  pump. The select comes back once the payloads are confirmed. A select left over from
  0.2.0 is removed from the entity registry on first start.
- **Entities keep their identity across restarts.** Stale entities are pruned only when
  their equipment's setting uuid is gone from `/device-settings`, whatever the platform.
  A relay recognized as a light only from its MQTT status stays a light after a restart,
  instead of being removed and recreated with its name, area and customizations lost.
- **Host field accepts a hostname or IPv4 address only.** A URL, port, path or
  credentials typed into it is refused before any request is made.

## 0.2.0 — 2026-10-13

- **Dashboard strategy** shipped inside the integration and loaded automatically:
  `strategy: { type: custom:controlfreak }` builds a dashboard with a section per
  equipment type the controller actually has (pumps, lights and relays, valves,
  temperature and flow, controller health). Unknown equipment goes to "Other
  equipment". Core cards only. Options: `hide`, `order`, `titles`, `device_id`.
  A section strategy (`equipment: <type>`) drops a single block into any
  sections view.
- Tiles show the entity's own name, without the device name in front. Found on a live
  Home Assistant 2026.9.3, where every tile read "Control Freak …".
- Equipment entities carry translation keys (`pump`, `light`, `relay`, `valve`,
  `temperature`, `flow`) so the dashboard groups them without entity ids. Names
  and entity ids don't change.
- Relays configured as a heater (gas heater, heat pump) or chiller get the
  `heater` / `chiller` translation key from their connection type, never their
  port, and their own "Heating and cooling" dashboard section.
- Brand icons redrawn from Control Freak's own vector mark: `icon.png` /
  `icon@2x.png` (dark outline) plus new `dark_icon.png` / `dark_icon@2x.png`
  (light outline) for dark themes.
- This is Control Freak's official integration: the earlier "unofficial / not
  affiliated" wording is gone from the README, docs and forum post.
- Documentation page `docs/controlfreak.md` in the Home Assistant integration
  page format; the README is shorter and links to it.
- Tests: `node --test` for the strategy against fixtures generated from the
  integration's own entities; a Playwright render harness. CI runs both suites.

## 0.1.1 — 2026-09-27

- Brand images shipped in-repo (`custom_components/controlfreak/brand/`): the Control
  Freak icon at 256 px and 512 px, served by Home Assistant 2026.3+ through the
  Brands Proxy API. `home-assistant/brands` no longer takes custom integrations.
- CI: the HACS action runs its brands check (no `ignore` key).
- Docs: submission guide updated; README shows the icon.

## 0.1.0 — 2026-09-27

First release (unofficial).

- Config flow: host, REST port (8000), MQTT WebSocket port (8080); validated with
  `GET /health` and one MQTT-over-WebSockets connect. Unique id from the panel's
  `/controller-config` uuid (falls back to the host). Options: discovery interval.
- Own MQTT-over-WebSockets client (aiomqtt), independent of HA's MQTT integration;
  reconnect with exponential backoff; connection loss marks entities unavailable.
- Equipment discovered from `GET /device-settings`; settings added or removed on the
  panel add or remove entities without a restart.
- Pump → fan (speed range from the pump's min/max), speed and mode sensors, mode select
  (shape inferred). Colour relays → light with effects learned from the panel. Plain
  relays → switch. Thermistors → °F temperature (stale after 180 s). Flow sensors →
  running binary sensor. Valves → read-only switch.
- Panel: connectivity (off after 300 s without `controller/status`), CPU temperature,
  freeze protection, firmware version.
- Diagnostics with host, wifi and AWS fields redacted.
