"""The dashboard strategy: served by the integration, and fed by real entities.

The node tests in tests/frontend/ run the strategy against hass stubs. Those
stubs are generated HERE, from the integration's own entity registry and
states for several synthetic panels, so the JavaScript can never drift from
what the backend actually produces. Regenerate after a backend change with:

    UPDATE_DASHBOARD_FIXTURES=1 uv run --no-project pytest tests/test_frontend.py
"""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import re
from typing import Any
from unittest.mock import MagicMock

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util.unit_system import US_CUSTOMARY_SYSTEM
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.controlfreak.const import DOMAIN, FRONTEND_URL

from .conftest import FakeMqtt, load_fixture, mock_rest

ROOT = Path(__file__).parent.parent
STRATEGY = ROOT / "custom_components" / DOMAIN / "frontend" / "controlfreak-strategy.js"
JS_FIXTURES = Path(__file__).parent / "frontend" / "fixtures"
MANIFEST = json.loads((ROOT / "custom_components" / DOMAIN / "manifest.json").read_text())


async def test_strategy_is_served(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    setup_integration: FakeMqtt,
    stub_frontend: MagicMock,
) -> None:
    """The JS is registered as a frontend module and actually served over HTTP."""
    stub_frontend.assert_called_once_with(hass, f"{FRONTEND_URL}?v={MANIFEST['version']}")
    client = await hass_client()
    resp = await client.get(FRONTEND_URL)
    assert resp.status == 200
    body = await resp.text()
    for tag in ("dashboard", "view", "section"):
        assert f'"ll-strategy-{tag}-controlfreak"' in body


def strategy_translation_keys() -> set[str]:
    """The translation keys the strategy recognises (its KNOWN table)."""
    js = STRATEGY.read_text()
    block = js[js.index("const KNOWN = {") : js.index("};", js.index("const KNOWN = {"))]
    return set(re.findall(r"^\s+(\w+): \[", block, re.MULTILINE))


# --- synthetic panels built from the real fixture shapes --------------------

_REAL = load_fixture("device-settings.json")
_PUMP, _THERM, _LIGHT = _REAL[0], _REAL[1], _REAL[3]
_CONNECTIONS = {f"{c['name']}/{c['filter_type']}": c for c in load_fixture("connection-types.json")}


def _setting(template: dict[str, Any], uuid: str, name: str, topic: str, **extra: Any) -> dict:
    s = copy.deepcopy(template)
    s.update(uuid=uuid, name=name, **{k: v for k, v in extra.items() if k != "device_type"})
    s["topic"]["mqtt_topic"] = topic
    if "device_type" in extra:
        s["device_type"]["name"] = extra["device_type"]
    return s


def pump(n: int, name: str, modes: tuple[str, ...] = ()) -> tuple[dict, dict]:
    setting = _setting(
        _PUMP,
        f"pump-{n}",
        name,
        f"controller/pump{n}/",
        **{f"{m}_mode": m in modes for m in ("pool", "spa", "spillover")},
    )
    status = {"status": "active", "meta": {"pump_speed": str(40 + 10 * n), "mode": "pool"}}
    return setting, {f"controller/pump{n}/status": status}


def light(n: int, name: str) -> tuple[dict, dict]:
    setting = _setting(_LIGHT, f"light-{n}", name, f"controller/hv_relay{n}/")
    status = {"status": "active", "meta": {"relay_state": 1, "last_known_state": "Blue"}}
    return setting, {f"controller/hv_relay{n}/status": status}


def relay(n: int, name: str, connection: str, voltage: str = "LowVoltage") -> tuple[dict, dict]:
    prefix = "lv" if voltage == "LowVoltage" else "hv"
    topic = f"controller/{prefix}_relay{n}/"
    setting = _setting(
        _LIGHT,
        f"relay-{prefix}{n}",
        name,
        topic,
        device_type=voltage,
        connection_type=_CONNECTIONS[f"{connection}/{voltage}"],
        last_known_state=None,
    )
    state = "inactive" if voltage == "LowVoltage" else 0
    return setting, {f"{topic}status": {"status": "active", "meta": {"relay_state": state}}}


def thermistor(n: int, name: str, temp: float) -> tuple[dict, dict]:
    setting = _setting(_THERM, f"therm-{n}", name, f"controller/thermistor{n}/")
    status = {"status": "active", "meta": {"temperature_f": temp}}
    return setting, {f"controller/thermistor{n}/status": status}


def flow(n: int, name: str) -> tuple[dict, dict]:
    topic = f"controller/flow_sensor{n}/"
    setting = _setting(_THERM, f"flow-{n}", name, topic, device_type="FlowSensor")
    return setting, {f"{topic}status": {"status": "active", "meta": {"active_flow": True}}}


def valve(n: int, name: str) -> tuple[dict, dict]:
    topic = f"controller/valve{n}/"
    setting = _setting(_THERM, f"valve-{n}", name, topic, device_type="Valve")
    return setting, {f"{topic}status": {"status": "active", "meta": {"valve_state": 1}}}


