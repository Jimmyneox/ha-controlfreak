"""Plain relays (heaters, general loads) and read-only valves."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN
from .coordinator import ControlFreakConfigEntry, ControlFreakCoordinator
from .entity import ControlFreakEntity, async_setup_dynamic, by_kind
from .mapping import EntitySpec, relay_is_on, relay_role

PARALLEL_UPDATES = 1

CONNECTION_ICONS = {
    "Gas Heater": "mdi:fire",
    "Heat Pump": "mdi:heat-pump",
    "Chiller": "mdi:snowflake",
}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ControlFreakConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_setup_dynamic(
        entry.runtime_data,
        "switch",
        by_kind({"relay": ControlFreakRelay, "valve": ControlFreakValve}),
        async_add_entities,
    )


class ControlFreakRelay(ControlFreakEntity, SwitchEntity):
    """Command {"state":"active|inactive","mode":"not-syncing","sender":"user"}."""

    _attr_translation_key = "relay"

    def __init__(self, coordinator: ControlFreakCoordinator, spec: EntitySpec) -> None:
        super().__init__(coordinator, spec)
        # The role (heater / chiller / general relay) groups it on the dashboard.
        if setting := self.setting:
            self._attr_translation_key = relay_role(setting)

    @property
    def icon(self) -> str | None:
        s = self.setting
        return CONNECTION_ICONS.get(s.connection_type or "") if s else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        s = self.setting
        return {"connection_type": s.connection_type} if s and s.connection_type else None

    @property
    def is_on(self) -> bool | None:
        return relay_is_on(self.meta.get("relay_state"))

    async def _send(self, on: bool) -> None:
        await self.coordinator.async_publish(
            self.spec.command_topic or "",
            {"state": "active" if on else "inactive", "mode": "not-syncing", "sender": "user"},
        )

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._send(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._send(False)


class ControlFreakValve(ControlFreakEntity, SwitchEntity):
    """READ-ONLY in v1: the valve command shape has never been captured."""

    _attr_translation_key = "valve"
    _attr_icon = "mdi:valve"

    @property
    def is_on(self) -> bool | None:
        meta = self.meta
        return relay_is_on(meta.get("valve_state", meta.get("relay_state")))

    async def async_turn_on(self, **kwargs: Any) -> None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="valve_read_only")

    async def async_turn_off(self, **kwargs: Any) -> None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="valve_read_only")
