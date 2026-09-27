"""Variable-speed pump as a fan."""

from __future__ import annotations

from typing import Any

from homeassistant.components.fan import FanEntity, FanEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import ControlFreakConfigEntry
from .entity import ControlFreakEntity, async_setup_dynamic
from .mapping import percentage_to_speed, pump_speed, speed_to_percentage

PARALLEL_UPDATES = 1


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ControlFreakConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_setup_dynamic(entry.runtime_data, "fan", ControlFreakPump, async_add_entities)


class ControlFreakPump(ControlFreakEntity, FanEntity):
    """on/off + percentage; HA 1 % maps to the pump's configured minimum speed."""

    _attr_supported_features = (
        FanEntityFeature.SET_SPEED | FanEntityFeature.TURN_ON | FanEntityFeature.TURN_OFF
    )
    _last_speed: int | None = None

    @property
    def _range(self) -> tuple[int, int]:
        s = self.setting
        return (s.speed_min, s.speed_max) if s else (1, 100)

    @property
    def speed_count(self) -> int:
        low, high = self._range
        return high - low + 1

    @property
    def _speed(self) -> int:
        speed = pump_speed(self.meta)
        if speed > 0:
            self._last_speed = speed
        return speed

    @property
    def is_on(self) -> bool | None:
        return None if self.status is None else self._speed > 0

    @property
    def percentage(self) -> int | None:
        if self.status is None:
            return None
        return speed_to_percentage(self._speed, *self._range)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        s = self.setting
        if s is None or not s.pump_model_uuid or self.coordinator.data is None:
            return None
        model = self.coordinator.data.pump_models.get(s.pump_model_uuid)
        return {"pump_model": model} if model else None

    def _mode(self) -> str:
        mode = self.meta.get("mode")
        s = self.setting
        if s and isinstance(mode, str) and mode in s.modes:
            return mode
        return s.modes[0] if s and s.modes else "pool"

    async def _send(self, speed: int | None) -> None:
        await self.coordinator.async_publish(
            self.spec.command_topic or "",
            {
                "pump_speed": str(speed) if speed else "inactive",
                "mode": self._mode(),
                "sender": "user",
            },
        )

    async def async_set_percentage(self, percentage: int) -> None:
        if percentage == 0:
            await self._send(None)
            return
        await self._send(percentage_to_speed(percentage, *self._range))

    async def async_turn_on(
        self,
        percentage: int | None = None,
        preset_mode: str | None = None,
        **kwargs: Any,
    ) -> None:
        if percentage is not None:
            await self.async_set_percentage(percentage)
            return
        s = self.setting
        fallback = None
        if s and s.last_known_state and s.last_known_state.isdigit():
            fallback = int(s.last_known_state)
        low, high = self._range
        speed = self._last_speed or fallback or high
        await self._send(min(max(speed, low), high))

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._send(None)
