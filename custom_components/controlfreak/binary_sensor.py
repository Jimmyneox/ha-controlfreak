"""Panel connectivity and flow sensors."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import CONTROLLER_EXPIRE
from .coordinator import ControlFreakConfigEntry
from .entity import ControlFreakEntity, async_setup_dynamic, by_kind

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ControlFreakConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_setup_dynamic(
        entry.runtime_data,
        "binary_sensor",
        by_kind({"connectivity": ControlFreakConnectivity, "flow": ControlFreakFlow}),
        async_add_entities,
    )


class ControlFreakConnectivity(ControlFreakEntity, BinarySensorEntity):
    """On while controller/status says "active" and is < 300 s old (the panel has no LWT).

    Always available: its job is to say off when everything else is unavailable.
    """

    _expire_after = CONTROLLER_EXPIRE
    _attr_translation_key = "connectivity"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    @property
    def available(self) -> bool:
        return True

    @property
    def is_on(self) -> bool:
        return (
            self.coordinator.mqtt_connected
            and not self._expired
            and (self.status or {}).get("status") == "active"
        )


class ControlFreakFlow(ControlFreakEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.RUNNING
    _attr_icon = "mdi:waves"

    @property
    def is_on(self) -> bool | None:
        value = self.meta.get("active_flow")
        return None if value is None else bool(value)
