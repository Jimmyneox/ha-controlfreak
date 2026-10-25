"""Entities end to end: fixtures in, states and published payloads out."""

from __future__ import annotations

import copy
from datetime import timedelta
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.const import STATE_OFF, STATE_ON, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.controlfreak.const import DOMAIN

from .conftest import CONTROLLER_UUID, FakeMqtt, load_fixture, mock_rest

PUMP = "65e9a29e-f7a2-42d5-a8f4-10b73f9a8580"
AIR = "52f0fb13-e98a-467f-9b7c-a9c4a8a165d3"
POOL = "9bb42466-668a-4dfa-a899-6379b73b6b65"
LIGHTS = "dbc92443-442a-4205-b476-ed873a9bd33a"


def eid(hass: HomeAssistant, entry: MockConfigEntry, platform: str, key: str) -> str:
    entity_id = er.async_get(hass).async_get_entity_id(platform, DOMAIN, f"{entry.entry_id}_{key}")
    assert entity_id, f"no {platform} for {key}"
    return entity_id


def registry_set(hass: HomeAssistant, entry: MockConfigEntry) -> set[tuple[str, str]]:
    prefix = f"{entry.entry_id}_"
    return {
        (e.domain, e.unique_id.removeprefix(prefix))
        for e in er.async_entries_for_config_entry(er.async_get(hass), entry.entry_id)
    }


EXPECTED = {
    ("fan", PUMP),
    ("light", LIGHTS),
    ("sensor", AIR),
    ("sensor", POOL),
    ("sensor", f"{PUMP}_speed"),
    ("sensor", f"{PUMP}_mode"),
    ("binary_sensor", "controller_connectivity"),
    ("sensor", "controller_cpu_temperature"),
    ("sensor", "controller_freeze_protection"),
    ("sensor", "controller_firmware"),
}


async def test_entity_set_and_device(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    assert registry_set(hass, config_entry) == EXPECTED
    assert not [e for e in EXPECTED if e[0] == "switch"]
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), config_entry.entry_id)
    assert len(devices) == 1
    device = devices[0]
    assert (DOMAIN, CONTROLLER_UUID) in device.identifiers
    assert device.manufacturer == "Control Freak Pool Tech"
    assert device.sw_version == "1.0.13"
    assert device.configuration_url == "http://panel.test:8000/docs"
    # Unique ids never carry the host.
    assert all("panel.test" not in uid for _, uid in registry_set(hass, config_entry))


