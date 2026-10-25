"""Which room a device is in, from one reading to the next (docs/DECISIONS.md, D-035).

A forward filter over the rooms: someone stays put most of the time, goes through a door to the
next room now and then, and almost never jumps across the home. What is heard is weighed against
that; presence sensors weigh in too. The room told changes only once the filter is sure enough for
long enough, so that a device on a desk by a wall does not flap between two rooms. Pure.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import math
from typing import Final

# How often someone leaves a room (per second), towards a room through a door or across the home.
LEAVE_RATE: Final = 1 / 30
THROUGH_DOOR: Final = 1.0
ACROSS_HOME: Final = 0.02
# Readings in a row are not independent: each counts for this much.
TEMPER: Final = 0.5
# No room is ever ruled out for good.
FLOOR: Final = 1e-6
# The room told changes at this chance held twice in a row, or at once at the second.
SWITCH: Final = 0.6
SWITCH_TICKS: Final = 2
SURE: Final = 0.85

# Presence sensors: how much more (or less) likely someone is in their room.
PRESENCE_ON: Final = 2.5
PRESENCE_OFF: Final = 0.4
PRESENCE_OFF_AFTER: Final = 30.0
MOTION_ON: Final = 1.6
PRESENCE_CLASSES: Final = frozenset({"occupancy", "presence"})
MOTION_CLASSES: Final = frozenset({"motion", "moving"})


def presence_weight(sensors: Iterable[tuple[str, bool, float]]) -> float:
    """What a room's presence sensors say, as a weight on someone being there.

    Each sensor is `(device class, on, seconds since it changed)`: a presence or occupancy sensor
    on says yes, off for a while says no; a motion sensor on says yes, off says nothing.
    """
    weight = 1.0
    presence = [(on, since) for kind, on, since in sensors if kind in PRESENCE_CLASSES]
    motion = [on for kind, on, _ in sensors if kind in MOTION_CLASSES]
    if any(on for on, _ in presence):
        weight *= PRESENCE_ON
    elif presence and all(since >= PRESENCE_OFF_AFTER for _, since in presence):
        weight *= PRESENCE_OFF
    if any(motion):
        weight *= MOTION_ON
    return weight


class RoomFilter:
    """The chance of each room for one device, and the room told."""

    def __init__(self, neighbours: Mapping[str, Iterable[str]]) -> None:
        """Start knowing nothing: every room as likely."""
        self._rooms = sorted(neighbours)
        self._near = {room: frozenset(neighbours[room]) for room in self._rooms}
        self.chances = {room: 1 / len(self._rooms) for room in self._rooms} if self._rooms else {}
        self.room: str | None = None
        self._candidate: str | None = None
        self._held = 0

    def carry(self, other: RoomFilter) -> None:
        """Start from another filter's chances (the rooms changed): those still here are kept."""
        kept = {room: p for room, p in other.chances.items() if room in self.chances}
        total = sum(kept.values())
        if total > 0:
            rest = max(0.0, 1 - total) / len(self.chances)
            self.chances = {room: kept.get(room, 0.0) + rest for room in self.chances}
            self._normalise()
        if other.room in self.chances:
            self.room = other.room
        if other._candidate in self.chances:
            self._candidate, self._held = other._candidate, other._held

    def reset(self) -> None:
        """Forget: the device was not heard for long."""
        if self._rooms:
            self.chances = {room: 1 / len(self._rooms) for room in self._rooms}
        self.room = None
        self._candidate = None
        self._held = 0

    @property
    def confidence(self) -> float:
        """The chance of the room told (0 when none)."""
        return self.chances.get(self.room, 0.0) if self.room is not None else 0.0

    def _normalise(self) -> None:
        total = sum(self.chances.values())
        if total <= 0:
            self.reset()
            return
        floored = {room: max(p / total, FLOOR) for room, p in self.chances.items()}
        total = sum(floored.values())
        self.chances = {room: p / total for room, p in floored.items()}

    def predict(self, seconds: float) -> None:
        """Let time pass: some chance flows to the rooms through the doors, a little elsewhere."""
        if len(self._rooms) < 2:
            return
        leave = 1 - math.exp(-LEAVE_RATE * max(0.0, seconds))
        moved = {room: p * (1 - leave) for room, p in self.chances.items()}
        for room, p in self.chances.items():
            near = self._near[room]
            weights = {
                other: THROUGH_DOOR if other in near else ACROSS_HOME
                for other in self._rooms
                if other != room
            }
            total = sum(weights.values())
            for other, weight in weights.items():
                moved[other] += p * leave * weight / total
        self.chances = moved
        self._normalise()

    def update(
        self, scores: Mapping[str, float], weights: Mapping[str, float] | None = None
    ) -> str | None:
        """Weigh what was heard (a log score by room) and the presence sensors (a weight by room).

        Return the room told, which changes only when the filter is sure enough.
        """
        if scores:
            best = max(scores.values())
            self.chances = {
                room: p
                * math.exp(TEMPER * (scores.get(room, best - 50.0) - best))
                * (weights or {}).get(room, 1.0)
                for room, p in self.chances.items()
            }
            self._normalise()
        return self._decide()

    def _decide(self) -> str | None:
        if not self.chances:
            return None
        best = max(self.chances, key=self.chances.__getitem__)
        chance = self.chances[best]
        if best == self.room:
            self._candidate, self._held = None, 0
            return self.room
        self._held = self._held + 1 if best == self._candidate else 1
        self._candidate = best
        first = self.room is None and chance >= SWITCH
        if first or chance >= SURE or (chance >= SWITCH and self._held >= SWITCH_TICKS):
            self.room = best
            self._candidate, self._held = None, 0
        return self.room
