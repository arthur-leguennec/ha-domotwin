"""What a receiver hears of a device in each room (docs/DECISIONS.md, D-035).

Before anything is learned, the plan says it: the signal falls with the distance (the log-distance
law) and with each wall and floor in the way (the multi-wall model). What is heard while someone is
known to be in a room (a room taught, a presence sensor that agrees) then takes over, room by room
and receiver by receiver. Pure: no Home Assistant objects; signal strengths in dBm.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
import math
from typing import Final

from .geometry import Home, Spot

# A phone heard from a metre away, and how fast its signal falls with the distance.
AT_1M: Final = -59.0
EXPONENT: Final = 2.2
# What a wall and a floor take away.
WALL_DB: Final = 4.0
FLOOR_DB: Final = 15.0
# How far a reading strays from the model, around a room's spread.
SPREAD_DB: Final = 6.0
MIN_SPREAD_DB: Final = 3.0
# Nothing quieter is heard.
HEARD_ABOVE: Final = -100.0
# A receiver whose place is not known: it says little until something is learned.
UNPLACED: Final = (-85.0, 15.0)
# The plan counts as this many readings; what is learned counts up to this many.
PRIOR_WEIGHT: Final = 8.0
MAX_WEIGHT: Final = 400.0
# Devices differ: how loud this one is, around what was learned of it (dB).
OFFSET_SPREAD_DB: Final = 6.0
OFFSET_LIMIT_DB: Final = 20.0
# A reading that is a reflection, a packet missed by a receiver that should have heard it.
STRAY: Final = 0.05
STRAY_RANGE_DB: Final = 60.0
MISSED: Final = 0.1
FAINT: Final = 1e-12

type Key = tuple[str, str]


def expected_at(home: Home, place: Spot, receiver: Spot) -> float:
    """The signal a receiver hears from a device held at `place`, by the plan."""
    metres = (
        math.sqrt(
            (place.x - receiver.x) ** 2 + (place.y - receiver.y) ** 2 + (place.z - receiver.z) ** 2
        )
        / 100
    )
    return (
        AT_1M
        - 10 * EXPONENT * math.log10(max(metres, 0.5))
        - WALL_DB * home.walls(place, receiver)
        - FLOOR_DB * home.floors(place, receiver)
    )


def prior(home: Home, receivers: Mapping[str, Spot | None]) -> dict[Key, tuple[float, float]]:
    """What each receiver should hear in each room, by the plan: mean and spread.

    A room's spread grows with how differently its corners hear the receiver.
    """
    found: dict[Key, tuple[float, float]] = {}
    for room in home.rooms:
        points = home.points(room)
        for source, spot in receivers.items():
            if spot is None:
                found[room, source] = UNPLACED
                continue
            values = [expected_at(home, p, spot) for p in points]
            mean = sum(values) / len(values)
            variance = sum((v - mean) ** 2 for v in values) / len(values)
            found[room, source] = (mean, math.sqrt(SPREAD_DB**2 + variance))
    return found


@dataclass
class Learned:
    """What a receiver heard in a room: a weighted running mean and variance."""

    weight: float = 0.0
    mean: float = 0.0
    m2: float = 0.0

    def add(self, value: float, weight: float = 1.0) -> None:
        """Count one more reading; past `MAX_WEIGHT`, the oldest count for less."""
        self.weight += weight
        delta = value - self.mean
        self.mean += delta * weight / self.weight
        self.m2 += weight * delta * (value - self.mean)
        if self.weight > MAX_WEIGHT:
            scale = MAX_WEIGHT / self.weight
            self.weight *= scale
            self.m2 *= scale

    @property
    def variance(self) -> float:
        """The readings' variance (0 before any)."""
        return self.m2 / self.weight if self.weight > 0 else 0.0

    def stored(self) -> list[float]:
        """As stored: `[weight, mean, m2]`, rounded."""
        return [round(self.weight, 3), round(self.mean, 3), round(self.m2, 3)]

    @classmethod
    def read(cls, value: object) -> Learned | None:
        """From `stored`, or None for anything else."""
        if not isinstance(value, list) or len(value) != 3:
            return None
        if not all(isinstance(v, int | float) and math.isfinite(v) for v in value):
            return None
        weight, mean, m2 = (float(v) for v in value)
        if not 0 < weight <= MAX_WEIGHT or m2 < 0 or not -150 <= mean <= 20:
            return None
        return cls(weight, mean, m2)