SHAPES: dict[str, list[tuple[dict, dict]]] = {
    "full-pool": [
        pump(1, "Filter Pump", ("pool", "spa", "spillover")),
        pump(2, "Spa Jets", ("spa",)),
        pump(3, "Waterfall"),
        pump(4, "Cleaner Booster"),
        pump(5, "Solar Pump", ("pool", "spa")),
        light(1, "Pool Light"),
        light(2, "Spa Light"),
        relay(1, "Spa Heater", "Gas Heater"),
        relay(2, "Pool Chiller", "Chiller"),
        relay(3, "Deck Lights", "General"),
        relay(3, "Landscape Lights", "General", "HighVoltage"),
        thermistor(1, "Air", 78.4),
        thermistor(2, "Pool Water", 81.2),
        thermistor(3, "Spa Water", 101.5),
        flow(1, "Main Flow"),
        valve(1, "Spa Valve"),
    ],
    "lighting-only": [
        light(1, "Pool Light"),
        light(2, "Spa Light"),
        light(3, "Bubbler Light"),
        relay(4, "Landscape Lights", "General", "HighVoltage"),
        relay(2, "Path Lights", "General"),
    ],
    "valves-skimmers": [
        valve(1, "Skimmer 1"),
        valve(2, "Skimmer 2"),
        valve(3, "Spa Return Valve"),
        valve(4, "Intake Valve"),
        flow(1, "Skimmer Flow"),
    ],
}

PANEL_STATUSES = {
    "controller/status": {"status": "active", "meta": {"cpuTemperature": 114.4}},
    "controller/freeze-protection/status": {"status": "nominal", "meta": {}},
}

# Something that is not ours, to prove the strategy filters by platform.
FOREIGN = {
    "entities": {"sun.sun": {"entity_id": "sun.sun", "platform": "sun", "labels": []}},
    "states": {"sun.sun": {"entity_id": "sun.sun", "state": "above_horizon", "attributes": {}}},
}


def hass_stub(hass: HomeAssistant, entry: MockConfigEntry | None) -> dict[str, Any]:
    """The slice of the frontend's `hass` object the strategy reads."""
    stub = copy.deepcopy(FOREIGN)
    if entry is None:
        return stub
    for reg in er.async_entries_for_config_entry(er.async_get(hass), entry.entry_id):
        display: dict[str, Any] = {
            "entity_id": reg.entity_id,
            "platform": reg.platform,
            "device_id": "controlfreak-device",  # registry ids are random per run
            "labels": [],
            "has_entity_name": reg.has_entity_name,
        }
        if reg.translation_key:
            display["translation_key"] = reg.translation_key
        if reg.entity_category:
            display["entity_category"] = reg.entity_category.value
        stub["entities"][reg.entity_id] = display
        state = hass.states.get(reg.entity_id)
        assert state is not None
        stub["states"][reg.entity_id] = {
            "entity_id": reg.entity_id,
            "state": state.state,
            "attributes": dict(state.attributes),
        }
    stub["entities"] = dict(sorted(stub["entities"].items()))
    stub["states"] = dict(sorted(stub["states"].items()))
    return stub


def _check_fixture(name: str, stub: dict[str, Any]) -> None:
    path = JS_FIXTURES / f"{name}.json"
    text = json.dumps(stub, indent=2, sort_keys=True, default=str) + "\n"
    if os.environ.get("UPDATE_DASHBOARD_FIXTURES"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    assert path.exists(), f"run with UPDATE_DASHBOARD_FIXTURES=1 to create {path.name}"
    assert json.loads(path.read_text()) == json.loads(text), (
        f"{path.name} is stale: regenerate with UPDATE_DASHBOARD_FIXTURES=1"
    )


@pytest.mark.parametrize("shape", sorted(SHAPES))
async def test_dashboard_fixture(
    hass: HomeAssistant,
    aioclient_mock: AiohttpClientMocker,
    config_entry: MockConfigEntry,
    fake_mqtt: type[FakeMqtt],
    shape: str,
) -> None:
    """Every entity carries a translation key the strategy knows; fixture is current."""
    hass.config.units = US_CUSTOMARY_SYSTEM
    settings = [s for s, _ in SHAPES[shape]]
    mock_rest(aioclient_mock, settings)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    mqtt = fake_mqtt.instances[-1]
    for _, statuses in SHAPES[shape]:
        for topic, payload in {**statuses, **PANEL_STATUSES}.items():
            mqtt.inject(topic, payload)
    await hass.async_block_till_done()

    known = strategy_translation_keys()
    entries = er.async_entries_for_config_entry(er.async_get(hass), config_entry.entry_id)
    assert entries
    for reg in entries:
        assert reg.translation_key in known, f"{reg.entity_id}: {reg.translation_key!r}"
        assert hass.states.get(reg.entity_id).state != "unavailable", reg.entity_id

    _check_fixture(shape, hass_stub(hass, config_entry))


async def test_empty_fixture(hass: HomeAssistant) -> None:
    """No Control Freak entry at all: only foreign entities."""
    _check_fixture("empty", hass_stub(hass, None))
