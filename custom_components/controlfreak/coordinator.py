"""Coordinator: REST discovery on a poll, MQTT statuses pushed in between."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import json
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import ControlFreakApi, ControlFreakError
from .const import (
    CONF_MQTT_PORT,
    CONF_REST_PORT,
    CONF_SCAN_INTERVAL,
    DEFAULT_MQTT_PORT,
    DEFAULT_REST_PORT,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    LOGGER,
    MANUFACTURER,
)
from .mapping import DeviceSetting, EntitySpec, build_specs, parse_settings
from .mqtt import ControlFreakMqtt


@dataclass(slots=True)
class ControlFreakData:
    settings: dict[str, DeviceSetting]
    raw_settings: list[dict[str, Any]]
    version: str | None
    pump_models: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class Status:
    payload: dict[str, Any]
    received: datetime


type ControlFreakConfigEntry = ConfigEntry[ControlFreakCoordinator]


class ControlFreakCoordinator(DataUpdateCoordinator[ControlFreakData]):
    """Owns the REST client, the MQTT client and the latest status per topic."""

    config_entry: ControlFreakConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ControlFreakConfigEntry) -> None:
        super().__init__(
            hass,
            LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=timedelta(
                seconds=entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
            ),
        )
        host = entry.data[CONF_HOST]
        self.rest_port = entry.data.get(CONF_REST_PORT, DEFAULT_REST_PORT)
        self.api = ControlFreakApi(async_get_clientsession(hass), host, self.rest_port)
        self.mqtt = ControlFreakMqtt(
            hass,
            host,
            entry.data.get(CONF_MQTT_PORT, DEFAULT_MQTT_PORT),
            self._handle_message,
            self._handle_connection_change,
        )
        self.statuses: dict[str, Status] = {}
        self._status_listeners: dict[str, list[Callable[[], None]]] = {}
        self._pump_models: dict[str, str] = {}
        self.specs: list[EntitySpec] = []

    # REST --------------------------------------------------------------

    async def _async_setup(self) -> None:
        try:
            self._pump_models = await self.api.async_get_pump_models()
        except ControlFreakError:
            self._pump_models = {}

    async def _async_update_data(self) -> ControlFreakData:
        try:
            health = await self.api.async_get_health()
            raw = await self.api.async_get_device_settings()
        except ControlFreakError as err:
            raise UpdateFailed(str(err)) from err
        settings = parse_settings(raw)
        self.specs = build_specs(settings, self.status_payloads())
        return ControlFreakData(
            settings=settings,
            raw_settings=raw,
            version=health.get("version"),
            pump_models=self._pump_models,
        )

    # MQTT --------------------------------------------------------------

    async def async_start_mqtt(self) -> None:
        await self.mqtt.async_start(self.config_entry)

    async def async_stop_mqtt(self) -> None:
        await self.mqtt.async_stop()

    @property
    def mqtt_connected(self) -> bool:
        return self.mqtt.connected

    @callback
    def _handle_connection_change(self, connected: bool) -> None:
        self.async_update_listeners()

    @callback
    def _handle_message(self, topic: str, payload: bytes) -> None:
        """Store controller/<x>/status payloads; anything else is ignored."""
        if not topic.endswith("/status"):
            return
        try:
            data = json.loads(payload)
        except ValueError:
            LOGGER.debug("Ignoring non-JSON payload on %s", topic)
            return
        if not isinstance(data, dict):
            return
        base = topic.removesuffix("status")
        self.statuses[base] = Status(data, dt_util.utcnow())
        for listener in list(self._status_listeners.get(base, ())):
            listener()

    def status_payloads(self) -> dict[str, dict[str, Any]]:
        return {base: st.payload for base, st in self.statuses.items()}

    @callback
    def async_add_status_listener(self, base: str, listener: Callable[[], None]) -> CALLBACK_TYPE:
        self._status_listeners.setdefault(base, []).append(listener)

        @callback
        def _remove() -> None:
            self._status_listeners[base].remove(listener)

        return _remove

    async def async_publish(self, topic: str, payload: dict[str, Any]) -> None:
        await self.mqtt.async_publish(topic, payload)

    # Device ------------------------------------------------------------

    @property
    def device_info(self) -> DeviceInfo:
        entry = self.config_entry
        return DeviceInfo(
            identifiers={(DOMAIN, entry.unique_id or entry.entry_id)},
            name=entry.title or "Control Freak",
            manufacturer=MANUFACTURER,
            model="ControlFreak panel",
            sw_version=self.data.version if self.data else None,
            configuration_url=f"http://{entry.data[CONF_HOST]}:{self.rest_port}/docs",
        )
