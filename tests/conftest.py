"""Shared fixtures: real scrubbed panel responses and a fake MQTT transport."""

from __future__ import annotations

from collections.abc import Generator
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from homeassistant.util.unit_system import US_CUSTOMARY_SYSTEM
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.controlfreak.const import (
    CONF_MQTT_PORT,
    CONF_REST_PORT,
    DOMAIN,
)

FIXTURES = Path(__file__).parent / "fixtures"
HOST = "panel.test"
BASE = f"http://{HOST}:8000"
CONTROLLER_UUID = "0f3c2a54-1111-4222-8333-944455556666"


def load_fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Let HA load custom_components/ in every test."""


@pytest.fixture
def device_settings() -> list[dict[str, Any]]:
    return load_fixture("device-settings.json")


@pytest.fixture
def statuses() -> dict[str, Any]:
    data = load_fixture("mqtt-status.json")
    data.pop("_note")
    return data


def controller_config() -> dict[str, Any]:
    """The /controller-config shape, with its wifi/aws fields present so redaction is tested."""
    return {
        "uuid": CONTROLLER_UUID,
        "name": "Backyard",
        "status": "healthy",
        "version": "1.0.13",
        "timezone": "America/New_York",
        "last_connected_wifi": "SECRET-SSID",
        "thing_name": "controlfreak-SECRET",
        "aws_installed": "true",
        "create_date": "2025-09-09T08:39:14",
        "update_date": "2026-09-27T20:00:00",
    }


def mock_rest(
    aioclient_mock: AiohttpClientMocker,
    settings: list[dict[str, Any]] | None = None,
) -> None:
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{BASE}/health", json=load_fixture("health.json"))
    aioclient_mock.get(f"{BASE}/controller-config", json=controller_config())
    aioclient_mock.get(
        f"{BASE}/device-settings",
        json=settings if settings is not None else load_fixture("device-settings.json"),
    )
    aioclient_mock.get(f"{BASE}/pump-models", json=load_fixture("pump-models.json"))


class FakeMqtt:
    """Stands in for ControlFreakMqtt: records publishes, lets tests inject messages."""

    instances: list[FakeMqtt] = []

    def __init__(self, hass, host, port, on_message, on_connection_change) -> None:
        self.host = host
        self.port = port
        self.on_message = on_message
        self.on_connection_change = on_connection_change
        self.connected = False
        self.async_publish = AsyncMock()
        FakeMqtt.instances.append(self)

    async def async_start(self, entry) -> None:
        self.set_connected(True)

    async def async_stop(self) -> None:
        self.connected = False

    def set_connected(self, value: bool) -> None:
        self.connected = value
        self.on_connection_change(value)

    def inject(self, topic: str, payload: Any) -> None:
        raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.on_message(topic, raw)


@pytest.fixture
def fake_mqtt() -> Generator[type[FakeMqtt]]:
    FakeMqtt.instances = []
    with patch("custom_components.controlfreak.coordinator.ControlFreakMqtt", FakeMqtt):
        yield FakeMqtt


@pytest.fixture
def config_entry() -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title="Backyard",
        unique_id=CONTROLLER_UUID,
        data={CONF_HOST: HOST, CONF_REST_PORT: 8000, CONF_MQTT_PORT: 8080},
    )


@pytest.fixture
async def setup_integration(
    hass: HomeAssistant,
    aioclient_mock: AiohttpClientMocker,
    config_entry: MockConfigEntry,
    fake_mqtt: type[FakeMqtt],
    statuses: dict[str, Any],
) -> FakeMqtt:
    """Set the integration up and replay the captured retained statuses."""
    hass.config.units = US_CUSTOMARY_SYSTEM  # the panel reports °F; keep values unconverted
    mock_rest(aioclient_mock)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    mqtt = fake_mqtt.instances[-1]
    for topic, payload in statuses.items():
        mqtt.inject(topic, payload)
    await hass.async_block_till_done()
    return mqtt
