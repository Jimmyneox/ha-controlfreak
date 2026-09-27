"""Config and options flow for Control Freak."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlowWithReload,
)
from homeassistant.const import CONF_HOST
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import voluptuous as vol

from .api import CannotConnect, ControlFreakApi, NotControlFreak
from .const import (
    CONF_MQTT_PORT,
    CONF_REST_PORT,
    CONF_SCAN_INTERVAL,
    DEFAULT_MQTT_PORT,
    DEFAULT_REST_PORT,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    LOGGER,
)
from .mqtt import MqttCannotConnect, async_probe

PORT = vol.All(vol.Coerce(int), vol.Range(min=1, max=65535))

USER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_HOST): str,
        vol.Required(CONF_REST_PORT, default=DEFAULT_REST_PORT): PORT,
        vol.Required(CONF_MQTT_PORT, default=DEFAULT_MQTT_PORT): PORT,
    }
)

OPTIONS_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_SCAN_INTERVAL, default=DEFAULT_SCAN_INTERVAL): vol.All(
            vol.Coerce(int), vol.Range(min=10, max=3600)
        ),
    }
)


class ControlFreakConfigFlow(ConfigFlow, domain=DOMAIN):
    """Host + ports; validated with GET /health and one MQTT-WS connect."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input[CONF_HOST].strip()
            data = {**user_input, CONF_HOST: host}
            self._async_abort_entries_match({CONF_HOST: host})
            api = ControlFreakApi(async_get_clientsession(self.hass), host, data[CONF_REST_PORT])
            try:
                await api.async_get_health()
                await async_probe(host, data[CONF_MQTT_PORT])
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except NotControlFreak:
                errors["base"] = "not_controlfreak"
            except MqttCannotConnect:
                errors["base"] = "mqtt_cannot_connect"
            except Exception:
                LOGGER.exception("Unexpected error validating the panel")
                errors["base"] = "unknown"
            else:
                await self.async_set_unique_id(await api.async_get_controller_uuid() or host)
                self._abort_if_unique_id_configured(updates=data)
                return self.async_create_entry(
                    title="Control Freak Automated Pool System", data=data
                )

        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(USER_SCHEMA, user_input),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> ControlFreakOptionsFlow:
        return ControlFreakOptionsFlow()


class ControlFreakOptionsFlow(OptionsFlowWithReload):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(
                OPTIONS_SCHEMA, self.config_entry.options
            ),
        )
