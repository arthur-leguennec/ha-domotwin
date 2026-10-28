"""Finer locating (D-079), the pure parts: the cells, their ways, the cloud and the storeys.

On the demo apartment and its upper floor, and on a fictional home of two rooms and a door.
"""

from __future__ import annotations

import json
import math
import random
from typing import Any

from custom_components.domotwin.locating.cells import CELL, MAX_CELLS, Cells
from custom_components.domotwin.locating.cloud import Cloud
from custom_components.domotwin.locating.filter import RoomFilter
from custom_components.domotwin.locating.geometry import HELD_AT, Home, Spot
from custom_components.domotwin.locating.radio import (
    Learned,
    Model,
    cell_prior,
    expected_at,
    prior,
)

from .conftest import ROOT


def _demo() -> Home:
    ground = json.loads((ROOT / "examples" / "demo-apartment.domotwin.json").read_text())
    upper = json.loads((ROOT / "examples" / "demo-upper-floor.domotwin.json").read_text())
    return Home(
        [
            {"id": "ground", "elevation": 0, "plan": ground},
            {"id": "upper", "elevation": 280, "plan": upper},
        ]
    )


def _two_rooms(door: bool = True) -> Home:
    """Two rooms of 4 by 3 m a 20 cm wall apart, a door in it (or none)."""
    rooms = [
        {"id": "west", "outline": [[0, 0], [400, 0], [400, 300], [0, 300]]},
        {"id": "east", "outline": [[420, 0], [820, 0], [820, 300], [420, 300]]},
    ]
    doors = [{"id": "d", "from": [410, 100], "to": [410, 190]}] if door else []
    plan: dict[str, Any] = {"rooms": rooms, "doors": doors}
    return Home([{"id": "s", "elevation": 0, "plan": plan}])


def test_the_rooms_are_cut_into_cells_that_lead_through_doors_only() -> None:
    home = _two_rooms()
    cells = Cells(home)
    assert cells.size == CELL
    # 8 by 6 cells in each room: none in the wall between them.
    assert len(cells.by_room["west"]) == 48
    assert len(cells.by_room["east"]) == 48
    rooms = {i: c.room for i, c in enumerate(cells.cells)}

    def crossing(i: int) -> set[int]:
        return {j for j in cells.moves[i] if rooms[j] != rooms[i]}

    # Beside the door, a step leads into the other room; along the wall away from it, never.
    by_place = {(c.x, c.y): i for i, c in enumerate(cells.cells)}
    assert crossing(by_place[375.0, 125.0])
    assert not crossing(by_place[375.0, 275.0])
    assert all(rooms[j] == "west" for j in cells.moves[by_place[25.0, 25.0]])
    # A storey drawn without doors: its rooms that share a side lead to each other (as `_link`).
    doorless = Cells(_two_rooms(door=False))
    assert any(
        doorless.cells[j].room != c.room
        for i, c in enumerate(doorless.cells)
        for j in doorless.moves[i]
    )
    # A cell's place: its middle, held at a hand's height.
    assert cells.spot(by_place[25.0, 25.0]) == Spot(0, 25.0, 25.0, HELD_AT)


def test_the_stairs_alone_lead_from_one_storey_to_the_other() -> None:
    home = _demo()
    cells = Cells(home)
    between = {
        (cells.cells[i].room, cells.cells[j].room)
        for i in range(len(cells))
        for j in cells.moves[i]
        if cells.cells[i].storey != cells.cells[j].storey
    }
    # The hall's stairs lead to the landing, and back; nothing else crosses.
    assert between == {("hall", "up-landing"), ("up-landing", "hall")}


def test_a_large_home_has_larger_cells() -> None:
    side = 6000
    plan = {"rooms": [{"id": "hangar", "outline": [[0, 0], [side, 0], [side, side], [0, side]]}]}
    cells = Cells(Home([{"id": "s", "elevation": 0, "plan": plan}]))
    assert len(cells) <= MAX_CELLS
    assert cells.size > CELL


