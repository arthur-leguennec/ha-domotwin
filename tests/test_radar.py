"""Presence radars on the plans (D-080), the pure parts.

What a radar's entities say, where its targets are on the plan, the people they make, how they
weigh the cells, who each is: on a fictional home of two rooms a wall apart, and one open on a
third.
"""

from __future__ import annotations

import math
import random
from typing import Any

import pytest

from custom_components.domotwin.locating.cells import Cells
from custom_components.domotwin.locating.cloud import Cloud
from custom_components.domotwin.locating.geometry import HELD_AT, Home, Spot
from custom_components.domotwin.locating.radar import (
    MATCH_REACH,
    SEEN,
    STICK,
    UNSEEN,
    Radar,
    Reading,
    Target,
    cell_weights,
    follow,
    length,
    look,
    match,
    room_weights,
    seen,
    signals,
)
from custom_components.domotwin.locating.radio import Model, cell_prior, expected_at, prior


def _home() -> Home:
    """A living room (6 by 4 m), a study a wall away, a kitchen open on the living room."""
    rooms = [
        {"id": "living", "outline": [[0, 0], [600, 0], [600, 400], [0, 400]]},
        {"id": "study", "outline": [[0, 420], [600, 420], [600, 800], [0, 800]]},
        {
            "id": "kitchen",
            "outline": [[600, 0], [900, 0], [900, 400], [600, 400]],
            "sides": [None, None, None, {"open": True}],
        },
    ]
    doors = [{"id": "d", "from": [100, 410], "to": [190, 410]}]
    plan: dict[str, Any] = {"rooms": rooms, "doors": doors}
    return Home([{"id": "ground", "elevation": 0, "plan": plan}])


# A radar on the living room's south wall, in its middle, looking north (into the room).
SOUTH = Radar("radar", 0, 300.0, 400.0, 180.0, "living")


def test_a_radar_s_entities_say_where_how_far_or_whether() -> None:
    # An LD2450 through ESPHome: three targets' places, their speeds, its zones' settings.
    ld2450 = signals(
        [
            ("sensor.radar_target_1_x", "Target 1 X"),
            ("sensor.radar_target_1_y", "Target 1 Y"),
            ("sensor.radar_target_1_speed", "Target 1 Speed"),
            ("sensor.radar_target_2_x", "Target 2 X"),
            ("sensor.radar_target_2_y", "Target 2 Y"),
            ("sensor.radar_target_1_distance", "Target 1 Distance"),
            ("number.radar_zone_1_x1", "Zone 1 X1"),
            ("binary_sensor.radar_zone_1_occupancy", "Zone 1 Occupancy"),
            ("binary_sensor.radar_presence", "Presence"),
        ]
    )
    assert ld2450.kind == "targets"
    assert ld2450.targets == (
        ("sensor.radar_target_1_x", "sensor.radar_target_1_y"),
        ("sensor.radar_target_2_x", "sensor.radar_target_2_y"),
    )
    # Its zones are presence sensors of their rooms, not the radar's own presence.
    assert ld2450.presence == "binary_sensor.radar_presence"
    # An LD2410: how far, its settings left out.
    ld2410 = signals(
        [
            ("sensor.hall_radar_moving_distance", "Moving distance"),
            ("sensor.hall_radar_detection_distance", "Detection distance"),
            ("sensor.hall_radar_still_distance", "Still distance"),
            ("number.hall_radar_max_move_distance_gate", "Max move distance gate"),
            ("sensor.hall_radar_max_distance", "Max distance"),
            ("binary_sensor.hall_radar_has_target", "Has target"),
        ]
    )
    assert ld2410.kind == "distance"
    assert ld2410.distance == "sensor.hall_radar_detection_distance"
    assert ld2410.presence == "binary_sensor.hall_radar_has_target"
    # A tank's level, a distance without a radar's presence: no radar.
    tank = signals([("sensor.tank_distance", "Distance"), ("sensor.tank_level", "Level")])
    assert tank.kind is None
    bare = signals([("sensor.x_moving_distance", "Moving distance")])
    assert bare.kind is None
    # An Aqara FP2 through HomeKit: an occupancy for each zone, nothing of where.
    fp2 = signals(
        [
            ("binary_sensor.fp2_kitchen", "Kitchen"),
            ("binary_sensor.fp2_occupancy", "Occupancy"),
            ("sensor.fp2_light", "Light sensor light level"),
        ]
    )
    assert fp2.kind is None
    # A target named the other way round, by its name only.
    named = signals([("sensor.abc", "Target 3 X"), ("sensor.abd", "Target 3 Y")])
    assert named.targets == (("sensor.abc", "sensor.abd"),)