def _log_normal(x: float, mean: float, spread: float) -> float:
    z = (x - mean) / spread
    return -0.5 * z * z - math.log(spread * math.sqrt(2 * math.pi))


def _log_below(limit: float, mean: float, spread: float) -> float:
    """The log chance that a reading of this mean and spread is under `limit`."""
    return math.log(max(0.5 * math.erfc(-(limit - mean) / (spread * math.sqrt(2))), FAINT))


@dataclass(frozen=True)
class Heard:
    """How well a room explains what was heard, and how loud the device was taken to be."""

    score: float
    offset: float


class Model:
    """What each receiver should hear in each room: the plan's, then what was learned."""

    def __init__(
        self,
        prior: Mapping[Key, tuple[float, float]],
        learned: Mapping[Key, Learned],
    ) -> None:
        """Combine the plan's expectations with what was learned."""
        self.rooms = sorted({room for room, _ in prior})
        self._expected: dict[Key, tuple[float, float]] = {}
        for key, (mean, spread) in prior.items():
            seen = learned.get(key)
            if seen is None or seen.weight <= 0:
                self._expected[key] = (mean, spread)
                continue
            total = PRIOR_WEIGHT + seen.weight
            combined = (PRIOR_WEIGHT * mean + seen.weight * seen.mean) / total
            variance = (
                PRIOR_WEIGHT * spread**2
                + seen.weight * seen.variance
                + PRIOR_WEIGHT * seen.weight / total * (mean - seen.mean) ** 2
            ) / total
            self._expected[key] = (combined, max(MIN_SPREAD_DB, math.sqrt(variance)))

    def expected(self, room: str, source: str) -> tuple[float, float] | None:
        """What `source` should hear in `room`: mean and spread."""
        return self._expected.get((room, source))

    def heard(
        self,
        readings: Mapping[str, float],
        listening: Iterable[str],
        offset: float = 0.0,
    ) -> dict[str, Heard]:
        """How well each room explains the readings (by receiver), and the silence of the others.

        `listening` are the receivers working now: one of them that did not hear the device says
        it is far. The device's own loudness is found for each room, around `offset`.
        """
        silent = [s for s in listening if s not in readings]
        found: dict[str, Heard] = {}
        for room in self.rooms:
            pairs = [
                (value, expected)
                for source, value in readings.items()
                if (expected := self._expected.get((room, source))) is not None
            ]
            # The device's loudness that fits this room best, drawn towards what is known of it.
            weights = sum(1 / spread**2 for _, (_, spread) in pairs) + 1 / OFFSET_SPREAD_DB**2
            fitted = (
                sum((value - mean) / spread**2 for value, (mean, spread) in pairs)
                + offset / OFFSET_SPREAD_DB**2
            ) / weights
            fitted = max(offset - OFFSET_LIMIT_DB, min(offset + OFFSET_LIMIT_DB, fitted))
            score = _log_normal(fitted, offset, OFFSET_SPREAD_DB)
            for value, (mean, spread) in pairs:
                near = (1 - STRAY) * math.exp(_log_normal(value, mean + fitted, spread))
                score += math.log(near + STRAY / STRAY_RANGE_DB)
            for source in silent:
                expected = self._expected.get((room, source))
                if expected is not None:
                    below = math.exp(_log_below(HEARD_ABOVE, expected[0] + fitted, expected[1]))
                    score += math.log(MISSED + (1 - MISSED) * below)
            found[room] = Heard(score, fitted)
        return found
