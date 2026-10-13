"""The Control Freak pool controller integration (unofficial, local only)."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import DOMAIN, FRONTEND_URL
from .coordinator import ControlFreakConfigEntry, ControlFreakCoordinator

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.FAN,
    Platform.LIGHT,
    Platform.SELECT,
    Platform.SENSOR,
    Platform.SWITCH,
]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the dashboard strategy (custom:controlfreak) to every frontend page."""
    integration = await async_get_integration(hass, DOMAIN)
    strategy = Path(__file__).parent / "frontend" / "controlfreak-strategy.js"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_URL, str(strategy), cache_headers=False)]
    )
    # The version query busts the browser cache after an upgrade.
    add_extra_js_url(hass, f"{FRONTEND_URL}?v={integration.version}")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ControlFreakConfigEntry) -> bool:
    coordinator = ControlFreakCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    await coordinator.async_start_mqtt()
    entry.async_on_unload(coordinator.async_stop_mqtt)

    @callback
    def _remove_stale() -> None:
        """A setting that disappeared from /device-settings loses its entities."""
        if not coordinator.last_update_success:
            return
        expected = {(s.platform, f"{entry.entry_id}_{s.key}") for s in coordinator.specs}
        registry = er.async_get(hass)
        for reg in er.async_entries_for_config_entry(registry, entry.entry_id):
            if (reg.domain, reg.unique_id) not in expected:
                registry.async_remove(reg.entity_id)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(coordinator.async_add_listener(_remove_stale))
    _remove_stale()
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ControlFreakConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
