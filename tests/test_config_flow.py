"""Config flow: success, bad host, not a ControlFreak, MQTT down, already configured, options."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import aiohttp
from homeassistant.config_entries import SOURCE_USER
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.controlfreak.config_flow import HOST_RE
from custom_components.controlfreak.const import (
    CONF_MQTT_PORT,
    CONF_REST_PORT,
    CONF_SCAN_INTERVAL,
    DOMAIN,
)
from custom_components.controlfreak.mqtt import MqttCannotConnect

from .conftest import BASE, CONTROLLER_UUID, HOST, mock_rest

USER_INPUT = {CONF_HOST: HOST, CONF_REST_PORT: 8000, CONF_MQTT_PORT: 8080}
PROBE = "custom_components.controlfreak.config_flow.async_probe"


@pytest.fixture(autouse=True)
def no_setup():
    with patch("custom_components.controlfreak.async_setup_entry", return_value=True):
        yield


async def _start(hass: HomeAssistant):
    return await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})


async def test_success(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    mock_rest(aioclient_mock)
    result = await _start(hass)
    assert result["type"] is FlowResultType.FORM
    with patch(PROBE, AsyncMock()) as probe:
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {**USER_INPUT, CONF_HOST: f"  {HOST} "}
        )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == USER_INPUT
    assert result["result"].unique_id == CONTROLLER_UUID
    probe.assert_awaited_once_with(HOST, 8080)
    # Only GETs: the flow never writes to the panel.
    assert {m for m, *_ in aioclient_mock.mock_calls} == {"GET"}


@pytest.mark.parametrize(
    "host",
    [
        "http://panel.test",
        "panel.test/docs",
        "panel.test:8000",
        "user@panel.test",
        "panel.test?x=1",
        "panel test",
        "",
    ],
)
async def test_invalid_host_never_requested(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, host: str
) -> None:
    """Anything but a bare hostname or IPv4 is refused before any request is made."""
    mock_rest(aioclient_mock)
    result = await _start(hass)
    with patch(PROBE, AsyncMock()) as probe:
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {**USER_INPUT, CONF_HOST: host}
        )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_host"}
    assert aioclient_mock.call_count == 0
    probe.assert_not_awaited()


@pytest.mark.parametrize("host", ["192.0.2.10", "controlfreak.local", "panel-2.lan."])
def test_valid_hosts(host: str) -> None:
    assert HOST_RE.match(host)


async def test_unique_id_falls_back_to_host(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    mock_rest(aioclient_mock)
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{BASE}/health", json={"name": "ControlFreak", "status": "healthy"})
    aioclient_mock.get(f"{BASE}/controller-config", status=500)
    result = await _start(hass)
    with patch(PROBE, AsyncMock()):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)
    assert result["result"].unique_id == HOST


async def test_bad_host(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(f"{BASE}/health", exc=aiohttp.ClientConnectionError())
    result = await _start(hass)
    with patch(PROBE, AsyncMock()) as probe:
        result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "cannot_connect"}
    probe.assert_not_awaited()


async def test_not_controlfreak(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(f"{BASE}/health", json={"status": "ok"})
    result = await _start(hass)
    with patch(PROBE, AsyncMock()):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)
    assert result["errors"] == {"base": "not_controlfreak"}


async def test_mqtt_down_then_recovers(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    mock_rest(aioclient_mock)
    result = await _start(hass)
    with patch(PROBE, AsyncMock(side_effect=MqttCannotConnect)):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)
    assert result["errors"] == {"base": "mqtt_cannot_connect"}
    with patch(PROBE, AsyncMock()):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_already_configured(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, config_entry: MockConfigEntry
) -> None:
    config_entry.add_to_hass(hass)
    mock_rest(aioclient_mock)
    result = await _start(hass)
    with patch(PROBE, AsyncMock()):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_same_panel_new_address_updates_entry(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, config_entry: MockConfigEntry
) -> None:
    """Same controller uuid behind a new DHCP address: abort and update the host."""
    config_entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(config_entry, data={**config_entry.data, "host": "old"})
    mock_rest(aioclient_mock)
    result = await _start(hass)
    with patch(PROBE, AsyncMock()):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)
    assert result["reason"] == "already_configured"
    assert config_entry.data[CONF_HOST] == HOST


async def test_options_flow(hass: HomeAssistant, config_entry: MockConfigEntry) -> None:
    config_entry.add_to_hass(hass)
    result = await hass.config_entries.options.async_init(config_entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_SCAN_INTERVAL: 120}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert config_entry.options == {CONF_SCAN_INTERVAL: 120}
