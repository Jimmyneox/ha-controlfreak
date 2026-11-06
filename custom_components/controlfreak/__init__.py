"""The Control Freak pool controller integration (official, local only)."""

from __future__ import annotations

from pathlib import Path

from aiohttp import web
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import HomeAssistantView
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import DOMAIN, FRONTEND_URL, PICTURE_URL, SHAPES_URL, STYLES_URL
from .coordinator import ControlFreakConfigEntry, ControlFreakCoordinator
from .mapping import PANEL_KEYS, setting_uuid_of

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.FAN,
    Platform.LIGHT,
    Platform.SENSOR,
    Platform.SWITCH,
]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the dashboard strategy and the picture card to every frontend page."""
    integration = await async_get_integration(hass, DOMAIN)
    frontend = Path(__file__).parent / "frontend"
    files = {
        FRONTEND_URL: frontend / "controlfreak-strategy.js",  # custom:controlfreak
        PICTURE_URL: frontend / "controlfreak-picture.js",  # custom:controlfreak-picture
    }
    # The styles and shapes modules are imported by the picture card: served, not loaded here.
    served = {
        **files,
        STYLES_URL: frontend / "controlfreak-picture-styles.js",
        SHAPES_URL: frontend / "controlfreak-pool-shapes.js",
    }
    by_name = {url.rsplit("/", 1)[1]: path for url, path in served.items()}
    hass.http.register_view(ControlFreakModuleView(by_name))
    # The version query busts the browser cache after an upgrade.
    for url in files:
        add_extra_js_url(hass, f"{url}?v={integration.version}")
    return True


class ControlFreakModuleView(HomeAssistantView):
    """Serve the dashboard modules so the browser revalidates them on every load.

    The picture card imports the styles and shapes modules by relative path, so
    those requests carry no version query. `Cache-Control: no-cache` makes the
    browser ask the server (ETag / Last-Modified, a 304 when unchanged) instead
    of reusing a copy from before an upgrade, which would break the card.
    """

    url = "/controlfreak/{name}"
    name = "controlfreak:module"
    requires_auth = False

    def __init__(self, files: dict[str, Path]) -> None:
        """Remember which file each module name maps to."""
        self._files = files

    async def get(self, request: web.Request, name: str) -> web.StreamResponse:
        """Return the module, or 404 for a name that is not one of ours."""
        path = self._files.get(name)
        if path is None:
            raise web.HTTPNotFound
        return web.FileResponse(path, headers={"Cache-Control": "no-cache"})


async def async_setup_entry(hass: HomeAssistant, entry: ControlFreakConfigEntry) -> bool:
    coordinator = ControlFreakCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    await coordinator.async_start_mqtt()
    entry.async_on_unload(coordinator.async_stop_mqtt)

    @callback
    def _remove_stale() -> None:
        """Prune registry entries whose setting uuid is gone from /device-settings.

        Only the setting uuid decides, never the platform: a relay that is a
        light keeps its entry (and its name, area and customisations) even on a
        refresh where it would be specced as a switch. Two one-time exceptions:
        the pump mode select retired in 0.2.1, and a relay's switch once the
        same relay has become a light.
        """
        if not coordinator.last_update_success or coordinator.data is None:
            return
        settings = coordinator.data.settings
        lights = {s.key for s in coordinator.specs if s.platform == "light"}
        prefix = f"{entry.entry_id}_"
        registry = er.async_get(hass)
        for reg in er.async_entries_for_config_entry(registry, entry.entry_id):
            key = reg.unique_id.removeprefix(prefix)
            if key in PANEL_KEYS and reg.domain != "select":
                continue
            retired = reg.domain == "select" or (reg.domain == "switch" and key in lights)
            if retired or setting_uuid_of(key) not in settings:
                registry.async_remove(reg.entity_id)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(coordinator.async_add_listener(_remove_stale))
    _remove_stale()
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ControlFreakConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