def test_the_cloud_finds_where_in_the_room_a_device_lies() -> None:
    """Three receivers, a phone on a shelf in the living room's corner: its spot within a metre."""
    home = _demo()
    cells = Cells(home)
    living = home.rooms["living"].outline
    xs, ys = [p[0] for p in living], [p[1] for p in living]
    corner = Spot(0, min(xs) + 80, min(ys) + 80, HELD_AT)
    receivers = {
        "kitchen": home.middle("kitchen"),
        "bedroom": home.middle("bedroom"),
        "hall": home.middle("hall"),
    }
    plan = cell_prior(home, cells, receivers)
    model = Model(prior(home, receivers), {})
    rooms = {"living", *home.neighbours["living"]}
    cloud = Cloud(cells)
    noise = random.Random(7)  # noqa: S311 (readings, not secrets)
    spreads = []
    for _ in range(30):
        cloud.around("living", rooms)
        cloud.predict(2.0)
        readings = {
            s: expected_at(home, corner, r) + noise.gauss(0, 3) for s, r in receivers.items()
        }
        kept = list(cloud.chances)
        scores = model.cell_scores(
            plan, ((k, cells.cells[k].room) for k in kept), readings, [], 0.0
        )
        cloud.update(dict(zip(kept, scores, strict=True)), {})
        found = cloud.spot("living")
        assert found is not None
        spreads.append(found[2])
    assert found is not None
    x, y, spread = found
    assert math.dist((x, y), (corner.x, corner.y)) < 100
    # Surer than at the start, and saying so.
    assert spread < spreads[0]
    assert spread < 150


def test_what_was_learned_of_a_room_moves_its_cells_too() -> None:
    home = _two_rooms()
    receivers = {"r": Spot(0, 100, 150, 120)}
    plan_prior = prior(home, receivers)
    learned = Learned()
    for _ in range(50):
        learned.add(plan_prior["east", "r"][0] - 10)
    model = Model(plan_prior, {("east", "r"): learned})
    shift, spread = model.cell("east", "r") or (0.0, 0.0)
    assert -11 < shift < -7
    assert spread >= 3.0
    # Unlearned, the plan's own, a spot's spread.
    shift, spread = model.cell("west", "r") or (1.0, 0.0)
    assert shift == 0.0
    assert spread == 6.0


def test_a_storey_the_stairs_lead_to_is_reached_by_them_only() -> None:
    home = _demo()
    storeys = {room_id: room.storey for room_id, room in home.rooms.items()}
    joined = RoomFilter(home.neighbours, storeys)
    joined.chances = {room: 1.0 if room == "bedroom" else 0.0 for room in joined.chances}
    joined.predict(10.0)
    upstairs = [r for r in joined.chances if storeys[r] == 1]
    # From the bedroom, nothing flows upstairs but by the hall's stairs: a floor's worth only.
    assert all(joined.chances[r] < 1e-5 for r in upstairs)
    # Without the rooms' storeys (as before), a little flows across the home to every room.
    loose = RoomFilter(home.neighbours)
    loose.chances = {room: 1.0 if room == "bedroom" else 0.0 for room in loose.chances}
    loose.predict(10.0)
    assert all(loose.chances[r] > 1e-4 for r in upstairs)


def _split_level() -> Home:
    def plan(name: str) -> dict[str, Any]:
        data: dict[str, Any] = json.loads((ROOT / "examples" / name).read_text())
        return data

    return Home(
        [
            {"id": "lower", "elevation": -140, "plan": plan("split-level-lower.domotwin.json")},
            {"id": "entry", "elevation": 0, "plan": plan("split-level-entry.domotwin.json")},
            {"id": "upper", "elevation": 140, "plan": plan("split-level-upper.domotwin.json")},
        ]
    )


