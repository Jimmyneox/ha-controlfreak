"""Diagnostics download, with the host and any wifi/AWS fields redacted."""

from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant

from .coordinator import ControlFreakConfigEntry

TO_REDACT = {
    CONF_HOST,
    "configuration_url",
    "unique_id",
    "last_connected_wifi",
    "ssid",
    "password",
    "wifi",
    "thing_name",
    "aws_installed",
    "aws",
}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ControlFreakConfigEntry
) -> dict[str, Any]:
    coordinator = entry.runtime_data
    data = coordinator.data
    return async_redact_data(
        {
            "entry": {"data": dict(entry.data), "options": dict(entry.options)},
            "mqtt_connected": coordinator.mqtt_connected,
            "version": data.version if data else None,
            "device_settings": data.raw_settings if data else None,
            "entities": [
                {"platform": s.platform, "key": s.key, "kind": s.kind, "topic": s.base_topic}
                for s in coordinator.specs
            ],
            "statuses": {
                base: {"received": st.received.isoformat(), "payload": st.payload}
                for base, st in coordinator.statuses.items()
            },
        },
        TO_REDACT,
    )
