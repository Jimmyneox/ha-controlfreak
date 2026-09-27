# [Custom integration] Control Freak Automated Pool System — local control of the Control Freak pool panel, no cloud

**Unofficial — not affiliated with Control Freak Pool Tech.**

If you have a Control Freak pool panel (the Raspberry Pi controller with the ControlFreak
app), this integration runs it locally from Home Assistant:

- **No cloud.** It reads the panel's own REST API (port 8000) to discover your configured
  equipment and listens to the panel's built-in MQTT broker over WebSockets (port 8080).
- **No conflict with your MQTT setup.** It has its own MQTT client, so your Mosquitto /
  HA MQTT integration stays as it is.
- **Discovers your equipment.** Entities come from the pumps, lights, relays,
  thermistors and flow sensors you've configured on the panel. Change the setup in the
  app and HA follows without a restart.

What you get: variable-speed pump as a fan (speed maps through the pump's minimum),
pump speed/mode sensors, colour lights with effects, relays/heaters as switches, water and
air temperatures, flow, panel connectivity, CPU temperature and freeze-protection status.

**Install:** HACS → Custom repositories → `https://github.com/Jimmyneox/ha-controlfreak`
(Integration) → install → restart → Add integration → Control Freak → enter the panel IP.

**Help wanted:**

- **Valves** are read-only for now because nobody has captured the command the app
  sends. If you have valves, subscribe to `controller/#` on `ws://<panel>:8080/`, move a
  valve in the app, and post what shows up on `controller/valve<n>/state`.
- The **pump mode** (pool/spa/spillover) command is inferred. A capture of a spa-mode
  switch would confirm it.
- Only API v1.0.13 has been tested. Please post your `/health` version if it works (or
  doesn't) on another one.

Issues and captures: https://github.com/Jimmyneox/ha-controlfreak/issues
