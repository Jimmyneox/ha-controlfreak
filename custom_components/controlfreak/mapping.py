"""Pure mapping: panel /device-settings (+ MQTT statuses) -> the entity set.

Nothing in here touches Home Assistant state, so the whole equipment-to-entity
decision is unit-testable against the scrubbed fixtures.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import math
from typing import Any

from homeassistant.util.percentage import (
    percentage_to_ranged_value,
    ranged_value_to_percentage,
)

from .const import LOGGER

TYPE_PUMP = "Pump"
TYPE_HIGH_VOLTAGE = "HighVoltage"
TYPE_LOW_VOLTAGE = "LowVoltage"
TYPE_THERMISTOR = "Thermositor"  # sic: the panel's spelling
TYPE_FLOW = "FlowSensor"
TYPE_VALVE = "Valve"
KNOWN_TYPES = frozenset(
    {TYPE_PUMP, TYPE_HIGH_VOLTAGE, TYPE_LOW_VOLTAGE, TYPE_THERMISTOR, TYPE_FLOW, TYPE_VALVE}
)

PUMP_MODES = ("pool", "spa", "spillover")

# The Pentair colour set captured from the vendor app; used when the panel's
# connection type does not list its own properties.
DEFAULT_EFFECTS: tuple[str, ...] = (
    "Blue",
    "Green",
    "Red",
    "White",
    "Magenta",
    "SAM Mode",
    "Party Mode",
    "Romance Mode",
    "Carribbean Mode",
    "American Mode",
    "California Sunset Mode",
    "Royal Mode",
)

CONTROLLER_BASE = "controller/"
FREEZE_BASE = "controller/freeze-protection/"

KEY_CONNECTIVITY = "controller_connectivity"
KEY_CPU = "controller_cpu_temperature"
KEY_FREEZE = "controller_freeze_protection"
KEY_FIRMWARE = "controller_firmware"
PANEL_KEYS = (KEY_CONNECTIVITY, KEY_CPU, KEY_FREEZE, KEY_FIRMWARE)


@dataclass(frozen=True, slots=True)
class DeviceSetting:
    """One configured piece of equipment on the panel."""

    uuid: str
    name: str
    device_type: str
    base_topic: str  # e.g. "controller/pump1/"
    connection_type: str | None
    effect_list: tuple[str, ...]
    speed_min: int
    speed_max: int
    modes: tuple[str, ...]
    pump_model_uuid: str | None
    last_known_state: str | None
    last_known_mode: str | None

    @property
    def status_topic(self) -> str:
        return f"{self.base_topic}status"

    @property
    def command_topic(self) -> str:
        return f"{self.base_topic}state"


@dataclass(frozen=True, slots=True)
class EntitySpec:
    """What entity to create; ``key`` is the unique-id suffix after the entry id."""

    platform: str
    key: str
    kind: str
    base_topic: str
    setting_uuid: str | None = None
    command_topic: str | None = None


def _int(value: Any, default: int) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def parse_settings(raw: list[dict[str, Any]]) -> dict[str, DeviceSetting]:
    """Parse /device-settings, skipping entries we cannot map."""
    settings: dict[str, DeviceSetting] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        uuid = item.get("uuid")
        device_type = (item.get("device_type") or {}).get("name")
        topic = (item.get("topic") or {}).get("mqtt_topic")
        if not uuid or not topic:
            continue
        if device_type not in KNOWN_TYPES:
            LOGGER.debug("Skipping device setting of unknown type %s", device_type)
            continue
        base = topic if topic.endswith("/") else f"{topic}/"
        connection = item.get("connection_type") or {}
        effects = tuple(
            prop["property_name"]
            for prop in connection.get("connection_type_properties") or []
            if isinstance(prop, dict) and prop.get("property_name")
        )
        speed_min = _int(item.get("pump_speed_minimum"), 0) or 0
        speed_max = _int(item.get("pump_speed_maximum"), 100) or 100
        if speed_min <= 0 or speed_min >= speed_max:
            speed_min = 1
        settings[uuid] = DeviceSetting(
            uuid=uuid,
            name=(item.get("name") or base.rstrip("/").rsplit("/", 1)[-1]).strip(),
            device_type=device_type,
            base_topic=base,
            connection_type=connection.get("name"),
            effect_list=effects,
            speed_min=speed_min,
            speed_max=speed_max,
            modes=tuple(m for m in PUMP_MODES if item.get(f"{m}_mode") is True),
            pump_model_uuid=item.get("pump_model_uuid"),
            last_known_state=item.get("last_known_state"),
            last_known_mode=item.get("last_known_mode"),
        )
    return settings


def relay_role(setting: DeviceSetting) -> str:
    """A plain relay's configured role: "heater", "chiller" or "relay".

    Any low-voltage relay can be set up in the app as a heater or chiller with
    built-in control logic; the role is the setting's connection type (captured
    catalogue: "Gas Heater", "Heat Pump", "Chiller", "General"). The port never
    decides it.
    """
    name = (setting.connection_type or "").lower()
    if "chiller" in name:
        return "chiller"
    if "heater" in name or "heat pump" in name:
        return "heater"
    return "relay"


def light_effects(setting: DeviceSetting) -> tuple[str, ...]:
    """Effects learned from the panel, else the captured Pentair default set."""
    return setting.effect_list or DEFAULT_EFFECTS


def _is_colour_relay(setting: DeviceSetting, status: Mapping[str, Any] | None) -> bool:
    if setting.effect_list:
        return True
    names = set(DEFAULT_EFFECTS)
    if setting.last_known_state in names:
        return True
    meta = (status or {}).get("meta")
    if isinstance(meta, dict):
        if meta.get("color_choice"):
            return True
        if meta.get("last_known_state") in names:
            return True
    return False


def build_specs(
    settings: Mapping[str, DeviceSetting],
    statuses: Mapping[str, Mapping[str, Any]] | None = None,
) -> list[EntitySpec]:
    """Return every entity the panel should have right now."""
    statuses = statuses or {}
    specs: list[EntitySpec] = [
        EntitySpec("binary_sensor", KEY_CONNECTIVITY, "connectivity", CONTROLLER_BASE),
        EntitySpec("sensor", KEY_CPU, "cpu_temperature", CONTROLLER_BASE),
        EntitySpec("sensor", KEY_FREEZE, "freeze_protection", FREEZE_BASE),
        EntitySpec("sensor", KEY_FIRMWARE, "firmware", CONTROLLER_BASE),
    ]
    for s in settings.values():
        base, uid = s.base_topic, s.uuid
        match s.device_type:
            case "Pump":
                specs += [
                    EntitySpec("fan", uid, "pump", base, uid, s.command_topic),
                    EntitySpec("sensor", f"{uid}_speed", "pump_speed", base, uid),
                    EntitySpec("sensor", f"{uid}_mode", "pump_mode", base, uid),
                ]
                if s.modes:
                    specs.append(
                        EntitySpec(
                            "select",
                            f"{uid}_mode_select",
                            "pump_mode_select",
                            base,
                            uid,
                            s.command_topic,
                        )
                    )
            case "HighVoltage" | "LowVoltage":
                if _is_colour_relay(s, statuses.get(base)):
                    specs.append(EntitySpec("light", uid, "light", base, uid, s.command_topic))
                else:
                    specs.append(EntitySpec("switch", uid, "relay", base, uid, s.command_topic))
            case "Thermositor":
                specs.append(EntitySpec("sensor", uid, "temperature", base, uid))
            case "FlowSensor":
                specs.append(EntitySpec("binary_sensor", uid, "flow", base, uid))
            case "Valve":
                # Read-only in v1: the valve command shape was never captured.
                specs.append(EntitySpec("switch", uid, "valve", base, uid, None))
    return specs


def relay_is_on(value: Any) -> bool | None:
    """hv relays report int 1/0, lv relays report "active"/"inactive"."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value == 1
    text = str(value).strip().lower()
    if text in ("1", "active", "on", "true"):
        return True
    if text in ("0", "inactive", "off", "false"):
        return False
    return None


def pump_speed(meta: Mapping[str, Any] | None) -> int:
    """meta.pump_speed arrives as "100", 0 or "inactive"."""
    return max(_int((meta or {}).get("pump_speed"), 0), 0)


def speed_to_percentage(speed: int, speed_min: int, speed_max: int) -> int:
    if speed <= 0:
        return 0
    speed = min(max(speed, speed_min), speed_max)
    return ranged_value_to_percentage((speed_min, speed_max), speed)


def percentage_to_speed(percentage: int, speed_min: int, speed_max: int) -> int:
    value = math.ceil(percentage_to_ranged_value((speed_min, speed_max), percentage))
    return min(max(value, speed_min), speed_max)
