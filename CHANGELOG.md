# Changelog

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
