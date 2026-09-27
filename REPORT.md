# CF1 report — controlfreak

**Head commit:** `4b55f33` on `main`. Nothing pushed, no remote.

## Built
1. **Layout:** HACS layout, a manifest with `aiomqtt>=2.5.0` (fits core's pins), CI, README, license.
2. **Config flow:** checks `/health` and one MQTT-WS connect. Unique id is the controller uuid, falling back to the host. Options set the poll interval.
3. **Transport:** its own aiomqtt WebSocket client on `controller/#`, 1–60 s backoff; a dropped connection makes entities unavailable.
4. **Discovery:** a pure mapper over `/device-settings`, with live add/remove.
5. **Entities:** as briefed. Light effects come from the panel, valves are read-only, and the mode select is marked inferred. A live capture showed LV relays send the string `"inactive"` where HV relays send int `1`; both are handled.
6. **Diagnostics:** host, wifi and AWS fields are redacted.
7. **Tests:** written RED-first.
8. **Submission kit:** includes a placeholder-icon note.

## Verification
- **pytest:** 38 passed.
- **ruff:** clean; all files parse as Python 3.13.
- **hassfest (2026.9.4):** 0 invalid. It goes red when `iot_class` is removed.
- **Tests that can fail:** I broke 7 behaviours on purpose; all 7 turned tests red.
- **Leak scan:** 0 files contain the panel address or any IPv4 address.
- **Live check (scratch HA, read-only):**
  - The config flow created the entry, with the unique id from the controller uuid.
  - 11 entities: 1 fan, 1 light, 1 select, 7 sensors, 1 binary sensor.
  - 1 was unavailable at setup (CPU, which isn't retained); 0 by the end.
  - Over 2 minutes, **36/36** samples of the two temperatures and the pump speed matched an independent subscriber.
  - Guards recorded **0 publishes and 0 non-GET requests**.

## Left undone
- **Local Network:** macOS blocks the uv Python from the LAN. The live run used a separate scratch venv on HA's runtime interpreter, on port 8129.
- **Exit crash:** that interpreter segfaults in CPython's final garbage collection, after HA has stopped cleanly.
- **Unconfirmed on real hardware:** the valve and pump-mode command shapes.
- **CI only:** the HACS action runs only in CI, with brands ignored until the brands PR merges.
- **Owner's click:** publish, release, brands, HACS.

## Next step
Install into the live HA (a manager step, ~15 min): copy the component, restart, add the entry, confirm 11 entities, then disable the MQTT package to avoid duplicates. One decision: rename the new entities to the old `sensor.pool_*` ids, or retarget `dashboards/pool.yaml`.
