"""Pure mapping from /device-settings to entity specs, built on the real fixtures."""

from __future__ import annotations

import copy
from typing import Any

import pytest

from custom_components.controlfreak.mapping import (
    DEFAULT_EFFECTS,
    PANEL_KEYS,
    build_specs,
    parse_settings,
    percentage_to_speed,
    relay_is_on,
    relay_role,
    setting_uuid_of,
    speed_to_percentage,
)

PUMP = "65e9a29e-f7a2-42d5-a8f4-10b73f9a8580"
AIR = "52f0fb13-e98a-467f-9b7c-a9c4a8a165d3"
POOL = "9bb42466-668a-4dfa-a899-6379b73b6b65"
LIGHTS = "dbc92443-442a-4205-b476-ed873a9bd33a"


def _by_platform(specs) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for spec in specs:
        out.setdefault(spec.platform, []).append(spec.key)
    return {k: sorted(v) for k, v in out.items()}


def test_fixture_maps_to_exact_entity_set(device_settings: list[dict[str, Any]]) -> None:
    """4 real settings -> 1 fan, 1 light, 2 temperatures, pump extras, panel entities, 0 valves."""
    specs = build_specs(parse_settings(device_settings))
    assert _by_platform(specs) == {
        "fan": [PUMP],
        "light": [LIGHTS],
        "sensor": sorted(
            [
                AIR,
                POOL,
                f"{PUMP}_speed",
                f"{PUMP}_mode",
                "controller_cpu_temperature",
                "controller_freeze_protection",
                "controller_firmware",
            ]
        ),
        "binary_sensor": ["controller_connectivity"],
    }
    assert not [s for s in specs if s.kind == "valve"]
    assert set(PANEL_KEYS) <= {s.key for s in specs}


def test_setting_fields_parsed(device_settings: list[dict[str, Any]]) -> None:
    settings = parse_settings(device_settings)
    pump = settings[PUMP]
    assert pump.status_topic == "controller/pump1/status"
    assert pump.command_topic == "controller/pump1/state"
    assert (pump.speed_min, pump.speed_max) == (40, 100)
    assert pump.modes == ("pool",)
    light = settings[LIGHTS]
    assert light.connection_type == "Pentair Lights"
    # Learned from the panel's connection type, which is the 12-name Pentair set.
    assert sorted(light.effect_list) == sorted(DEFAULT_EFFECTS)
    assert settings[AIR].name == "Air"


def test_fifth_setting_valve_is_read_only_switch(device_settings: list[dict[str, Any]]) -> None:
    valve = copy.deepcopy(device_settings[1])
    valve.update(uuid="valve-uuid", name="Spa Valve", connection_type=None)
    valve["device_type"]["name"] = "Valve"
    valve["topic"]["mqtt_topic"] = "controller/valve1/"
    specs = build_specs(parse_settings([*device_settings, valve]))
    valve_specs = [s for s in specs if s.setting_uuid == "valve-uuid"]
    assert len(valve_specs) == 1
    assert valve_specs[0].platform == "switch"
    assert valve_specs[0].kind == "valve"
    assert valve_specs[0].command_topic is None


def test_plain_relay_is_switch_and_heater_keeps_kind(device_settings: list[dict[str, Any]]) -> None:
    relay = copy.deepcopy(device_settings[3])
    relay.update(uuid="lv-uuid", name="Heater", last_known_state="inactive")
    relay["device_type"]["name"] = "LowVoltage"
    relay["topic"]["mqtt_topic"] = "controller/lv_relay1/"
    relay["connection_type"] = {"name": "Gas Heater", "connection_type_properties": []}
    settings = parse_settings([relay])
    specs = build_specs(settings)
    assert [(s.platform, s.kind) for s in specs if s.setting_uuid] == [("switch", "relay")]
    assert relay_role(settings["lv-uuid"]) == "heater"
    assert settings["lv-uuid"].connection_type == "Gas Heater"


def test_relay_promoted_to_light_by_status_colour(device_settings: list[dict[str, Any]]) -> None:
    relay = copy.deepcopy(device_settings[3])
    relay.update(uuid="hv2", last_known_state="", connection_type=None)
    relay["topic"]["mqtt_topic"] = "controller/hv_relay2/"
    settings = parse_settings([relay])

    def platform(specs) -> str:
        return next(s.platform for s in specs if s.setting_uuid == "hv2")

    assert platform(build_specs(settings)) == "switch"
    statuses = {"controller/hv_relay2/": {"meta": {"relay_state": 1, "color_choice": "Red"}}}
    assert platform(build_specs(settings, statuses)) == "light"
    # Once registered as a light it stays one, even before any status arrives.
    assert platform(build_specs(settings, light_relays={"hv2"})) == "light"


def test_no_pump_mode_command_entity(device_settings: list[dict[str, Any]]) -> None:
    """The mode command was never captured, so pumps get no writable mode entity."""
    specs = build_specs(parse_settings(device_settings))
    assert not [s for s in specs if s.platform == "select"]
    assert [s.kind for s in specs if s.key == f"{PUMP}_mode"] == ["pump_mode"]


def test_setting_uuid_of() -> None:
    assert setting_uuid_of(PUMP) == PUMP
    assert setting_uuid_of(f"{PUMP}_speed") == PUMP
    assert setting_uuid_of(f"{PUMP}_mode_select") == PUMP


def test_unknown_type_and_missing_topic_skipped(device_settings: list[dict[str, Any]]) -> None:
    odd = copy.deepcopy(device_settings[0])
    odd.update(uuid="odd")
    odd["device_type"]["name"] = "Chlorinator"
    no_topic = copy.deepcopy(device_settings[1])
    no_topic.update(uuid="nt", topic=None)
    assert set(parse_settings([odd, no_topic])) == set()


def test_pump_percentage_maps_through_min_40() -> None:
    assert percentage_to_speed(1, 40, 100) == 40
    assert percentage_to_speed(100, 40, 100) == 100
    assert percentage_to_speed(50, 40, 100) == 70
    assert speed_to_percentage(40, 40, 100) == 1
    assert speed_to_percentage(100, 40, 100) == 100
    assert speed_to_percentage(0, 40, 100) == 0
    # A green that cannot fail is not evidence: a naive 1:1 mapping would give 1.
    assert percentage_to_speed(1, 40, 100) != 1


def test_relay_state_shapes() -> None:
    # hv_relay reports int 1; lv_relay reports the string "inactive" (both captured).
    assert relay_is_on(1) is True
    assert relay_is_on("1") is True
    assert relay_is_on("active") is True
    assert relay_is_on(0) is False
    assert relay_is_on("inactive") is False
    assert relay_is_on(None) is None


@pytest.mark.parametrize(
    ("connection", "role"),
    [
        ("Gas Heater", "heater"),
        ("Heat Pump", "heater"),
        ("Chiller", "chiller"),
        ("General", "relay"),
        (None, "relay"),
    ],
)
def test_relay_role_comes_from_connection_type_not_port(
    device_settings: list[dict[str, Any]], connection: str | None, role: str
) -> None:
    for voltage, topic in (("LowVoltage", "lv_relay3"), ("HighVoltage", "hv_relay7")):
        relay = copy.deepcopy(device_settings[3])
        relay.update(uuid="r", name="Anything", last_known_state=None)
        relay["device_type"]["name"] = voltage
        relay["topic"]["mqtt_topic"] = f"controller/{topic}/"
        relay["connection_type"] = (
            {"name": connection, "connection_type_properties": []} if connection else None
        )
        assert relay_role(parse_settings([relay])["r"]) == role
