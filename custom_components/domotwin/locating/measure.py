"""How well the rooms are found (`DECISIONS.md`, D-073): tallies kept for each device followed.

For DomoTwin's own locating, and for Bermuda's area sensor of the same device when one is paired
(DomoTwin's then counted by area too, as Bermuda's): the room changes, the storey changes, the
stays shorter than half a minute, the time in no room; how often both say the same place; and,
while a presence sensor alone says where the device's owner is, how often the room found is that
one. Figures only: no addresses, no names. Pure: the locator feeds it every tick.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# A stay shorter than this (s), ended by another room, is a flicker.
SHORT_STAY = 30.0
# A tick longer than this (s) is a pause (Home Assistant busy or restarting): not counted.
LONGEST_TICK = 10.0
# After a start (or the measurements started again), the rooms settle this long (s): the time is
# counted, but not the changes, so that a restart does not read as a room that flaps.
SETTLE = 60.0


@dataclass
class Tally:
    """What one way of locating did for one device."""

    seconds: float = 0.0
    unknown: float = 0.0
    changes: int = 0
    storey_changes: int = 0
    short: int = 0
    # While a presence sensor alone said where the owner was: how long, and how long right.
    witnessed: float = 0.0
    right: float = 0.0
    # Where it was last known, on which storey, and since when (s, the tally's clock).
    place: str | None = None
    storey: int | None = None
    since: float = 0.0

    def add(
        self, place: str | None, storey: int | None, now: float, seconds: float, counting: bool
    ) -> None:
        """Count `seconds` in `place` (None: no room), on `storey` (None: not known).

        Not `counting` (settling after a start), a change of place is followed but not counted.
        """
        self.seconds += seconds
        if place is None:
            self.unknown += seconds
            return
        if place == self.place:
            # The storey may be known only now (the plan read after the first ticks).
            if self.storey is None:
                self.storey = storey
            return
        if self.place is None or not counting:
            self.place, self.storey, self.since = place, storey, now
            return
        self.changes += 1
        if storey is not None and self.storey is not None and storey != self.storey:
            self.storey_changes += 1
        if now - self.since < SHORT_STAY:
            self.short += 1
        self.place, self.storey, self.since = place, storey, now

    def witness(self, place: str | None, truth: str, seconds: float) -> None:
        """A presence sensor alone says the owner is in `truth`: right if `place` is it."""
        self.witnessed += seconds
        if place == truth:
            self.right += seconds

    def figures(self) -> dict[str, Any]:
        """Per hour, and as shares of the time measured."""
        hours = self.seconds / 3600.0
        per_hour = (lambda n: round(n / hours, 1)) if hours > 0 else (lambda n: None)
        return {
            "hours": round(hours, 2),
            "changes_per_hour": per_hour(self.changes),
            "storey_changes_per_hour": per_hour(self.storey_changes),
            "short_stays": self.short,
            "unknown_share": round(self.unknown / self.seconds, 3) if self.seconds else None,
            "witnessed_hours": round(self.witnessed / 3600.0, 2),
            "right_share": round(self.right / self.witnessed, 3) if self.witnessed else None,
        }

    def stored(self) -> dict[str, Any]:
        """The tally as kept (its counts; where it is now starts again)."""
        return {
            "seconds": round(self.seconds, 1),
            "unknown": round(self.unknown, 1),
            "changes": self.changes,
            "storey_changes": self.storey_changes,
            "short": self.short,
            "witnessed": round(self.witnessed, 1),
            "right": round(self.right, 1),
        }

    @classmethod
    def read(cls, value: Any) -> Tally:
        """A tally as stored; what is missing or wrong reads as nothing."""
        tally = cls()
        if not isinstance(value, dict):
            return tally
        for key in ("seconds", "unknown", "witnessed", "right"):
            number = value.get(key)
            if isinstance(number, int | float) and not isinstance(number, bool) and number >= 0:
                setattr(tally, key, float(number))
        for key in ("changes", "storey_changes", "short"):
            number = value.get(key)
            if isinstance(number, int) and not isinstance(number, bool) and number >= 0:
                setattr(tally, key, number)
        # Shares no more than the whole.
        tally.unknown = min(tally.unknown, tally.seconds)
        tally.right = min(tally.right, tally.witnessed)
        return tally


@dataclass
class DeviceMeasure:
    """DomoTwin's tally for a device, Bermuda's when paired, and how often they agree."""

    own: Tally = field(default_factory=Tally)
    bermuda: Tally = field(default_factory=Tally)
    # DomoTwin's counted as Bermuda's are, by area (two rooms of one area are one place there).
    own_area: Tally = field(default_factory=Tally)
    # Seconds both said a place, and seconds they said the same.
    both: float = 0.0
    same: float = 0.0
    # Bermuda's sensor the figures are of: another one (or none) starts them again.
    sensor: str | None = None
    # When it was first counted (the measure's clock): its rooms settle first too.
    born: float = 0.0

    def pair(self, sensor: str | None) -> None:
        """Bermuda's figures are `sensor`'s: those of another sensor are forgotten."""
        if sensor != self.sensor:
            self.bermuda, self.own_area, self.sensor = Tally(), Tally(), sensor
            self.both = self.same = 0.0


class Measure:
    """The tallies of every device followed, since `started`."""

    def __init__(self, started: datetime) -> None:
        """Start measuring at `started`."""
        self.started = started
        self.devices: dict[str, DeviceMeasure] = {}
        # The seconds counted since this start (or since read): the rooms settle first.
        self._clock = 0.0

    def tick(
        self,
        seconds: float,
        places: dict[str, tuple[str | None, int | None, str | None]],
        bermuda: dict[str, tuple[str, str | None, int | None]],
        witnessed: dict[str, tuple[str, str | None]],
    ) -> bool:
        """Count a tick of `seconds` for every device in `places`; return whether anything changed.

        `places`: each device's room as DomoTwin finds it, its storey and its room's area;
        `bermuda`: Bermuda's sensor paired with the device, the area it says and its storey
        (Bermuda's unit is the area); `witnessed`: the room (and its area) a presence sensor alone
        says each device's owner is in.
        """
        gone = set(self.devices) - set(places)
        for device in gone:
            # No longer followed: forgotten.
            del self.devices[device]
        if seconds > LONGEST_TICK:
            # A pause: a stay it cut through was not short.
            for m in self.devices.values():
                m.own.since = m.own_area.since = m.bermuda.since = float("-inf")
        if not 0 < seconds <= LONGEST_TICK or not places:
            return bool(gone)
        self._clock += seconds
        now = self._clock
        for device, (room, storey, area) in places.items():
            measure = self.devices.get(device)
            if measure is None:
                measure = self.devices[device] = DeviceMeasure(born=now - seconds)
            # After a start, and for a device just followed, the rooms settle first.
            counting = now > SETTLE and now - measure.born > SETTLE
            measure.own.add(room, storey, now, seconds, counting)
            truth = witnessed.get(device)
            if truth is not None:
                measure.own.witness(room, truth[0], seconds)
            paired = bermuda.get(device)
            measure.pair(paired[0] if paired is not None else None)
            if paired is None:
                continue
            _, place, place_storey = paired
            measure.bermuda.add(place, place_storey, now, seconds, counting)
            measure.own_area.add(area, storey if area is not None else None, now, seconds, counting)
            if truth is not None and truth[1] is not None:
                measure.bermuda.witness(place, truth[1], seconds)
                measure.own_area.witness(area, truth[1], seconds)
            if area is not None and place is not None:
                measure.both += seconds
                if area == place:
                    measure.same += seconds
        return True

    def forget(self, device: str) -> None:
        """Forget a device's figures (another device under its id)."""
        self.devices.pop(device, None)

    def reset(self, started: datetime) -> None:
        """Start again from nothing at `started`."""
        self.started = started
        self.devices.clear()
        self._clock = 0.0

    def figures(self) -> dict[str, Any]:
        """Every device's figures, DomoTwin's and Bermuda's side by side."""
        out: dict[str, Any] = {}
        for device, m in self.devices.items():
            shown: dict[str, Any] = {"domotwin": m.own.figures()}
            if m.bermuda.seconds > 0:
                shown["domotwin_areas"] = m.own_area.figures()
                shown["bermuda"] = m.bermuda.figures()
                shown["agreement"] = round(m.same / m.both, 3) if m.both else None
            out[device] = shown
        return out

    def stored(self) -> dict[str, Any]:
        """The tallies as kept, with when they started."""
        return {
            "started": self.started.isoformat(),
            "devices": {
                device: {
                    "own": m.own.stored(),
                    "own_area": m.own_area.stored(),
                    "bermuda": m.bermuda.stored(),
                    "both": round(m.both, 1),
                    "same": round(m.same, 1),
                    "sensor": m.sensor,
                }
                for device, m in self.devices.items()
            },
        }

    @classmethod
    def read(cls, value: Any, now: datetime) -> Measure:
        """The tallies as stored (a new start at `now` when there are none)."""
        started = now
        if isinstance(value, dict) and isinstance(value.get("started"), str):
            try:
                started = datetime.fromisoformat(value["started"])
            except ValueError:
                started = now
        measure = cls(started)
        devices = value.get("devices") if isinstance(value, dict) else None
        for device, stored in (devices if isinstance(devices, dict) else {}).items():
            if not isinstance(device, str) or not isinstance(stored, dict):
                continue
            m = DeviceMeasure(
                Tally.read(stored.get("own")),
                Tally.read(stored.get("bermuda")),
                Tally.read(stored.get("own_area")),
            )
            for key in ("both", "same"):
                number = stored.get(key)
                if isinstance(number, int | float) and not isinstance(number, bool) and number >= 0:
                    setattr(m, key, float(number))
            m.same = min(m.same, m.both)
            sensor = stored.get("sensor")
            m.sensor = sensor if isinstance(sensor, str) else None
            measure.devices[device] = m
        return measure