def test_storeys_the_stairs_join_one_after_the_other_are_reached_by_them_only() -> None:
    """From the lower level, the upper one (two half flights up) is no nearer than the entry."""
    home = _split_level()
    storeys = {room_id: room.storey for room_id, room in home.rooms.items()}
    outside = {room_id for room_id, room in home.rooms.items() if room.outside}
    rooms = RoomFilter(home.neighbours, storeys, outside)
    rooms.chances = {room: 1.0 if room == "s-family" else 0.0 for room in rooms.chances}
    rooms.predict(10.0)
    assert all(rooms.chances[r] < 1e-5 for r in rooms.chances if storeys[r] == 2)
    # From the back garden round the home to the front: the gardens are joined across the
    # storeys (one walks round), not by the stairs.
    rooms = RoomFilter(home.neighbours, storeys, outside)
    rooms.chances = {room: 1.0 if room == "s-back-garden" else 0.0 for room in rooms.chances}
    rooms.predict(30.0)
    assert rooms.chances["s-front-garden"] > 1e-3
    assert rooms.chances["s-bedroom"] < 1e-5


def test_a_garden_round_the_home_has_no_cells_under_its_walls() -> None:
    rooms = [
        {"id": "west", "outline": [[0, 0], [410, 0], [410, 300], [0, 300]]},
        {"id": "east", "outline": [[430, 0], [820, 0], [820, 300], [430, 300]]},
        {
            "id": "garden",
            "outside": True,
            "outline": [[-300, -300], [1100, -300], [1100, 600], [-300, 600]],
        },
    ]
    doors = [
        {"id": "inside", "from": [420, 100], "to": [420, 190]},
        {"id": "out", "from": [100, 300], "to": [190, 300]},
    ]
    home = Home([{"id": "s", "elevation": 0, "plan": {"rooms": rooms, "doors": doors}}])
    cells = Cells(home)
    # Not in the wall between the rooms: the garden is round the home, not in it.
    assert not [c for c in cells.cells if c.room == "garden" and 0 < c.x < 820 and 0 < c.y < 300]


def test_an_l_shaped_room_s_spot_stays_in_it() -> None:
    rooms = [
        {"id": "l", "outline": [[0, 0], [600, 0], [600, 200], [200, 200], [200, 600], [0, 600]]},
        {"id": "notch", "outline": [[200, 200], [600, 200], [600, 600], [200, 600]]},
    ]
    home = Home([{"id": "s", "elevation": 0, "plan": {"rooms": rooms}}])
    cells = Cells(home)
    cloud = Cloud(cells)
    cloud.around("l", {"l", "notch"})
    found = cloud.spot("l")
    assert found is not None
    assert home.room_at(0, (found[0], found[1])) == "l"


def test_a_room_no_door_leads_to_is_joined_across_its_side_and_a_far_door_is_no_way() -> None:
    rooms = [
        {"id": "a", "outline": [[0, 0], [400, 0], [400, 300], [0, 300]]},
        {"id": "b", "outline": [[420, 0], [820, 0], [820, 300], [420, 300]]},
        {"id": "closet", "outline": [[420, 320], [820, 320], [820, 500], [420, 500]]},
    ]
    # A door from a to b, and a door on the line of a row of cells, far from them.
    doors = [
        {"id": "ab", "from": [410, 100], "to": [410, 190]},
        {"id": "far", "from": [1000, 425], "to": [1090, 425]},
    ]
    home = Home([{"id": "s", "elevation": 0, "plan": {"rooms": rooms, "doors": doors}}])
    cells = Cells(home)
    pairs = {
        frozenset((cells.cells[i].room, cells.cells[j].room))
        for i in range(len(cells))
        for j in cells.moves[i]
        if cells.cells[i].room != cells.cells[j].room
    }
    assert pairs == {frozenset(("a", "b")), frozenset(("b", "closet"))}


