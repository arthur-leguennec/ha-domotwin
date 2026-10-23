"""Versioned storage of the plan, the edit overlay and the bindings."""

from __future__ import annotations

import copy
from enum import Enum
from typing import Any, Final

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import (
    SIGNAL_UPDATED,
    STORAGE_KEY,
    STORAGE_MINOR_VERSION,
    STORAGE_VERSION,
)

type StoredData = dict[str, Any]


class _Unset(Enum):
    """Marks an argument that was not given (as opposed to an explicit None)."""

    TOKEN = 0


UNSET: Final = _Unset.TOKEN


def empty_bindings() -> dict[str, Any]:
    """Return bindings with nothing bound."""
    return {"version": 1, "rooms": {}, "elements": {}}


def empty_data() -> StoredData:
    """Return the data of a fresh installation."""
    return {
        "revision": 0,
        "plan": None,
        "layout": {},
        "bindings": empty_bindings(),
        "settings": {},
    }


class RevisionConflictError(Exception):
    """Another client saved since the revision the caller started from."""

    def __init__(self, current: int) -> None:
        """Remember the current revision."""
        super().__init__(f"current revision is {current}")
        self.current = current


class DomoTwinStore(Store[StoredData]):
    """Store with migrations between storage versions."""

    async def _async_migrate_func(
        self,
        old_major_version: int,
        old_minor_version: int,
        old_data: dict[str, Any],
    ) -> StoredData:
        """Bring data written by an older version to the current shape."""
        # Version 1.1 is the first one; future migrations go here, one step at a time.
        data = empty_data()
        data.update({key: value for key, value in old_data.items() if key in data})
        return data


class DomoTwinData:
    """In-memory copy of the stored data. Every write bumps the revision."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Prepare the store."""
        self._hass = hass
        self._store = DomoTwinStore(
            hass,
            STORAGE_VERSION,
            STORAGE_KEY,
            minor_version=STORAGE_MINOR_VERSION,
            private=True,
        )
        self._data: StoredData = empty_data()

    async def async_load(self) -> None:
        """Load the stored data, or start empty."""
        stored = await self._store.async_load()
        data = empty_data()
        if isinstance(stored, dict):
            data.update({key: value for key, value in stored.items() if key in data})
        self._data = data

    @property
    def revision(self) -> int:
        """Revision of the stored data."""
        return int(self._data["revision"])

    @property
    def plan(self) -> dict[str, Any] | None:
        """The imported plan, as read, or None."""
        plan: dict[str, Any] | None = self._data["plan"]
        return plan

    @property
    def layout(self) -> dict[str, Any]:
        """The edit-mode overlay keyed by element id."""
        layout: dict[str, Any] = self._data["layout"]
        return layout

    @property
    def bindings(self) -> dict[str, Any]:
        """The bindings."""
        bindings: dict[str, Any] = self._data["bindings"]
        return bindings

    def snapshot(self) -> StoredData:
        """Return a deep copy, safe to hand out."""
        return copy.deepcopy(self._data)

    async def async_save_plan(
        self,
        *,
        plan: dict[str, Any] | _Unset | None = UNSET,
        layout: dict[str, Any] | _Unset = UNSET,
        expected_revision: int | None = None,
    ) -> int:
        """Store a new plan (None removes it) and/or overlay. Return the new revision."""
        self._check_revision(expected_revision)
        if not isinstance(plan, _Unset):
            self._data["plan"] = plan
        if not isinstance(layout, _Unset):
            self._data["layout"] = layout
        return await self._async_commit("plan")

    async def async_save_bindings(
        self, bindings: dict[str, Any], expected_revision: int | None = None
    ) -> int:
        """Store new bindings. Return the new revision."""
        self._check_revision(expected_revision)
        self._data["bindings"] = bindings
        return await self._async_commit("bindings")

    def _check_revision(self, expected_revision: int | None) -> None:
        if expected_revision is not None and expected_revision != self.revision:
            raise RevisionConflictError(self.revision)

    async def _async_commit(self, kind: str) -> int:
        self._data["revision"] = self.revision + 1
        await self._store.async_save(self._data)
        self._notify(kind)
        return self.revision

    @callback
    def _notify(self, kind: str) -> None:
        async_dispatcher_send(self._hass, SIGNAL_UPDATED, kind, self.revision)

    async def async_remove(self) -> None:
        """Delete the stored data (when the integration is removed)."""
        await self._store.async_remove()
