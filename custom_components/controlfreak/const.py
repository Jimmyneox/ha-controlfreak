"""Constants for the Control Freak integration."""

from __future__ import annotations

import logging
from typing import Final

DOMAIN: Final = "controlfreak"
LOGGER = logging.getLogger(__package__)

MANUFACTURER: Final = "Control Freak Pool Tech"

CONF_REST_PORT: Final = "rest_port"
CONF_MQTT_PORT: Final = "mqtt_port"
CONF_SCAN_INTERVAL: Final = "scan_interval"

DEFAULT_REST_PORT: Final = 8000
DEFAULT_MQTT_PORT: Final = 8080
DEFAULT_SCAN_INTERVAL: Final = 60
MQTT_WS_PATH: Final = "/"
MQTT_SUBSCRIPTION: Final = "controller/#"

# The dashboard strategy, served by the integration (see frontend/).
FRONTEND_URL: Final = "/controlfreak/controlfreak-strategy.js"

# Seconds without a publish before a value is considered stale.
# Thermistors publish every ~2 s; controller/status every ~60 s and has no LWT.
THERMISTOR_EXPIRE: Final = 180
CONTROLLER_EXPIRE: Final = 300
