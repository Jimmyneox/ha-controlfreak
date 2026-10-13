"""Colour-capable relays (e.g. Pentair/Hayward/Jandy lights) as lights with effects."""

from __future__ import annotations

from typing import Any

from homeassistant.components.light import ATTR_EFFECT, ColorMode, LightEntity, LightEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import ControlFreakConfigEntry
from .entity import ControlFreakEntity, async_setup_dynamic
from .mapping import DEFAULT_EFFECTS, light_effects, relay_is_on

PARALLEL_UPDATES = 1


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ControlFreakConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_setup_dynamic(entry.runtime_data, "light", ControlFreakLight, async_add_entities)


class ControlFreakLight(ControlFreakEntity, LightEntity):
    """Command {"state","mode":"not-syncing"[,"color_choice"],"sender":"user"}."""

    _attr_translation_key = "light"
    _attr_color_mode = ColorMode.ONOFF
    _attr_supported_color_modes = {ColorMode.ONOFF}
    _attr_supported_features = LightEntityFeature.EFFECT

    @property
    def effect_list(self) -> list[str]:
        s = self.setting
        return list(light_effects(s)) if s else list(DEFAULT_EFFECTS)

    @property
    def is_on(self) -> bool | None:
        return relay_is_on(self.meta.get("relay_state"))

    @property
    def effect(self) -> str | None:
        for key in ("color_choice", "last_known_state"):
            value = self.meta.get(key)
            if isinstance(value, str) and value in self.effect_list:
                return value
        return None

    async def _send(self, on: bool, effect: str | None = None) -> None:
        payload: dict[str, Any] = {"state": "active" if on else "inactive", "mode": "not-syncing"}
        if effect is not None:
            payload["color_choice"] = effect
        payload["sender"] = "user"
        await self.coordinator.async_publish(self.spec.command_topic or "", payload)

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._send(True, kwargs.get(ATTR_EFFECT))

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._send(False)
