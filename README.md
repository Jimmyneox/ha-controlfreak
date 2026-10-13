# Control Freak Automated Pool System for Home Assistant

<img src="custom_components/controlfreak/brand/icon.png" alt="Control Freak" width="96" align="right">

**Unofficial. Not affiliated with, endorsed by, or supported by Control Freak Pool Tech.**
"Control Freak" is used here only to name the hardware this works with.

A local-only Home Assistant integration for the [Control Freak](https://controlfreakpool.com)
pool controller. It reads the
controller's REST API for the equipment you've configured and listens to its MQTT broker over
WebSockets for live values. No cloud, and your own MQTT setup is unaffected.

- **Equipment-driven entities:** pumps (fan with speed, mode select), heaters and chillers,
  color lights with effects, relays, valves (read-only), temperatures, flow and controller
  health, all under the names you gave them in the Control Freak app. Add or remove
  equipment in the Control Freak app and Home Assistant follows without a restart.
- **A dashboard that builds itself:** `strategy: { type: custom:controlfreak }` creates a
  dashboard with a section per equipment type you actually have, using only built-in cards.
  Single sections drop into an existing dashboard.

![Generated dashboard](docs/images/dashboard-full-pool.png)

## Install

1. In HACS, open the three dots menu > **Custom repositories**, add
   `https://github.com/Jimmyneox/ha-controlfreak` with type **Integration**.
2. Install **Control Freak Automated Pool System** and restart Home Assistant.
3. Go to **Settings** > **Devices & services** > **Add integration** and select **Control
   Freak Automated Pool System**.

Manual install: copy `custom_components/controlfreak` into your `config/custom_components/`.

## Documentation

Setup, every entity, the dashboard options, data updates, known limitations and
troubleshooting: **[docs/controlfreak.md](docs/controlfreak.md)**.

## Development

```sh
uv venv -p 3.14 && uv pip install -r requirements_test.txt
uv run --no-project pytest -q
uv run --no-project ruff check .
node --test tests/frontend/*.test.mjs
```

The Python tests run against real, scrubbed responses from a controller
(`tests/fixtures/`). The dashboard tests run the strategy against hass stubs that
`tests/test_frontend.py` generates from the integration's own entities
(`UPDATE_DASHBOARD_FIXTURES=1` regenerates them). To see the render check, serve the
repository root (`python3 -m http.server`) and open
`tests/frontend/harness.html?shape=full-pool`.

## License

MIT