def test_lengths_in_their_units() -> None:
    assert length("1250", "mm", "mm") == pytest.approx(125.0)
    assert length("1.5", "m", "mm") == pytest.approx(150.0)
    assert length("80", None, "cm") == pytest.approx(80.0)
    # In the units Home Assistant shows them in (US customary too); none a length's: nothing.
    assert length("78.74", "in", "mm") == pytest.approx(200.0, abs=0.01)
    assert length("6.5", "ft", "mm") == pytest.approx(198.12)
    assert length("80", "furlongs", "cm") is None
    assert length("80", "", "cm") == pytest.approx(80.0)
    assert length("unknown", "mm", "mm") is None
    assert length("nan", "mm", "mm") is None
    assert length(None, "mm", "mm") is None


def test_a_target_is_placed_ahead_and_across_as_the_radar_looks() -> None:
    # Facing north (up the plan): ahead is -y, its right is +x.
    assert SOUTH.front == pytest.approx((0.0, -1.0))
    assert SOUTH.place(100, 200) == pytest.approx((400.0, 200.0))
    mirrored = Radar("radar", 0, 300.0, 400.0, 180.0, "living", mirror=True)
    assert mirrored.place(100, 200) == pytest.approx((200.0, 200.0))
    # Not turned: it looks down the plan, its right to -x.
    plain = Radar("radar", 0, 100.0, 0.0, 0.0, "living")
    assert plain.place(50, 100) == pytest.approx((50.0, 100.0))
    # Its field: 120 degrees across, 6 m ahead.
    assert SOUTH.sees((300, 0))
    assert SOUTH.sees((300 + 200, 400 - 120))
    assert not SOUTH.sees((300 + 300, 400 - 100))
    assert not SOUTH.sees((300, 400 + 50))
    assert not SOUTH.sees((300, 400 - 700))


def test_the_people_the_radars_see_are_on_the_plan_one_each() -> None:
    home = _home()
    readings = {
        "radar": Reading(
            (
                (-100.0, 200.0),  # in the living room
                (320.0, 250.0),  # beyond the open side, in the kitchen: seen
                (0.0, -100.0),  # behind it, in the study: not in its field
            )
        )
    }
    found = seen(home, [SOUTH], readings)
    assert [(t.room, round(t.x), round(t.y)) for t in found] == [
        ("living", 200, 200),
        ("kitchen", 620, 150),
    ]
    # A radar in the study sees through the wall a target in the living room: left out.
    study = Radar("study-radar", 0, 300.0, 790.0, 180.0, "study")
    assert seen(home, [study], {"study-radar": Reading(((0.0, 600.0),))}) == []
    # Two radars see one person: one target, between the two, seen by both.
    west = Radar("west", 0, 0.0, 200.0, 270.0, "living")
    both = seen(
        home,
        [SOUTH, west],
        {"radar": Reading(((-100.0, 200.0),)), "west": Reading(((0.0, 230.0),))},
    )
    assert len(both) == 1
    assert both[0].radars == ("radar", "west")
    assert both[0].x == pytest.approx(215.0)
    assert both[0].y == pytest.approx(200.0)
    # Two people close together, seen by one radar: two.
    close = seen(home, [SOUTH], {"radar": Reading(((-100.0, 200.0), (-60.0, 200.0)))})
    assert len(close) == 2
    assert room_weights(close) == {"living": pytest.approx(2.5)}


def test_the_cells_where_someone_is_seen_are_likelier() -> None:
    home = _home()
    cells = Cells(home)
    sight = look(home, [SOUTH], {"radar": Reading(((-100.0, 200.0),), present=True)})
    kept = range(len(cells))
    weights = cell_weights(home, cells, kept, sight)
    by_place = {(c.x, c.y): k for k, c in enumerate(cells.cells)}
    assert weights[by_place[175.0, 175.0]] > 2.0
    # Away from them, its presence on (someone still it lost, maybe): nothing said.
    assert weights[by_place[475.0, 125.0]] == pytest.approx(1.0, abs=0.01)
    # Out of its field (the study behind it, a corner beside it): nothing said.
    assert weights[by_place[275.0, 525.0]] == 1.0
    assert weights[by_place[25.0, 375.0]] == 1.0
    # Its presence off: nobody in its field.
    empty = look(home, [SOUTH], {"radar": Reading(present=False)})
    nobody = cell_weights(home, cells, kept, empty)
    assert nobody[by_place[475.0, 125.0]] == UNSEEN
    assert nobody[by_place[25.0, 375.0]] == 1.0
    # A radar that is not working, or in no room, says nothing.
    assert set(cell_weights(home, cells, kept, look(home, [SOUTH], {})).values()) == {1.0}
    lost = Radar("lost", 0, 300.0, 400.0, 180.0, None)
    assert look(home, [lost], {"lost": Reading(((0.0, 100.0),))}).targets == ()
    # One that says how far only: a ring at that distance.
    ring = cell_weights(
        home, cells, kept, look(home, [SOUTH], {"radar": Reading(distance=200.0, present=True)})
    )
    assert ring[by_place[325.0, 225.0]] > SEEN * 0.8
    assert ring[by_place[325.0, 25.0]] < 1.1


