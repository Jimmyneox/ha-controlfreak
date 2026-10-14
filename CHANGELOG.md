# Changelog

## 0.2.0 — 2026-10-13

- **Dashboard strategy** shipped inside the integration and loaded automatically:
  `strategy: { type: custom:controlfreak }` builds a dashboard with a section per
  equipment type the controller actually has (pumps, lights and relays, valves,
  temperature and flow, controller health). Unknown equipment goes to "Other
  equipment". Core cards only. Options: `hide`, `order`, `titles`, `device_id`.
  A section strategy (`equipment: <type>`) drops a single block into any
  sections view.
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
