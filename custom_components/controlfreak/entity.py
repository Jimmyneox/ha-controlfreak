"""Base entity and the dynamic add helper shared by every platform."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.core import CALLBACK_TYPE, callback
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .coordinator import ControlFreakCoordinator
from .mapping import DeviceSetting, EntitySpec


@callback
def async_setup_dynamic(
    coordinator: ControlFreakCoordinator,
    platform: str,
    factory: Callable[[ControlFreakCoordinator, EntitySpec], Entity],
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add this platform's entities now and whenever discovery finds new ones."""
    known: set[str] = set()

    @callback
    def _add() -> None:
        current = {s.key: s for s in coordinator.specs if s.platform == platform}
        known.intersection_update(current)  # a removed key may come back later
        new = [spec for key, spec in current.items() if key not in known]
        if new:
            known.update(spec.key for spec in new)
            async_add_entities(factory(coordinator, spec) for spec in new)

    _add()
    coordinator.config_entry.async_on_unload(coordinator.async_add_listener(_add))


class ControlFreakEntity(CoordinatorEntity[ControlFreakCoordinator]):
    """An entity fed by one controller/<x>/status topic."""

    _attr_has_entity_name = True
    _expire_after: int | None = None

    def __init__(self, coordinator: ControlFreakCoordinator, spec: EntitySpec) -> None:
        super().__init__(coordinator)
        self.spec = spec
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_{spec.key}"
        self._attr_device_info = coordinator.device_info
        self._expired = False
        self._unsub_expire: CALLBACK_TYPE | None = None
        if spec.setting_uuid and (setting := self.setting):
            if spec.key == spec.setting_uuid:
                self._attr_name = setting.name
            else:
                self._attr_translation_placeholders = {"name": setting.name}

    @property
    def setting(self) -> DeviceSetting | None:
        if self.spec.setting_uuid is None or self.coordinator.data is None:
            return None
        return self.coordinator.data.settings.get(self.spec.setting_uuid)

    @property
    def status(self) -> dict[str, Any] | None:
        st = self.coordinator.statuses.get(self.spec.base_topic)
        return st.payload if st else None

    @property
    def meta(self) -> dict[str, Any]:
        meta = (self.status or {}).get("meta")
        return meta if isinstance(meta, dict) else {}

    @property
    def available(self) -> bool:
        if self.spec.setting_uuid is not None and self.setting is None:
            return False
        return self.coordinator.mqtt_connected and self.status is not None and not self._expired

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            self.coordinator.async_add_status_listener(self.spec.base_topic, self._handle_status)
        )
        self.async_on_remove(self._cancel_expire)
        if (st := self.coordinator.statuses.get(self.spec.base_topic)) is not None:
            age = (dt_util.utcnow() - st.received).total_seconds()
            self._arm_expire(age)

    @callback
    def _handle_status(self) -> None:
        self._arm_expire(0)
        self.async_write_ha_state()

    @callback
    def _arm_expire(self, age: float) -> None:
        self._cancel_expire()
        self._expired = False
        if self._expire_after is None:
            return
        remaining = self._expire_after - age
        if remaining <= 0:
            self._expired = True
            return
        self._unsub_expire = async_call_later(self.hass, remaining, self._expire)

    @callback
    def _expire(self, _now: Any) -> None:
        self._unsub_expire = None
        self._expired = True
        self.async_write_ha_state()

    @callback
    def _cancel_expire(self) -> None:
        if self._unsub_expire is not None:
            self._unsub_expire()
            self._unsub_expire = None


def by_kind(
    kinds: dict[str, Callable[[ControlFreakCoordinator, EntitySpec], Entity]],
) -> Callable[[ControlFreakCoordinator, EntitySpec], Entity]:
    """Dispatch a spec to the entity class registered for its kind."""

    def factory(coordinator: ControlFreakCoordinator, spec: EntitySpec) -> Entity:
        return kinds[spec.kind](coordinator, spec)

    return factory
