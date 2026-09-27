# CF1 — `controlfreak`: a HACS custom integration for the Control Freak pool controller

**Model:** Opus. **Repo:** this directory (`/Users/jimmy/ha-controlfreak`), a NEW public-to-be
repository, MIT. Branch `main`. Nothing here is Jarvis-V2.

## WHY
The owner's Control Freak pool panel (Raspberry Pi, "ControlFreak" API v1.0.13, made by Control
Freak Pool Tech) exposes a LOCAL REST API on port 8000 (FastAPI, `/docs`, `/openapi.json`) and an
open Mosquitto broker over **WebSockets on port 8080** (no TCP 1883, no auth, ws path `/`).
Today it is integrated by hand-written MQTT YAML (`tests/fixtures/control_freak.yaml` is that
package, read it first — every wire shape in it was CAPTURED from the vendor app, not guessed).
That YAML cannot be shared: it hard-codes one owner's port map, and HA's MQTT integration talks to
ONE broker, so anyone with their own Mosquitto cannot point HA at the panel. The community needs an
integration that: has its own MQTT-over-WebSockets client, discovers the owner's configured
equipment from the REST API, and makes entities from it. No such integration exists (searched
2026-09-27).

## BUILD
1. **Layout, HACS-ready:** `custom_components/controlfreak/` (`__init__.py`, `manifest.json`
   with `domain controlfreak`, `iot_class local_push`, `config_flow true`, `version`, `codeowners`,
   `documentation`, `issue_tracker`, `requirements`), `hacs.json` (`name`, `render_readme true`,
   `homeassistant` min version), `README.md` (install via HACS custom repo, what the panel must
   expose, what is unverified, "unofficial — not affiliated with Control Freak Pool Tech"),
   `LICENSE` (MIT), `.github/workflows/validate.yml` running **hassfest** and **HACS action**,
   `pyproject.toml` / `requirements_test.txt`, `strings.json` + `translations/en.json`,
   `CHANGELOG.md`, `.gitignore`. Use the CURRENT HA developer docs (context7 `home-assistant/developers.home-assistant`, or fetch) for the config-flow, coordinator and entity APIs — not memory.
2. **Config flow:** user step asks host (required), REST port (default 8000), MQTT WS port (default
   8080). Validate with `GET /health` (expects `{"name":"ControlFreak","status":"healthy","version"}`)
   AND one MQTT-WS connect. Unique id: read `GET /controller-config` for a stable id if one exists
   (do not log its wifi/aws fields); else the host. Reauth not needed (no auth). Options flow:
   REST poll interval (default 60 s). `async_setup_entry` → one `ControlFreakCoordinator`.
3. **Transport:** the integration owns its OWN MQTT-over-WebSockets client — it must NOT depend on
   HA's `mqtt` integration. `requirements` must not pin `paho-mqtt` to a version that conflicts with
   HA core's pin (check core's `homeassistant/components/mqtt/manifest.json` at the HA version you
   target; `paho-mqtt` 2.x). aiomqtt over paho with `transport="websockets"` is acceptable if its pin
   is compatible; otherwise paho in an executor thread. Reconnect with backoff; connection loss
   marks entities unavailable. Subscribe `controller/#`.
4. **Discovery (REST, polled, default 60 s):** `GET /device-settings` is the equipment list. For each
   setting: `name`, `device_type.name` ∈ {Pump, HighVoltage, LowVoltage, Thermositor (sic), FlowSensor,
   Valve}, `topic.mqtt_topic` (e.g. `controller/pump1/` → status `controller/pump1/status`, command
   `controller/pump1/state`), `connection_type` (heater kinds etc., see `connection-types.json`),
   pump fields (`pump_speed_minimum/maximum`, `pool_mode/spa_mode/spillover_mode`, `pump_model_uuid`
   → `pump-models.json`), `last_known_*`. A setting that appears/disappears adds/removes entities
   without a restart (coordinator diff, `async_remove` stale). Fixtures: every `tests/fixtures/*.json`
   is a REAL scrubbed response from the owner's panel — build the unit tests on them.
