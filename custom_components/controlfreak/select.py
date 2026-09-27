"""Pump mode select, offered only over the modes the pump's setting enables.

The command shape here is INFERRED (the pump speed payload with a different
"mode"); the vendor app was only captured sending mode "pool".
"""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import ControlFreakConfigEntry
from .entity import ControlFreakEntity, async_setup_dynamic
from .mapping import pump_speed

PARALLEL_UPDATES = 1


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ControlFreakConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_setup_dynamic(
        entry.runtime_data, "select", ControlFreakPumpModeSelect, async_add_entities
    )


class ControlFreakPumpModeSelect(ControlFreakEntity, SelectEntity):
    _attr_translation_key = "pump_mode_select"

    @property
    def options(self) -> list[str]:
        s = self.setting
        return list(s.modes) if s else []

    @property
    def current_option(self) -> str | None:
        mode = self.meta.get("mode")
        return mode if mode in self.options else None

    async def async_select_option(self, option: str) -> None:
        speed = pump_speed(self.meta)
        await self.coordinator.async_publish(
            self.spec.command_topic or "",
            {"pump_speed": str(speed) if speed else "inactive", "mode": option, "sender": "user"},
        )
