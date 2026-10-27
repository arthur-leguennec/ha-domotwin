"""Where a device is in its room: a cloud of likely cells (docs/DECISIONS.md, D-079).

Around the room the room filter tells (that room and the rooms it leads to), the chance of each
cell: someone moves a few cells at a time, through doors and by the stairs only (`cells.Cells`),
and what is heard is weighed cell by cell. The spot told is the middle of the cloud in the room
told, and how far the cloud spreads around it says how sure it is. Pure.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
import heapq
import math
from typing import Final

from .cells import Cells
from .filter import TEMPER

# Each second, a share of each cell's chance moves to the cells a step away (a few steps at most
# between two readings, however long the silence: the room filter says where it went).
STEP_SECONDS: Final = 1.0
MOVE: Final = 0.3
MAX_STEPS: Final = 6
# The cells kept: the likeliest, and none less than this share of the likeliest's chance.
MOST_CELLS: Final = 400
LEAST: Final = 1e-4
# The room told holds at least this share of the cloud: it is where the device is said to be.
SEEDED: Final = 0.5


class Cloud:
    """The chance of each cell for one device, around the room told."""

    def __init__(self, cells: Cells) -> None:
        """Start empty: nothing is known."""
        self._cells = cells
        self.chances: dict[int, float] = {}

    def clear(self) -> None:
        """Forget: the device is in no room."""
        self.chances = {}

    def around(self, room: str, rooms: Collection[str]) -> None:
        """Keep the cloud to `rooms` (the room told and the rooms it leads to).

        The room told gets at least `SEEDED` of it, spread across its cells (across `MOST_CELLS`
        of them at most): the room filter, which weighs the whole home, says where the device is.
        """
        cells = self._cells.cells
        kept = {k: p for k, p in self.chances.items() if cells[k].room in rooms}
        own = self._cells.by_room.get(room, [])
        if not own:
            # A room smaller than a cell: no spot in it, what is around it kept.
            self.chances = kept
            self._normalise(trim=False)
            return
        # A large room (a garden) is seeded on cells spread across it, no more than are kept.
        own = own[:: math.ceil(len(own) / MOST_CELLS)]
        inside = sum(p for k, p in kept.items() if cells[k].room == room)
        others = sum(kept.values()) - inside
        if inside <= 0:
            # None of it in the room told: spread there, beside what is kept around it.
            kept = {k: p * (1 - SEEDED) / others for k, p in kept.items()} if others > 0 else {}
            for k in own:
                kept[k] = (SEEDED if others > 0 else 1.0) / len(own)
        elif inside < SEEDED * (inside + others):
            # Too little of it there: what is there kept, half of `SEEDED` spread across it.
            kept = {
                k: p * (SEEDED / 2 / inside if cells[k].room == room else (1 - SEEDED) / others)
                for k, p in kept.items()
            }
            for k in own:
                kept[k] = kept.get(k, 0.0) + SEEDED / 2 / len(own)
        self.chances = kept
        # Not trimmed yet: a large room's cells are all as likely until something is heard.
        self._normalise(trim=False)

    def predict(self, seconds: float) -> None:
        """Let time pass: a share of each cell's chance moves a step away, through doors only."""
        steps = min(MAX_STEPS, max(1, round(max(0.0, seconds) / STEP_SECONDS)))
        moves = self._cells.moves
        for _ in range(steps):
            moved: dict[int, float] = {}
            for k, p in self.chances.items():
                ways = moves[k]
                if not ways:
                    moved[k] = moved.get(k, 0.0) + p
                    continue
                moved[k] = moved.get(k, 0.0) + p * (1 - MOVE)
                share = p * MOVE / len(ways)
                for other in ways:
                    moved[other] = moved.get(other, 0.0) + share
            self.chances = moved

    def update(self, scores: Mapping[int, float], weights: Mapping[str, float]) -> None:
        """Weigh what was heard (a log score by cell) and the presence sensors (weights by room)."""
        if not scores:
            return
        best = max(scores.values())
        cells = self._cells.cells
        self.chances = {
            k: p
            * math.exp(TEMPER * (scores.get(k, best - 50.0) - best))
            * weights.get(cells[k].room, 1.0)
            for k, p in self.chances.items()
        }
        self._normalise()

    def _normalise(self, *, trim: bool = True) -> None:
        if not self.chances:
            return
        top = max(self.chances.values())
        kept = [(p, k) for k, p in self.chances.items() if not trim or p >= top * LEAST]
        if trim and len(kept) > MOST_CELLS:
            kept = heapq.nlargest(MOST_CELLS, kept)
        total = sum(p for p, _ in kept)
        self.chances = {k: p / total for p, k in kept} if total > 0 else {}

    def spot(self, room: str) -> tuple[float, float, float] | None:
        """The middle of the cloud in `room` and how far it spreads around it (cm), or None.

        A cell's own size counts in the spread: the spot is no surer than a cell.
        """
        cells = self._cells.cells
        found = [(cells[k], p) for k, p in self.chances.items() if cells[k].room == room]
        total = sum(p for _, p in found)
        if total <= 0:
            return None
        x = sum(c.x * p for c, p in found) / total
        y = sum(c.y * p for c, p in found) / total
        variance = sum(((c.x - x) ** 2 + (c.y - y) ** 2) * p for c, p in found) / total
        # In a room that is not convex (an L), the middle may fall outside it: in none of its
        # cells, the middle of the nearest of them then.
        at = self._cells.at(found[0][0].storey, x, y)
        if at is None or cells[at].room != room:
            near = min(
                (cells[k] for k in self._cells.by_room[room]),
                key=lambda c: (c.x - x) ** 2 + (c.y - y) ** 2,
            )
            x, y = near.x, near.y
        # A point anywhere in a square cell is this far from its middle, on average squared.
        within = self._cells.size**2 / 6
        return x, y, math.sqrt(variance + within)
