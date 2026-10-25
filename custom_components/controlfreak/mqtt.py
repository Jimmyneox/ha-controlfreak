"""The integration's own MQTT-over-WebSockets client (independent of HA's mqtt integration).

The panel runs an open Mosquitto broker on ws://<host>:8080/ (no TCP 1883, no auth).
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import contextlib
import json
from typing import Any
import uuid

import aiomqtt
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN, LOGGER, MQTT_SUBSCRIPTION, MQTT_WS_PATH

BACKOFF_INITIAL = 1.0
BACKOFF_MAX = 60.0
CONNECT_TIMEOUT = 10.0


class MqttCannotConnect(Exception):
    """The panel's broker refused or did not answer."""


def _client(host: str, port: int, timeout: float = CONNECT_TIMEOUT) -> aiomqtt.Client:
    return aiomqtt.Client(
        host,
        port,
        transport="websockets",
        websocket_path=MQTT_WS_PATH,
        identifier=f"ha-{DOMAIN}-{uuid.uuid4().hex[:8]}",
        keepalive=30,
        timeout=timeout,
    )


async def async_probe(host: str, port: int) -> None:
    """One connect/disconnect, for the config flow."""
    try:
        async with _client(host, port):
            pass
    except (aiomqtt.MqttError, OSError, TimeoutError) as err:
        raise MqttCannotConnect(type(err).__name__) from None


def encode(payload: dict[str, Any]) -> str:
    """Compact JSON, the shape the vendor app sends."""
    return json.dumps(payload, separators=(",", ":"))


class ControlFreakMqtt:
    """Long-lived subscription with reconnect/backoff and a publish method."""

    def __init__(
        self,
        hass: HomeAssistant,
        host: str,
        port: int,
        on_message: Callable[[str, bytes], None],
        on_connection_change: Callable[[bool], None],
    ) -> None:
        self._hass = hass
        self._host = host
        self._port = port
        self._on_message = on_message
        self._on_connection_change = on_connection_change
        self._client: aiomqtt.Client | None = None
        self._task: asyncio.Task[None] | None = None
        self.connected = False

    async def async_start(self, entry: ConfigEntry) -> None:
        self._task = entry.async_create_background_task(
            self._hass, self._run(), f"{DOMAIN} mqtt {entry.entry_id}"
        )

    async def async_stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        self._set_connected(False)

    def _set_connected(self, value: bool) -> None:
        if value != self.connected:
            self.connected = value
            self._on_connection_change(value)

    async def _run(self) -> None:
        backoff = BACKOFF_INITIAL
        while True:
            try:
                async with _client(self._host, self._port) as client:
                    await client.subscribe(MQTT_SUBSCRIPTION)
                    self._client = client
                    self._set_connected(True)
                    LOGGER.debug("Connected to panel broker")
                    backoff = BACKOFF_INITIAL
                    async for message in client.messages:
                        payload = message.payload
                        if isinstance(payload, str):
                            payload = payload.encode()
                        if isinstance(payload, (bytes, bytearray)):
                            self._on_message(str(message.topic), bytes(payload))
            except (aiomqtt.MqttError, OSError, TimeoutError) as err:
                LOGGER.debug("Panel broker connection lost (%s)", type(err).__name__)
            finally:
                self._client = None
                self._set_connected(False)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX)

    async def async_publish(self, topic: str, payload: dict[str, Any]) -> None:
        client = self._client
        if client is None or not self.connected:
            raise HomeAssistantError("Control Freak panel broker is not connected")
        try:
            await client.publish(topic, encode(payload), qos=0, retain=False)
        except aiomqtt.MqttError as err:
            raise HomeAssistantError(f"Publish failed: {type(err).__name__}") from err
