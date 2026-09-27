"""Temperatures, pump speed/mode and panel diagnostics."""

from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import CONTROLLER_EXPIRE, THERMISTOR_EXPIRE
from .coordinator import ControlFreakConfigEntry
from .entity import ControlFreakEntity, async_setup_dynamic, by_kind
from .mapping import pump_speed

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ControlFreakConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_setup_dynamic(
        entry.runtime_data,
        "sensor",
        by_kind(
            {
                "temperature": ControlFreakTemperature,
                "pump_speed": ControlFreakPumpSpeed,
                "pump_mode": ControlFreakPumpMode,
                "cpu_temperature": ControlFreakCpuTemperature,
                "freeze_protection": ControlFreakFreezeProtection,
                "firmware": ControlFreakFirmware,
            }
        ),
        async_add_entities,
    )


def _float(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


class ControlFreakTemperature(ControlFreakEntity, SensorEntity):
    """meta.temperature_f; unavailable unless status == "active"; stale after 180 s."""

    _expire_after = THERMISTOR_EXPIRE
    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfTemperature.FAHRENHEIT
    _attr_suggested_display_precision = 1

    @property
    def available(self) -> bool:
        return (
            super().available
            and (self.status or {}).get("status") == "active"
            and _float(self.meta.get("temperature_f")) is not None
        )

    @property
    def native_value(self) -> float | None:
        return _float(self.meta.get("temperature_f"))


class ControlFreakPumpSpeed(ControlFreakEntity, SensorEntity):
    _attr_translation_key = "pump_speed"
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        return pump_speed(self.meta)


class ControlFreakPumpMode(ControlFreakEntity, SensorEntity):
    _attr_translation_key = "pump_mode"

    @property
    def native_value(self) -> str | None:
        mode = self.meta.get("mode")
        return mode if isinstance(mode, str) else None


class ControlFreakCpuTemperature(ControlFreakEntity, SensorEntity):
    """controller/status meta.cpuTemperature, reported by the panel in °F."""

    _expire_after = CONTROLLER_EXPIRE
    _attr_translation_key = "cpu_temperature"
    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfTemperature.FAHRENHEIT
    _attr_suggested_display_precision = 1
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    @property
    def native_value(self) -> float | None:
        return _float(self.meta.get("cpuTemperature"))


class ControlFreakFreezeProtection(ControlFreakEntity, SensorEntity):
    """controller/freeze-protection/status -> status (e.g. "nominal")."""

    _attr_translation_key = "freeze_protection"

    @property
    def native_value(self) -> str | None:
        value = (self.status or {}).get("status")
        return value if isinstance(value, str) else None


class ControlFreakFirmware(ControlFreakEntity, SensorEntity):
    """API version from GET /health (REST, not MQTT)."""

    _attr_translation_key = "firmware"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    @property
    def available(self) -> bool:
        return self.coordinator.last_update_success and self.coordinator.data is not None

    @property
    def native_value(self) -> str | None:
        return self.coordinator.data.version if self.coordinator.data else None