async def test_states_from_captured_statuses(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    e = config_entry
    assert float(hass.states.get(eid(hass, e, "sensor", AIR)).state) == pytest.approx(77.95, 0.01)
    assert float(hass.states.get(eid(hass, e, "sensor", POOL)).state) == pytest.approx(78.12, 0.01)
    fan = hass.states.get(eid(hass, e, "fan", PUMP))
    assert fan.state == STATE_ON
    assert fan.attributes["percentage"] == 100
    assert fan.attributes["pump_model"] == "Fairland"
    assert hass.states.get(eid(hass, e, "sensor", f"{PUMP}_speed")).state == "100"
    assert hass.states.get(eid(hass, e, "sensor", f"{PUMP}_mode")).state == "pool"
    light = hass.states.get(eid(hass, e, "light", LIGHTS))
    assert light.state == STATE_ON
    assert light.attributes["effect"] == "Blue"
    assert len(light.attributes["effect_list"]) == 12
    assert hass.states.get(eid(hass, e, "binary_sensor", "controller_connectivity")).state == "on"
    cpu = hass.states.get(eid(hass, e, "sensor", "controller_cpu_temperature"))
    assert float(cpu.state) == pytest.approx(114.38, 0.01)
    assert hass.states.get(eid(hass, e, "sensor", "controller_freeze_protection")).state == (
        "nominal"
    )
    assert hass.states.get(eid(hass, e, "sensor", "controller_firmware")).state == "1.0.13"


async def test_status_updates_only_the_right_entity(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    air = eid(hass, config_entry, "sensor", AIR)
    pool = eid(hass, config_entry, "sensor", POOL)
    before_pool = hass.states.get(pool).state
    setup_integration.inject(
        "controller/thermistor1/status",
        {"name": "thermistor1", "status": "active", "meta": {"temperature_f": 61.5}},
    )
    await hass.async_block_till_done()
    assert hass.states.get(air).state == "61.5"
    assert hass.states.get(pool).state == before_pool


async def test_unknown_topic_and_garbage_ignored(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    before = {s.entity_id: s.state for s in hass.states.async_all()}
    setup_integration.inject("controller/unknown_port9/status", {"status": "active"})
    setup_integration.inject("controller/thermistor1/status", b"not json")
    setup_integration.inject("controller/thermistor1/status", b"[1, 2]")
    setup_integration.inject("controller/pump1/state", {"pump_speed": "40"})
    setup_integration.inject("controller/api/response/abc", {"x": 1})
    await hass.async_block_till_done()
    assert {s.entity_id: s.state for s in hass.states.async_all()} == before


async def test_inactive_thermistor_unavailable(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    air = eid(hass, config_entry, "sensor", AIR)
    setup_integration.inject(
        "controller/thermistor1/status", {"name": "thermistor1", "status": "inactive"}
    )
    await hass.async_block_till_done()
    assert hass.states.get(air).state == STATE_UNAVAILABLE


async def test_stale_values(
    hass: HomeAssistant,
    freezer: FrozenDateTimeFactory,  # before setup_integration so timers use the frozen clock
    setup_integration: FakeMqtt,
    config_entry: MockConfigEntry,
) -> None:
    """Thermistor stale after 180 s -> unavailable; controller/status > 300 s -> off."""
    air = eid(hass, config_entry, "sensor", AIR)
    online = eid(hass, config_entry, "binary_sensor", "controller_connectivity")
    freezer.tick(timedelta(seconds=170))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert hass.states.get(air).state != STATE_UNAVAILABLE
    freezer.tick(timedelta(seconds=15))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert hass.states.get(air).state == STATE_UNAVAILABLE
    assert hass.states.get(online).state == STATE_ON
    freezer.tick(timedelta(seconds=120))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert hass.states.get(online).state == STATE_OFF
    # A fresh publish brings both back.
    setup_integration.inject("controller/status", {"status": "active", "meta": {}})
    setup_integration.inject(
        "controller/thermistor1/status", {"status": "active", "meta": {"temperature_f": 70}}
    )
    await hass.async_block_till_done()
    assert hass.states.get(online).state == STATE_ON
    assert hass.states.get(air).state == "70.0"


async def test_mqtt_loss_marks_unavailable(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    fan = eid(hass, config_entry, "fan", PUMP)
    online = eid(hass, config_entry, "binary_sensor", "controller_connectivity")
    setup_integration.set_connected(False)
    await hass.async_block_till_done()
    assert hass.states.get(fan).state == STATE_UNAVAILABLE
    assert hass.states.get(online).state == STATE_OFF
    setup_integration.set_connected(True)
    await hass.async_block_till_done()
    assert hass.states.get(fan).state == STATE_ON


async def _refresh(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()


async def test_removed_setting_removes_entities_and_new_one_appears(
    hass: HomeAssistant,
    setup_integration: FakeMqtt,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    device_settings: list[dict[str, Any]],
) -> None:
    pump_entities = {
        ("fan", PUMP),
        ("sensor", f"{PUMP}_speed"),
        ("sensor", f"{PUMP}_mode"),
    }
    fan_id = eid(hass, config_entry, "fan", PUMP)
    mock_rest(aioclient_mock, [s for s in device_settings if s["uuid"] != PUMP])
    await _refresh(hass, config_entry)
    assert registry_set(hass, config_entry) == EXPECTED - pump_entities
    assert hass.states.get(fan_id) is None

    # Pump comes back, plus a new valve: both appear without a restart.
    valve = copy.deepcopy(device_settings[1])
    valve.update(uuid="valve-uuid", name="Spa Valve")
    valve["device_type"]["name"] = "Valve"
    valve["topic"]["mqtt_topic"] = "controller/valve1/"
    mock_rest(aioclient_mock, [*device_settings, valve])
    await _refresh(hass, config_entry)
    assert registry_set(hass, config_entry) == EXPECTED | {("switch", "valve-uuid")}


async def test_valve_is_read_only(
    hass: HomeAssistant,
    setup_integration: FakeMqtt,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    device_settings: list[dict[str, Any]],
) -> None:
    valve = copy.deepcopy(device_settings[1])
    valve.update(uuid="valve-uuid", name="Spa Valve")
    valve["device_type"]["name"] = "Valve"
    valve["topic"]["mqtt_topic"] = "controller/valve1/"
    mock_rest(aioclient_mock, [*device_settings, valve])
    await _refresh(hass, config_entry)
    setup_integration.inject("controller/valve1/status", {"status": "active", "meta": {}})
    await hass.async_block_till_done()
    valve_id = eid(hass, config_entry, "switch", "valve-uuid")
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call("switch", "turn_on", {"entity_id": valve_id}, blocking=True)
    setup_integration.async_publish.assert_not_awaited()


async def test_rest_failure_keeps_entities(
    hass: HomeAssistant,
    setup_integration: FakeMqtt,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    aioclient_mock.clear_requests()  # every GET now 404s -> UpdateFailed
    await _refresh(hass, config_entry)
    assert registry_set(hass, config_entry) == EXPECTED
    fw = eid(hass, config_entry, "sensor", "controller_firmware")
    assert hass.states.get(fw).state == STATE_UNAVAILABLE
    # MQTT-fed values are unaffected by a REST hiccup.
    assert hass.states.get(eid(hass, config_entry, "sensor", AIR)).state != STATE_UNAVAILABLE


# Commands: asserted on the published payload only. Nothing reaches a real panel.


async def _call(hass: HomeAssistant, domain: str, service: str, data: dict[str, Any]) -> None:
    await hass.services.async_call(domain, service, data, blocking=True)


async def test_fan_commands(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    fan = eid(hass, config_entry, "fan", PUMP)
    pub = setup_integration.async_publish
    await _call(hass, "fan", "set_percentage", {"entity_id": fan, "percentage": 1})
    pub.assert_awaited_with(
        "controller/pump1/state", {"pump_speed": "40", "mode": "pool", "sender": "user"}
    )
    await _call(hass, "fan", "turn_off", {"entity_id": fan})
    pub.assert_awaited_with(
        "controller/pump1/state", {"pump_speed": "inactive", "mode": "pool", "sender": "user"}
    )
    await _call(hass, "fan", "turn_on", {"entity_id": fan})
    pub.assert_awaited_with(
        "controller/pump1/state", {"pump_speed": "100", "mode": "pool", "sender": "user"}
    )
    await _call(hass, "fan", "set_percentage", {"entity_id": fan, "percentage": 0})
    assert pub.await_args.args[1]["pump_speed"] == "inactive"


async def test_fan_state_maps_min_speed_to_one_percent(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    setup_integration.inject(
        "controller/pump1/status",
        {"status": "active", "meta": {"pump_speed": "40", "mode": "pool"}},
    )
    await hass.async_block_till_done()
    assert hass.states.get(eid(hass, config_entry, "fan", PUMP)).attributes["percentage"] == 1
    setup_integration.inject(
        "controller/pump1/status", {"status": "active", "meta": {"pump_speed": 0, "mode": "pool"}}
    )
    await hass.async_block_till_done()
    assert hass.states.get(eid(hass, config_entry, "fan", PUMP)).state == STATE_OFF


async def test_light_commands(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    light = eid(hass, config_entry, "light", LIGHTS)
    pub = setup_integration.async_publish
    await _call(hass, "light", "turn_on", {"entity_id": light, "effect": "Party Mode"})
    pub.assert_awaited_with(
        "controller/hv_relay1/state",
        {"state": "active", "mode": "not-syncing", "color_choice": "Party Mode", "sender": "user"},
    )
    await _call(hass, "light", "turn_off", {"entity_id": light})
    pub.assert_awaited_with(
        "controller/hv_relay1/state", {"state": "inactive", "mode": "not-syncing", "sender": "user"}
    )


def _status_only_light(device_settings: list[dict[str, Any]]) -> dict[str, Any]:
    """A relay that is only recognisable as a light from its MQTT status."""
    relay = copy.deepcopy(device_settings[3])
    relay.update(uuid="hv2", name="Deck Lights", last_known_state="inactive")
    relay["connection_type"] = {"name": "General", "connection_type_properties": []}
    relay["topic"]["mqtt_topic"] = "controller/hv_relay2/"
    return relay


async def test_status_only_light_survives_restart(
    hass: HomeAssistant,
    setup_integration: FakeMqtt,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    device_settings: list[dict[str, Any]],
) -> None:
    """Review hacs/default#11967: a restart must not delete and recreate the light."""
    mock_rest(aioclient_mock, [*device_settings, _status_only_light(device_settings)])
    await _refresh(hass, config_entry)
    assert ("switch", "hv2") in registry_set(hass, config_entry)
    setup_integration.inject(
        "controller/hv_relay2/status", {"status": "active", "meta": {"color_choice": "Red"}}
    )
    await _refresh(hass, config_entry)
    keys = registry_set(hass, config_entry)
    assert ("light", "hv2") in keys and ("switch", "hv2") not in keys

    registry = er.async_get(hass)
    light_id = eid(hass, config_entry, "light", "hv2")
    original = registry.async_get(light_id)
    area = ar.async_get(hass).async_create("Backyard")
    registry.async_update_entity(light_id, name="My deck", area_id=area.id)

    # Restart: the first refresh runs before MQTT has delivered any status.
    for _ in range(2):
        assert await hass.config_entries.async_reload(config_entry.entry_id)
        await hass.async_block_till_done()
        keys = registry_set(hass, config_entry)
        assert ("light", "hv2") in keys and ("switch", "hv2") not in keys
        kept = registry.async_get(light_id)
        assert kept is not None and kept.id == original.id
        assert (kept.name, kept.area_id) == ("My deck", area.id)


async def test_prune_by_setting_uuid_only(
    hass: HomeAssistant,
    setup_integration: FakeMqtt,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    device_settings: list[dict[str, Any]],
) -> None:
    """Entries go only when their setting uuid leaves /device-settings.

    The pump mode select from 0.2.0 is removed once.
    """
    registry = er.async_get(hass)
    prefix = f"{config_entry.entry_id}_"
    registry.async_get_or_create(
        "select", DOMAIN, f"{prefix}{PUMP}_mode_select", config_entry=config_entry
    )
    registry.async_get_or_create("light", DOMAIN, f"{prefix}{AIR}_x", config_entry=config_entry)
    await _refresh(hass, config_entry)
    keys = registry_set(hass, config_entry)
    assert ("select", f"{PUMP}_mode_select") not in keys
    assert ("light", f"{AIR}_x") in keys  # its setting still exists: kept

    mock_rest(aioclient_mock, [s for s in device_settings if s["uuid"] != AIR])
    await _refresh(hass, config_entry)
    keys = registry_set(hass, config_entry)
    assert not [k for _, k in keys if k.startswith(AIR)]
    assert {("sensor", k) for k in ("controller_cpu_temperature", "controller_firmware")} <= keys


async def test_relay_switch_lv_string_state(
    hass: HomeAssistant,
    setup_integration: FakeMqtt,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    device_settings: list[dict[str, Any]],
) -> None:
    heater = copy.deepcopy(device_settings[3])
    heater.update(uuid="heater", name="Heater", last_known_state="inactive")
    heater["device_type"]["name"] = "LowVoltage"
    heater["topic"]["mqtt_topic"] = "controller/lv_relay1/"
    heater["connection_type"] = {"name": "Gas Heater", "connection_type_properties": []}
    mock_rest(aioclient_mock, [*device_settings, heater])
    await _refresh(hass, config_entry)
    statuses = load_fixture("mqtt-status.json")
    setup_integration.inject("controller/lv_relay1/status", statuses["controller/lv_relay1/status"])
    await hass.async_block_till_done()
    sw = eid(hass, config_entry, "switch", "heater")
    state = hass.states.get(sw)
    assert state.state == STATE_OFF
    assert state.attributes["icon"] == "mdi:fire"
    await _call(hass, "switch", "turn_on", {"entity_id": sw})
    setup_integration.async_publish.assert_awaited_with(
        "controller/lv_relay1/state", {"state": "active", "mode": "not-syncing", "sender": "user"}
    )


async def test_unload(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert setup_integration.connected is False
