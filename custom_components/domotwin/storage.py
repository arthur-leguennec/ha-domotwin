"""Versioned storage of the storeys (a plan and its overlay each), the bindings, the settings."""

from __future__ import annotations

import copy
from enum import Enum
import logging
from typing import Any, Final

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import (
    PLAN_FORMAT,
    SIGNAL_UPDATED,
    STORAGE_KEY,
    STORAGE_MINOR_VERSION,
    STORAGE_VERSION,
)

type StoredData = dict[str, Any]

_LOGGER = logging.getLogger(__name__)


class _Unset(Enum):
    """Marks an argument that was not given (as opposed to an explicit None)."""

    TOKEN = 0


UNSET: Final = _Unset.TOKEN

# What a save changes. Each kind is checked against the revision of its own last write, so that
# saving the bindings or the settings does not refuse an edit of the plan started before.
KINDS: Final = ("plan", "bindings", "settings")


def empty_bindings() -> dict[str, Any]:
    """Return bindings with nothing bound."""
    return {"version": 1, "rooms": {}, "elements": {}}


def empty_data() -> StoredData:
    """Return the data of a fresh installation."""
    return {
        "revision": 0,
        "storeys": [],
        "bindings": empty_bindings(),
        "settings": {},
        "revisions": {},
        "retired": [],
    }


def normalise(stored: dict[str, Any]) -> StoredData:
    """Return the stored data in the current shape.

    Known keys only; the single plan of version 1.1 (`plan`, `layout`) becomes the first storey.
    """
    data = empty_data()
    data.update({key: value for key, value in stored.items() if key in data})
    if not isinstance(stored.get("storeys"), list):
        plan = stored.get("plan")
        layout = stored.get("layout")
        data["storeys"] = (
            [
                {
                    "id": "storey-1",
                    "name": "",
                    "elevation": 0,
                    "plan": plan,
                    "layout": layout if isinstance(layout, dict) else {},
                }
            ]
            if isinstance(plan, dict)
            else []
        )
    if not isinstance(data["revisions"], dict):
        data["revisions"] = {}
    if not isinstance(data["retired"], list):
        data["retired"] = []
    return data


def retire_foreign_plans(data: StoredData) -> int:
    """Set aside the storeys whose plan is not in DomoTwin's format (storage 1.x and 2.x).

    They move, overlays and all, to `retired`, which nothing reads: the user's work is kept in the
    stored data, not shown. Links keyed by their ids stay, unused, until a plan has them again.
    Return how many storeys were set aside.
    """
    kept: list[Any] = []
    retired: list[Any] = []
    for storey in data["storeys"]:
        plan = storey.get("plan") if isinstance(storey, dict) else None
        if isinstance(plan, dict) and plan.get("format") == PLAN_FORMAT:
            kept.append(storey)
        elif plan is not None:
            retired.append(storey)
    data["storeys"] = kept
    data["retired"].extend(retired)
    return len(retired)


