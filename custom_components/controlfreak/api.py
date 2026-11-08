"""Read-only REST client for the panel's local FastAPI (port 8000).

Only GET is implemented on purpose: equipment is commanded over MQTT, and the
integration never writes the panel's configuration.
"""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

# A request that never reached the panel is tried once more after this many
# seconds: on outdoor Wi-Fi a single lost packet is common.
RETRY_DELAY = 2.0


class ControlFreakError(Exception):
    """Base error."""


class CannotConnect(ControlFreakError):
    """The panel did not answer."""


class NotControlFreak(ControlFreakError):
    """Something answered, but it is not a healthy ControlFreak API."""


class ControlFreakApi:
    """GET-only access to the panel."""

    def __init__(self, session: aiohttp.ClientSession, host: str, port: int) -> None:
        self._session = session
        self._base = f"http://{host}:{port}"

    async def _get(self, path: str, *, retry: bool = True) -> Any:
        try:
            async with asyncio.timeout(10):
                resp = await self._session.get(f"{self._base}{path}")
                resp.raise_for_status()
                return await resp.json(content_type=None)
        except (TimeoutError, aiohttp.ClientConnectionError) as err:
            if retry:
                await asyncio.sleep(RETRY_DELAY)
                return await self._get(path, retry=False)
            # Never include the URL: it carries the LAN address.
            raise CannotConnect(f"GET {path} failed: {type(err).__name__}") from None
        except (aiohttp.ClientError, ValueError) as err:
            # An HTTP error or a bad body is an answer: retrying won't change it.
            raise CannotConnect(f"GET {path} failed: {type(err).__name__}") from None

    async def async_get_health(self) -> dict[str, Any]:
        """GET /health; expects {"name":"ControlFreak","status":"healthy","version":...}."""
        data = await self._get("/health")
        if (
            not isinstance(data, dict)
            or data.get("name") != "ControlFreak"
            or data.get("status") != "healthy"
        ):
            raise NotControlFreak("unexpected /health response")
        return data

    async def async_get_controller_uuid(self) -> str | None:
        """Stable panel id from GET /controller-config; wifi/aws fields are dropped here."""
        try:
            data = await self._get("/controller-config")
        except CannotConnect:
            return None
        if isinstance(data, dict) and isinstance(data.get("uuid"), str) and data["uuid"]:
            return data["uuid"]
        return None

    async def async_get_device_settings(self) -> list[dict[str, Any]]:
        data = await self._get("/device-settings")
        if not isinstance(data, list):
            raise CannotConnect("unexpected /device-settings response")
        return data

    async def async_get_pump_models(self) -> dict[str, str]:
        """uuid -> display name."""
        data = await self._get("/pump-models")
        if not isinstance(data, list):
            return {}
        return {
            m["uuid"]: m.get("name") or m.get("model") or ""
            for m in data
            if isinstance(m, dict) and m.get("uuid")
        }