5. **Entities (one HA device per panel, `manufacturer "Control Freak Pool Tech"`, `sw_version` from
   /health, `configuration_url` `http://<host>:8000/docs`):**
   - Pump → `fan` (on/off + percentage; `speed_range` = the setting's min/max; command
     `{"pump_speed":"<n>|inactive","mode":"pool","sender":"user"}`; state from
     `meta.pump_speed`), plus `sensor` speed (%) and `sensor` mode (`meta.mode`), and a `select`
     for mode ONLY over the modes the setting enables (pool/spa/spillover flags) — the select's
     command shape is `"mode":"<mode>"` in the same payload; mark it "shape inferred" in README.
   - HighVoltage / LowVoltage relay → `light` when the status carries a colour (`meta.color_choice`
     / `meta.last_known_state` is a colour name, or `last_known_state` in device-settings is one)
     with `effect_list` learned from the panel where possible (the 12 names in the YAML are the
     Pentair set — ship them as the default list) and `effect` support; otherwise `switch`.
     Command `{"state":"active|inactive","mode":"not-syncing","sender":"user"}` (+`"color_choice"`
     for an effect); state `meta.relay_state == 1`.
   - Thermositor → `sensor` temperature (`meta.temperature_f`, °F, `device_class temperature`,
     unavailable when `status != "active"`; `expire_after`-equivalent: stale after 3 missed
     ~2 s publishes → 180 s).
   - FlowSensor → `binary_sensor` running (`meta.active_flow`).
   - Valve → `switch`, **READ-ONLY in v1** (the command shape was never captured — do not guess;
     README says so and invites a capture).
   - Panel: `binary_sensor` connectivity from `controller/status` (`status == "active"`, stale after
     300 s — the panel has no LWT), diagnostic `sensor` CPU temperature (`meta.cpuTemperature`),
     `sensor` freeze protection (`controller/freeze-protection/status` → `status`), `sensor`
     firmware version.
   - Entity naming: HA's `has_entity_name` with the setting's name; unique ids
     `<entry_id>_<device_setting uuid>[_<suffix>]` — never the host.
6. **Diagnostics:** `diagnostics.py` redacting host and any wifi/aws field.
7. **Tests:** `pytest` + `pytest-homeassistant-custom-component`: config flow (success, bad host,
   already configured), coordinator mapping from the fixtures (4 settings → the exact entity set:
   1 fan, 1 light, 2 temperature sensors, plus the panel entities; 0 valves), a status message
   updates the right entity, a removed setting removes its entities, stale → unavailable, the fan
   percentage maps through min 40. RED first (write the mapping test before the mapper).
8. **Community submission kit** (files only, nothing pushed): `docs/SUBMISSION.md` with the exact
   steps — GitHub repo public + topics `home-assistant`, `hacs`, `pool`; a `v0.1.0` tag/release;
   the HACS default-repository PR (`hacs/default`, `integration` file) prerequisites; the
   `home-assistant/brands` PR (icon + logo PNG sizes, `custom_integrations/controlfreak/`); a
   community forum post draft (`docs/forum-post.md`). Add a 256×256 placeholder icon note (do not
   draw a trademarked logo).

## CONSTRAINTS
- **READ-ONLY against the real panel.** You MAY run the integration in a scratch HA
  (`hass -c <tmp config>` from `/opt/homeassistant/bin/python3 -m homeassistant` is NOT allowed —
  that is the owner's install; use a venv: `uv venv && uv pip install homeassistant pytest-homeassistant-custom-component`)
  and point it at the panel's host (read it from `/Library/Application Support/HomeAssistant/config/packages/control_freak.yaml`,
  `configuration_url` line) to SUBSCRIBE and GET. You may NEVER publish a command to the pool
  (no `controller/*/state`, no POST/PUT/DELETE on :8000) — that is the owner's pool and a
  shared house. Prove commands by asserting the published payload in tests only.
- Never write the LAN address, a wifi field or an AWS thing name into the repo, a test, a log
  line or your report: fixtures carry `<ip>`; `configuration_url` is built from the config entry.
- Never touch the owner's live HA config (`/Library/Application Support/HomeAssistant/config`),
  never `launchctl`, never `ha-restart`. Installing into the live HA is the manager's step.
- Nothing pushed to GitHub, no remote added — publishing is the owner's click.
- Python 3.13+, type hints, `ruff` clean.

## TESTS THAT MAKE A GREEN RED
A fixture with a fifth device-setting of type Valve must yield a read-only switch and NO
command topic; a status on an unknown topic must be ignored, not crash; a `controller/status`
older than 300 s must read `off`; a pump `pump_speed_minimum` of 40 must map HA 1 % → 40.

## VERIFY
`uv run pytest -q` (print the count), `uv run ruff check .`, hassfest locally if available
(`python -m script.hassfest --action validate --integration-path custom_components/controlfreak`
from a core checkout is optional — else state it is deferred to the CI workflow), then the scratch
HA run against the real panel READ-ONLY: the config flow succeeds, the entity list appears, the
two temperatures and the pump speed track the live values for 2 minutes. Counts only in the report.

## REPORT
Write `REPORT.md` here (≤ 400 words): head commit, what was built per item, test count and
verdicts, the live read-only check's counts, left undone and why, one next step. Commit on `main`
with `Co-Authored-By: Claude <noreply@anthropic.com>`. Stop.