class UnknownStoreyError(Exception):
    """No storey has the id given."""


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
        # 1.x: the plan and its overlay become the first storey.
        data = normalise(old_data)
        # 1.x and 2.x: plans in a format DomoTwin no longer reads are set aside. The revision
        # moves on, so that drafts browsers kept in that format are not offered again.
        if old_major_version >= 3:
            return data
        data["revision"] = int(data["revision"]) + 1
        data["revisions"] = dict.fromkeys(KINDS, data["revision"])
        if retired := retire_foreign_plans(data):
            _LOGGER.warning(
                "%s stored plan(s) were not in DomoTwin's plan format: they are set aside in "
                "the stored data (`retired`), and can be imported again as .domotwin.json files "
                "(docs/plan-format.md)",
                retired,
            )
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
        data = normalise(stored if isinstance(stored, dict) else {})
        for kind in KINDS:
            data["revisions"].setdefault(kind, data["revision"])
        self._data = data

    @property
    def revision(self) -> int:
        """Revision of the stored data."""
        return int(self._data["revision"])

    def revision_of(self, kind: str) -> int:
        """Revision of the last write of `kind` (`plan` for the plan and the overlay)."""
        return int(self._data["revisions"].get(kind, self.revision))

    @property
    def storeys(self) -> list[dict[str, Any]]:
        """The storeys, lowest first: `id`, `name`, `elevation` (cm), `plan`, `layout`."""
        storeys: list[dict[str, Any]] = self._data["storeys"]
        return sorted(storeys, key=lambda storey: float(storey.get("elevation", 0)))

    def storey(self, storey_id: str | None = None) -> dict[str, Any] | None:
        """Storey `storey_id`, or the ground floor; None when there is none.

        The ground floor is the storey whose floor is nearest elevation 0 (the lower one of two as
        near). Raises UnknownStoreyError for an id no storey has.
        """
        if storey_id is not None:
            return self._by_id(storey_id)
        storeys = self.storeys
        if not storeys:
            return None
        return min(storeys, key=lambda storey: abs(float(storey.get("elevation", 0))))

    def _by_id(self, storey_id: str) -> dict[str, Any]:
        storeys: list[dict[str, Any]] = self._data["storeys"]
        for storey in storeys:
            if storey["id"] == storey_id:
                return storey
        raise UnknownStoreyError(storey_id)

    @property
    def plan(self) -> dict[str, Any] | None:
        """The plan of the ground floor, or None."""
        storey = self.storey()
        return storey["plan"] if storey else None

    @property
    def layout(self) -> dict[str, Any]:
        """The edit-mode overlay of the ground floor, keyed by element id."""
        storey = self.storey()
        return storey["layout"] if storey else {}

    @property
    def retired(self) -> list[dict[str, Any]]:
        """Storeys set aside when their plan's format was dropped (D-030); nothing shows them."""
        retired: list[dict[str, Any]] = self._data["retired"]
        return retired

    @property
    def bindings(self) -> dict[str, Any]:
        """The bindings."""
        bindings: dict[str, Any] = self._data["bindings"]
        return bindings

    @property
    def settings(self) -> dict[str, Any]:
        """The home's settings (where north points on the plan)."""
        settings: dict[str, Any] = self._data["settings"]
        return settings

    def snapshot(self) -> StoredData:
        """Return a deep copy, safe to hand out."""
        return copy.deepcopy(self._data)

    async def async_save_plan(
        self,
        *,
        plan: dict[str, Any] | _Unset | None = UNSET,
        layout: dict[str, Any] | _Unset = UNSET,
        storey: str | None = None,
        expected_revision: int | None = None,
    ) -> int:
        """Store the plan and/or overlay of a storey. Return the new revision.

        The storey is `storey`, else the ground floor; the first storey is made when there is
        none. A plan None removes the storey.
        """
        self._check_revision("plan", expected_revision)
        target = self.storey(storey)
        if target is None:
            if not isinstance(plan, dict):
                # Nothing to remove, or an overlay without a plan.
                return await self._async_commit("plan")
            target = self._new_storey("", 0)
        if plan is None:
            self._data["storeys"].remove(target)
            return await self._async_commit("plan")
        if not isinstance(plan, _Unset):
            target["plan"] = plan
        if not isinstance(layout, _Unset):
            target["layout"] = layout
        return await self._async_commit("plan")

    async def async_save_storey(  # noqa: PLR0913 - the fields of the command, all keyword-only
        self,
        *,
        storey: str | None = None,
        name: str | _Unset = UNSET,
        elevation: float | _Unset = UNSET,
        plan: dict[str, Any] | _Unset = UNSET,
        layout: dict[str, Any] | _Unset = UNSET,
        expected_revision: int | None = None,
    ) -> tuple[int, str]:
        """Store a storey. Return the new revision and the storey's id.

        A new one without `storey` (its plan is needed), else its name, elevation, plan or overlay.
        """
        self._check_revision("plan", expected_revision)
        if storey is None:
            if not isinstance(plan, dict):
                raise ValueError("a new storey needs a plan")
            target = self._new_storey(
                "" if isinstance(name, _Unset) else name,
                0 if isinstance(elevation, _Unset) else elevation,
            )
        else:
            target = self._by_id(storey)
        if not isinstance(name, _Unset):
            target["name"] = name
        if not isinstance(elevation, _Unset):
            target["elevation"] = elevation
        if not isinstance(plan, _Unset):
            target["plan"] = plan
        if not isinstance(layout, _Unset):
            target["layout"] = layout
        return await self._async_commit("plan"), target["id"]

    async def async_remove_storey(self, storey: str, expected_revision: int | None = None) -> int:
        """Remove a storey. Return the new revision."""
        self._check_revision("plan", expected_revision)
        self._data["storeys"].remove(self._by_id(storey))
        return await self._async_commit("plan")

    async def async_replace_storeys(
        self, storeys: list[dict[str, Any]], expected_revision: int | None = None
    ) -> tuple[int, list[str]]:
        """Replace every storey (`name`, `elevation`, `plan` each), in one write.

        Their ids are given in order (`storey-1`, `storey-2`…), their overlays empty. Return the new
        revision and the ids.
        """
        self._check_revision("plan", expected_revision)
        self._data["storeys"] = [
            {
                "id": f"storey-{number}",
                "name": storey["name"],
                "elevation": storey["elevation"],
                "plan": storey["plan"],
                "layout": {},
            }
            for number, storey in enumerate(storeys, start=1)
        ]
        ids = [storey["id"] for storey in self._data["storeys"]]
        return await self._async_commit("plan"), ids

    def _new_storey(self, name: str, elevation: float) -> dict[str, Any]:
        taken = {storey["id"] for storey in self._data["storeys"]}
        number = 1
        while f"storey-{number}" in taken:
            number += 1
        target: dict[str, Any] = {
            "id": f"storey-{number}",
            "name": name,
            "elevation": elevation,
            "plan": None,
            "layout": {},
        }
        self._data["storeys"].append(target)
        return target

    async def async_save_bindings(
        self, bindings: dict[str, Any], expected_revision: int | None = None
    ) -> int:
        """Store new bindings. Return the new revision."""
        self._check_revision("bindings", expected_revision)
        self._data["bindings"] = bindings
        return await self._async_commit("bindings")

    async def async_save_settings(self, settings: dict[str, Any]) -> int:
        """Store new settings. Return the new revision."""
        self._data["settings"] = settings
        return await self._async_commit("settings")

    def _check_revision(self, kind: str, expected_revision: int | None) -> None:
        current = self.revision_of(kind)
        if expected_revision is not None and expected_revision != current:
            raise RevisionConflictError(current)

    async def _async_commit(self, kind: str) -> int:
        self._data["revision"] = self.revision + 1
        self._data["revisions"][kind] = self.revision
        await self._store.async_save(self._data)
        self._notify(kind)
        return self.revision

    @callback
    def _notify(self, kind: str) -> None:
        async_dispatcher_send(self._hass, SIGNAL_UPDATED, kind, self.revision)

    async def async_remove(self) -> None:
        """Delete the stored data (when the integration is removed)."""
        await self._store.async_remove()