def _moves_between(cells: Cells, one: str, other: str) -> list[tuple[tuple[float, float], ...]]:
    return [
        ((cells.cells[i].x, cells.cells[i].y), (cells.cells[j].x, cells.cells[j].y))
        for i in range(len(cells))
        for j in cells.moves[i]
        if cells.cells[i].room == one and cells.cells[j].room == other
    ]


def test_a_step_goes_through_the_door_of_the_two_rooms_and_no_other_wall() -> None:
    """Three rooms, a door between each two: a step from c to b goes through theirs."""
    rooms = [
        {"id": "a", "outline": [[0, 0], [400, 0], [400, 300], [0, 300]]},
        {"id": "c", "outline": [[0, 320], [400, 320], [400, 620], [0, 620]]},
        {"id": "b", "outline": [[420, 0], [820, 0], [820, 620], [420, 620]]},
    ]
    doors = [
        {"id": "ac", "from": [300, 310], "to": [390, 310]},
        {"id": "ab", "from": [410, 60], "to": [410, 150]},
        {"id": "cb", "from": [410, 500], "to": [410, 590]},
    ]
    cells = Cells(Home([{"id": "s", "elevation": 0, "plan": {"rooms": rooms, "doors": doors}}]))
    found = _moves_between(cells, "c", "b")
    # Through the door between them, low on the wall: never through a's door and its wall.
    assert found
    assert all(there[1] > 400 for _, there in found)


def test_a_side_left_open_opens_no_other_side_of_the_two_rooms() -> None:
    """A kitchen open on its right to a living room that wraps round it, walled at its foot."""
    rooms = [
        {
            "id": "kitchen",
            "outline": [[0, 0], [300, 0], [300, 300], [0, 300]],
            "sides": [None, {"open": True}, None, None],
        },
        {
            "id": "living",
            "outline": [[310, 0], [800, 0], [800, 610], [0, 610], [0, 310], [310, 310]],
        },
    ]
    cells = Cells(Home([{"id": "s", "elevation": 0, "plan": {"rooms": rooms}}]))
    found = _moves_between(cells, "kitchen", "living")
    assert found
    # Across the open side (to the right), never across the wall at its foot.
    assert all(there[0] > 300 for _, there in found)


def test_a_cloud_in_two_ends_of_a_room_is_told_in_its_middle() -> None:
    """A convex room: the middle of the cloud is in it, kept, however unsure."""
    plan = {"rooms": [{"id": "long", "outline": [[0, 0], [1000, 0], [1000, 300], [0, 300]]}]}
    cells = Cells(Home([{"id": "s", "elevation": 0, "plan": plan}]))
    cloud = Cloud(cells)
    ends = [k for k in cells.by_room["long"] if cells.cells[k].x < 100 or cells.cells[k].x > 900]
    cloud.chances = {k: 1 / len(ends) for k in ends}
    found = cloud.spot("long")
    assert found is not None
    assert math.dist(found[:2], (500, 150)) < 1
    assert found[2] > 400


def test_a_room_smaller_than_a_cell_keeps_the_cloud_around_it() -> None:
    rooms = [
        {"id": "hall", "outline": [[0, 0], [400, 0], [400, 300], [0, 300]]},
        # 40 cm wide, between two cells' middles (at 425 and 475 cm): none in it.
        {"id": "niche", "outline": [[430, 110], [470, 110], [470, 190], [430, 190]]},
    ]
    doors = [{"id": "d", "from": [415, 120], "to": [415, 180]}]
    home = Home([{"id": "s", "elevation": 0, "plan": {"rooms": rooms, "doors": doors}}])
    cells = Cells(home)
    assert "niche" not in cells.by_room
    cloud = Cloud(cells)
    cloud.around("hall", {"hall", "niche"})
    before = dict(cloud.chances)
    cloud.around("niche", {"hall", "niche"})
    assert cloud.chances == before
    assert cloud.spot("niche") is None
