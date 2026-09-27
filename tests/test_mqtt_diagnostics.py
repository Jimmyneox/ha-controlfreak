"""The real MQTT client (with aiomqtt mocked) and the diagnostics redaction."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import aiomqtt
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.controlfreak import mqtt as cf_mqtt
from custom_components.controlfreak.diagnostics import async_get_config_entry_diagnostics

from .conftest import FakeMqtt


class _Msg:
    def __init__(self, topic: str, payload: Any) -> None:
        self.topic = topic
        self.payload = payload


class _FakeClient:
    """Async-context aiomqtt stand-in that yields scripted messages then drops."""

    def __init__(self, messages: list[_Msg], fail_enter: bool = False) -> None:
        self._messages = messages
        self._fail_enter = fail_enter
        self.subscribe = AsyncMock()
        self.publish = AsyncMock()

    async def __aenter__(self) -> _FakeClient:
        if self._fail_enter:
            raise aiomqtt.MqttError("refused")
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    @property
    def messages(self):
        async def gen():
            for m in self._messages:
                yield m
            raise aiomqtt.MqttError("dropped")

        return gen()


async def test_client_uses_websockets_and_subscribes(hass: HomeAssistant) -> None:
    with patch.object(cf_mqtt.aiomqtt, "Client") as client_cls:
        cf_mqtt._client("panel.test", 8080)
    kwargs = client_cls.call_args.kwargs
    assert client_cls.call_args.args == ("panel.test", 8080)
    assert kwargs["transport"] == "websockets"
    assert kwargs["websocket_path"] == "/"


async def test_run_loop_delivers_reconnects_and_publishes(hass: HomeAssistant) -> None:
    received: list[tuple[str, bytes]] = []
    changes: list[bool] = []
    first = _FakeClient([_Msg("controller/status", b'{"status":"active"}')])
    second = _FakeClient([], fail_enter=True)
    clients = iter([first, second])
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)
        if len(sleeps) >= 2:
            raise asyncio.CancelledError

    client = cf_mqtt.ControlFreakMqtt(
        hass, "panel.test", 8080, lambda t, p: received.append((t, p)), changes.append
    )
    with (
        patch.object(cf_mqtt, "_client", side_effect=lambda *a, **k: next(clients)),
        patch.object(cf_mqtt.asyncio, "sleep", fake_sleep),
        pytest.raises(asyncio.CancelledError),
    ):
        await client._run()
    first.subscribe.assert_awaited_once_with("controller/#")
    assert received == [("controller/status", b'{"status":"active"}')]
    assert changes == [True, False]
    assert sleeps == [1.0, 2.0]  # exponential backoff

    with pytest.raises(HomeAssistantError):
        await client.async_publish("controller/pump1/state", {"pump_speed": "40"})
    client._client = first  # type: ignore[assignment]
    client.connected = True
    await client.async_publish("controller/pump1/state", {"pump_speed": "40", "mode": "pool"})
    topic, body = first.publish.await_args.args
    assert topic == "controller/pump1/state"
    assert json.loads(body) == {"pump_speed": "40", "mode": "pool"}
    assert first.publish.await_args.kwargs == {"qos": 0, "retain": False}


async def test_probe_maps_errors() -> None:
    with (
        patch.object(cf_mqtt, "_client", return_value=_FakeClient([], fail_enter=True)),
        pytest.raises(cf_mqtt.MqttCannotConnect),
    ):
        await cf_mqtt.async_probe("panel.test", 8080)
    with patch.object(cf_mqtt, "_client", return_value=_FakeClient([])):
        await cf_mqtt.async_probe("panel.test", 8080)


async def test_diagnostics_redacts_host_and_secrets(
    hass: HomeAssistant, setup_integration: FakeMqtt, config_entry: MockConfigEntry
) -> None:
    setup_integration.inject(
        "controller/status",
        {"status": "active", "meta": {"last_connected_wifi": "HomeNet", "thing_name": "cf-1"}},
    )
    diag = await async_get_config_entry_diagnostics(hass, config_entry)
    text = json.dumps(diag)
    assert "panel.test" not in text
    assert "HomeNet" not in text
    assert "cf-1" not in text
    assert diag["entry"]["data"]["host"] == "**REDACTED**"
    assert len(diag["entities"]) == 11
    assert diag["mqtt_connected"] is True


def test_encode_is_compact() -> None:
    assert cf_mqtt.encode({"a": 1, "b": "x"}) == '{"a":1,"b":"x"}'


def test_fake_matches_real_interface() -> None:
    """The fake must not drift from the real client's public surface."""
    for name in ("async_start", "async_stop", "async_publish", "connected"):
        assert hasattr(FakeMqtt(MagicMock(), "h", 1, print, print), name)
        assert name in dir(cf_mqtt.ControlFreakMqtt) or name == "connected"
