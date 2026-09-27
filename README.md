# Control Freak for Home Assistant

**Unofficial. Not affiliated with, endorsed by, or supported by Control Freak Pool Tech.**
"Control Freak" is used here only to name the hardware this works with.

A local-only Home Assistant integration for the Control Freak pool controller panel.
It reads the panel's own REST API for the equipment you've configured and listens to
the panel's MQTT broker for live values. It works without the cloud and doesn't use
Home Assistant's MQTT integration, so your own Mosquitto setup is unaffected.

## What your panel must expose

Tested against panel API **v1.0.13** (the `/health` version).

| Service | Default | Used for |
|---|---|---|
| REST API (FastAPI, `/docs`) | `http://<panel>:8000` | `GET /health`, `/controller-config` (panel id only), `/device-settings`, `/pump-models` |
| Mosquitto over **WebSockets** | `ws://<panel>:8080/` | subscribe `controller/#`, publish commands |

The broker must accept anonymous WebSocket clients on path `/`. That's how the panel
ships. Plain MQTT on TCP 1883 isn't used. The integration only sends GET requests to
the REST API and never changes the panel's configuration.

## Install (HACS custom repository)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/Jimmyneox/ha-controlfreak`,
   category **Integration**.
2. Install **Control Freak**, then restart Home Assistant.
3. **Settings → Devices & services → Add integration → Control Freak**, and enter the
   panel's IP address or hostname. Leave the ports at 8000 / 8080 unless you've changed them.

Manual install: copy `custom_components/controlfreak` into your `config/custom_components/`.

## What you get

A single device, **Control Freak**. Its entities come from whatever equipment is
configured on the panel. If you add or remove equipment in the vendor app, the entities
follow at the next discovery poll (60 s by default, adjustable under Options) without a
restart.

| Panel equipment (`device_type`) | Entity | Command published (`controller/<port>/state`) |
|---|---|---|
| Pump | `fan` (on/off + %; HA 1 % = the pump's minimum speed), `sensor` speed %, `sensor` mode | `{"pump_speed":"<n>\|inactive","mode":"pool","sender":"user"}` |
| Pump (modes enabled) | `select` mode — only the pool/spa/spillover modes the pump enables | same payload, `"mode":"<mode>"` — **shape inferred** |
| HighVoltage / LowVoltage relay with colour lights | `light` with effects (learned from the panel's light type; defaults to the 12 Pentair names) | `{"state":"active\|inactive","mode":"not-syncing"[,"color_choice":"<effect>"],"sender":"user"}` |
| Other relays (heaters, general) | `switch` | `{"state":"active\|inactive","mode":"not-syncing","sender":"user"}` |
| Thermositor (sic) | `sensor` temperature °F (unavailable when inactive, or after 180 s without an update) | — |
| FlowSensor | `binary_sensor` running | — |
| Valve | `switch`, **read-only** | none (see below) |
| Panel | `binary_sensor` connectivity (off after 300 s without `controller/status`), CPU temperature, freeze protection, firmware version | — |

If the connection to the broker drops, every MQTT-fed entity goes unavailable.
Reconnects use exponential backoff, up to 60 s.

## What's verified and what isn't

- **Captured from the vendor app:** the status topics and payloads, the pump speed
  command, and the relay/light command with `color_choice`.
- **Inferred:** the pump **mode select** command. It reuses the captured pump payload
  with a different `"mode"`, but only `"pool"` was ever seen on the wire.
- **Not supported yet:** **valve commands.** Nobody has captured the command shape, so
  valves are shown read-only and won't be guessed at. If you have valves, please capture
  what the app publishes when you move one (subscribe `controller/#` on `ws://<panel>:8080/`)
  and open an issue.
- Heater set-points, schedules, themes and tethering aren't exposed. They're panel
  configuration, and this integration never writes configuration.
- Only one panel (API v1.0.13, a Fairland VS pump, Pentair lights and two thermistors)
  has been tested live.

## Privacy

All traffic stays on your LAN, and nothing touches the vendor's AWS IoT path. Diagnostics
downloads redact the host plus any wifi and AWS fields.

## Development

```sh
uv venv && uv pip install -r requirements_test.txt
uv run --no-project pytest -q
uv run --no-project ruff check .
```

The unit tests run against real, scrubbed responses from a panel (`tests/fixtures/`).

## License

MIT