def test_each_target_is_the_carried_device_nearest_in_its_room() -> None:
    targets = [
        Target(0, 200.0, 200.0, "living"),
        Target(0, 500.0, 100.0, "living"),
        Target(0, 300.0, 600.0, "study"),
    ]
    found = match(
        {
            "alex": ("living", 0, (450.0, 150.0)),
            "sam": ("living", 0, (300.0, 250.0)),
            # Told in the kitchen: not the person seen in the living room, however near.
            "kim": ("kitchen", 0, (610.0, 120.0)),
            # Too far from anyone seen in the study.
            "lou": ("study", 0, (300.0, 600.0 + MATCH_REACH + 10)),
        },
        targets,
    )
    assert found == {"alex": targets[1], "sam": targets[0]}


def test_the_person_a_target_was_stays_it_until_their_phone_says_otherwise() -> None:
    guest, alex = Target(0, 200.0, 200.0, "living"), Target(0, 400.0, 200.0, "living")
    # Matched to the guest before (Alex was out of the radar's field): the guest still, while
    # Alex's phone is no surer of the other.
    phone = {"alex": ("living", 0, (290.0, 200.0))}
    assert match(phone, [guest, alex], {"alex": (210.0, 200.0)}) == {"alex": guest}
    # Alex's phone near them now, far from the guest: Alex's own.
    phone = {"alex": ("living", 0, (390.0, 200.0))}
    assert 190.0 - STICK > 10.0
    assert match(phone, [guest, alex], {"alex": (210.0, 200.0)}) == {"alex": alex}
    # Followed beyond `MATCH_REACH` of the phone while it is theirs.
    far = {"alex": ("living", 0, (200.0 + MATCH_REACH + 50, 200.0))}
    assert match(far, [guest], {"alex": (190.0, 200.0)}) == {"alex": guest}
    assert match(far, [guest]) == {}


def test_someone_no_device_names_keeps_their_number_as_they_walk() -> None:
    first = follow({}, [Target(0, 100.0, 100.0, "living"), Target(0, 400.0, 100.0, "living")], 0)
    assert sorted(first) == [0, 1]
    walked = follow(
        first, [Target(0, 420.0, 150.0, "living"), Target(0, 150.0, 100.0, "living")], 2
    )
    assert walked[1].x == 420.0
    assert walked[0].x == 150.0
    # One left, another came far from them: a new number.
    other = follow(walked, [Target(0, 420.0, 160.0, "living"), Target(0, 50.0, 350.0, "living")], 2)
    assert sorted(other) == [1, 2]


def test_a_radar_pulls_a_phone_s_spot_to_where_it_sees_someone() -> None:
    """Bluetooth alone finds a phone in the right room; a radar there finds where in it."""
    home = _home()
    cells = Cells(home)
    receivers = {"r1": Spot(0, 50, 50, 120), "r2": Spot(0, 550, 350, 120)}
    plan = cell_prior(home, cells, receivers)
    model = Model(prior(home, receivers), {})
    rooms = {"living", *home.neighbours["living"]}
    phone = Spot(0, 450.0, 120.0, HELD_AT)
    sight = look(home, [SOUTH], {"radar": Reading(((150.0, 280.0),), present=True)})
    noise = random.Random(5)  # noqa: S311 (readings, not secrets)
    found: dict[str, tuple[float, float, float] | None] = {}
    for weighed in (False, True):
        cloud = Cloud(cells)
        for _ in range(20):
            cloud.around("living", rooms)
            cloud.predict(2.0)
            readings = {
                s: expected_at(home, phone, r) + noise.gauss(0, 4) for s, r in receivers.items()
            }
            kept = list(cloud.chances)
            scores = model.cell_scores(
                plan, ((k, cells.cells[k].room) for k in kept), readings, [], 0.0
            )
            radar = cell_weights(home, cells, kept, sight) if weighed else {}
            cloud.update(dict(zip(kept, scores, strict=True)), {}, radar)
        found[str(weighed)] = cloud.spot("living")
    alone, merged = found["False"], found["True"]
    assert alone is not None
    assert merged is not None
    assert math.dist(merged[:2], (450.0, 120.0)) < 60
    assert merged[2] < alone[2]
