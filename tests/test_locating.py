"""Bluetooth locating (D-035), the pure parts.

The home's walls and ways, keys and beacons, the signal model and the filter, on a walk through
the demo apartment with noisy readings.
"""

from __future__ import annotations

import json
import random
import statistics
from typing import Any

import pytest

from custom_components.domotwin.locating.filter import (
    PRESENCE_OFF,
    PRESENCE_ON,
    RoomFilter,
    presence_weight,
)
from custom_components.domotwin.locating.geometry import Home, Spot
from custom_components.domotwin.locating.identity import (
    Match,
    Matcher,
    beacon_of,
    resolvable,
    resolves,
)
from custom_components.domotwin.locating.radio import (
    HEARD_ABOVE,
    MAX_WEIGHT,
    Learned,
    Model,
    expected_at,
    prior,
)

from .conftest import ROOT

# The Bluetooth Core specification's sample of the `ah` function (vol. 3, part H, D.7).
SPEC_KEY = bytes.fromhex("ec0234a357c8ad05341010a60a397d9b")
SPEC_ADDRESS = "70:81:94:0D:FB:AA"


def _demo(**layouts: dict[str, Any]) -> Home:
    ground = json.loads((ROOT / "examples" / "demo-apartment.domotwin.json").read_text())
    upper = json.loads((ROOT / "examples" / "demo-upper-floor.domotwin.json").read_text())
    return Home(
        [
            {"id": "ground", "elevation": 0, "plan": ground, "layout": layouts.get("ground", {})},
            {"id": "upper", "elevation": 280, "plan": upper, "layout": {}},
        ]
    )


def test_walls_doors_and_open_sides_between_rooms() -> None:
    home = _demo()
    living = home.middle("living")
    # The kitchen is open to the living room, the hall through a door, the bathroom behind a
    # wall.
    assert home.walls(living, home.middle("kitchen")) == 0
    assert home.walls(living, home.middle("hall")) == pytest.approx(0.4)
    assert home.walls(living, home.middle("bathroom")) == 1
    assert home.walls(living, living) == 0
    # Out of the home and back in: two façades.
    outside = Spot(0, -500, 200, 120)
    assert home.walls(outside, living) == 1
    assert home.floors(living, home.middle("up-office")) == 1


def test_the_placement_advisor_counts_the_same_walls() -> None:
    """The advisor (D-065) counts walls in the page as the locating does: both match a fixture.

    `scripts/make-coverage-fixture.py` writes it from this geometry; the core's tests read it too.
    """
    fixture = json.loads((ROOT / "tests" / "fixtures" / "coverage-walls.json").read_text())
    home = Home(
        [
            {**storey, "plan": json.loads((ROOT / storey["plan"]).read_text())}
            for storey in fixture["storeys"]
        ]
    )

    def spot(found: Spot | None) -> list[float] | None:
        # As the fixture writes places: to a millionth of a centimetre.
        if found is None:
            return None
        return [found.storey, round(found.x, 6), round(found.y, 6), round(found.z, 6)]

    assert list(home.rooms) == fixture["rooms"]
    for room, points in fixture["points"].items():
        assert [spot(p) for p in home.points(room)] == points
        assert spot(home.middle(room)) == fixture["middles"][room]
    for piece, wanted in fixture["pieces"].items():
        assert spot(home.pieces.get(piece)) == wanted
    spots = [Spot(int(p[0]), p[1], p[2], p[3]) for p in fixture["spots"]]
    walls = [[home.walls(a, b) for b in spots] for a in spots]
    assert walls == [pytest.approx(row) for row in fixture["walls"]]


def test_rooms_lead_to_rooms_through_doors_open_sides_and_stairs() -> None:
    home = _demo()
    assert home.neighbours["living"] == {"kitchen", "hall"}
    assert home.neighbours["bedroom"] == {"hall"}
    # The stairs join the hall to the landing upstairs.
    assert "up-landing" in home.neighbours["hall"]
    assert "hall" in home.neighbours["up-landing"]


def test_a_plan_without_doors_joins_rooms_that_share_a_side() -> None:
    square = [[0, 0], [300, 0], [300, 300], [0, 300]]
    beside = [[300, 0], [600, 0], [600, 300], [300, 300]]
    home = Home(
        [
            {
                "id": "s",
                "plan": {
                    "rooms": [
                        {"id": "a", "outline": square},
                        {"id": "b", "outline": beside},
                        {"id": "c", "outline": [[900, 0], [1200, 0], [1200, 300], [900, 300]]},
                        {"id": "bad", "outline": [[0, 0]]},
                        {"id": "flat", "outline": [[0, 0], [100, 0], [200, 0]]},
                        {"id": "dot", "outline": [[5, 5], [5, 5], [5, 5]]},
                    ]
                },
            }
        ]
    )
    # A room with no room in it (its corners on a line) is left out.
    assert home.neighbours == {"a": {"b"}, "b": {"a"}, "c": set()}
    assert 6 <= len(home.points("a")) <= 12
    assert all(25 <= p.x <= 275 and 25 <= p.y <= 275 for p in home.points("a"))


def test_pieces_are_where_the_overlay_moved_them() -> None:
    home = _demo(
        ground={
            "sofa": {"at": [100, 100], "lift": 10},
            "plant-living": {"removed": True},
            "speaker-added-1": {
                "add": {"name": "Speaker", "kind": "box", "size": [20, 20, 30]},
                "at": [50, 60],
            },
        }
    )
    sofa = home.pieces["sofa"]
    assert (sofa.storey, sofa.x, sofa.y) == (0, 100, 100)
    assert sofa.z > 10
    assert "plant-living" not in home.pieces
    assert home.pieces["speaker-added-1"] == Spot(0, 50, 60, 15)


def test_private_addresses_resolve_with_their_key() -> None:
    assert resolvable(SPEC_ADDRESS)
    assert resolves(SPEC_KEY, SPEC_ADDRESS)
    assert not resolves(SPEC_KEY, "70:81:94:0D:FB:AB")
    assert not resolves(SPEC_KEY, "F0:81:94:0D:FB:AA")  # a static address
    assert not resolves(b"short", SPEC_ADDRESS)
    assert not resolvable("not an address")


def _beacon(major: int = 1, minor: int = 2, power: int = -62) -> dict[int, bytes]:
    uuid = bytes.fromhex("e2c56db5dffb48d2b060d0f5a71096e0")
    data = b"\x02\x15" + uuid + major.to_bytes(2, "big") + minor.to_bytes(2, "big")
    return {0x004C: data + (power & 0xFF).to_bytes(1, "big")}


def test_beacons_and_devices_are_recognised() -> None:
    beacon = beacon_of(_beacon(power=-62))
    assert beacon is not None
    assert beacon.uuid == "e2c56db5-dffb-48d2-b060-d0f5a71096e0"
    assert (beacon.major, beacon.minor, beacon.power) == (1, 2, -62)
    assert beacon_of({0x004C: b"\x10\x05"}) is None
    assert beacon_of({}) is None

    matcher = Matcher(
        [
            Match("tag", address="aa:bb:cc:dd:ee:ff"),
            Match("phone", key=SPEC_KEY),
            Match("android", beacon=("e2c56db5-dffb-48d2-b060-d0f5a71096e0", 1, 2)),
        ]
    )
    assert matcher.device_of("AA:BB:CC:DD:EE:FF", {}) == "tag"
    assert matcher.device_of(SPEC_ADDRESS, {}) == "phone"
    # A beacon is known whatever address it sends from.
    assert matcher.device_of("C1:00:00:00:00:01", _beacon()) == "android"
    assert matcher.device_of("C1:00:00:00:00:02", _beacon(minor=3)) is None
    assert matcher.device_of("70:81:94:0D:FB:AB", {}) is None


def _receivers(home: Home, rooms: list[str]) -> dict[str, Spot | None]:
    return {f"R{i}": home.middle(room) for i, room in enumerate(rooms)}


def test_the_plan_says_what_each_receiver_hears_in_each_room() -> None:
    home = _demo()
    found = prior(home, {**_receivers(home, ["living", "bedroom"]), "lost": None})
    # A receiver hears its own room loudest, a room behind walls and a floor least.
    living = {room: found[room, "R0"][0] for room in home.rooms}
    assert max(living, key=living.__getitem__) == "living"
    assert living["kitchen"] > living["bedroom"] > living["up-dressing"]
    assert found["kitchen", "lost"] == (-85.0, 15.0)
    assert all(spread >= 6 for _, spread in found.values())


def test_what_is_learned_counts_and_is_kept() -> None:
    learned = Learned()
    for value in (-60, -62, -64):
        learned.add(value)
    assert learned.mean == pytest.approx(-62)
    assert learned.variance == pytest.approx(8 / 3)
    assert Learned.read(learned.stored()) == Learned(3, -62, 8)
    for _ in range(1000):
        learned.add(-70)
    assert learned.weight == pytest.approx(MAX_WEIGHT)
    assert learned.mean == pytest.approx(-70, abs=0.1)
    for bad in ([1, 2], ["a", 1, 2], [0, -60, 1], [1, -60, -1], [1, 500, 1], None):
        assert Learned.read(bad) is None


def test_the_model_explains_readings_by_the_right_room_and_loudness() -> None:
    home = _demo()
    receivers = _receivers(home, ["living", "bedroom", "bathroom", "up-office"])
    model = Model(prior(home, receivers), {})
    held = home.middle("bedroom")
    # A device 8 dB louder than a phone, heard by three receivers; the fourth hears nothing.
    readings = {
        source: expected_at(home, held, spot) + 8
        for source, spot in receivers.items()
        if spot is not None and expected_at(home, held, spot) + 8 > HEARD_ABOVE
    }
    readings.pop("R3", None)
    heard = model.heard(readings, list(receivers))
    best = max(heard, key=lambda room: heard[room].score)
    assert best == "bedroom"
    assert heard["bedroom"].offset == pytest.approx(8, abs=3)
    # What was learned in a room moves its expectation.
    learned = {("kitchen", "R0"): Learned(100, -40, 400)}
    taught = Model(prior(home, receivers), learned)
    expected = taught.expected("kitchen", "R0")
    assert expected is not None
    assert expected[0] > -45


def test_presence_sensors_weigh_in() -> None:
    assert presence_weight([("occupancy", True, 5)]) == PRESENCE_ON
    assert presence_weight([("presence", False, 60)]) == PRESENCE_OFF
    assert presence_weight([("presence", False, 5)]) == 1
    assert presence_weight([("motion", False, 600)]) == 1
    assert presence_weight([("motion", True, 1), ("presence", True, 1)]) > PRESENCE_ON
    assert presence_weight([]) == 1


def test_the_filter_is_slow_to_change_its_mind() -> None:
    filt = RoomFilter({"a": ["b"], "b": ["a"], "c": []})
    assert filt.confidence == 0
    filt.predict(2)
    assert filt.update({"a": 0, "b": -20, "c": -20}) == "a"
    # One reading that says b is not enough; two in a row are.
    filt.predict(2)
    assert filt.update({"a": -3, "b": 0, "c": -20}) == "a"
    filt.predict(2)
    assert filt.update({"a": -6, "b": 0, "c": -20}) == "b"
    # A presence sensor tips a tie.
    filt.predict(2)
    for _ in range(3):
        filt.update({"a": 0, "b": 0, "c": -40}, {"a": PRESENCE_ON, "b": PRESENCE_OFF})
    assert filt.room == "a"
    filt.reset()
    assert filt.confidence == 0
    assert not filt.room
    other = RoomFilter({"a": ["b"], "b": ["a"]})
    other.carry(filt)
    assert set(other.chances) == {"a", "b"}


ITINERARY = [
    ("living", 60),
    ("kitchen", 60),
    ("living", 20),
    ("hall", 20),
    ("bedroom", 90),
    ("hall", 16),
    ("bathroom", 60),
    ("hall", 16),
    ("up-landing", 20),
    ("up-office", 80),
    ("up-landing", 16),
    ("up-bedroom", 60),
]


def _walk(home: Home, rooms: list[str], seed: int) -> tuple[float, int]:
    """Walk the demo home with noisy readings; return how often the room told is right.

    The device is 7 dB louder than a phone, its readings off by 5 dB, one in six missed. Also
    return how often the room told changed. The first 6 s in a room are not counted.
    """
    rng = random.Random(seed)  # noqa: S311 (noise, not secrets)
    receivers = _receivers(home, rooms)
    model = Model(prior(home, receivers), {})
    filt = RoomFilter(home.neighbours)
    offset = 0.0
    right = counted = changes = 0
    told: str | None = None
    for room, seconds in ITINERARY:
        held = rng.choice(home.points(room))
        for tick in range(seconds // 2):
            readings: dict[str, float] = {}
            for source, spot in receivers.items():
                assert spot is not None
                values = [
                    value
                    for _ in range(6)
                    if rng.random() > 1 / 6
                    and (value := expected_at(home, held, spot) + 7 + rng.gauss(0, 5)) > HEARD_ABOVE
                ]
                if values:
                    readings[source] = statistics.median(values)
            filt.predict(2)
            heard = model.heard(readings, list(receivers), offset)
            now = filt.update({r: h.score for r, h in heard.items()})
            if now is not None and filt.confidence >= 0.9:
                offset += 0.05 * (heard[now].offset - offset)
            if now != told:
                changes += 1
                told = now
            if tick >= 3:
                counted += 1
                right += now == room
    return right / counted, changes


def test_a_walk_through_the_home_is_followed_room_by_room() -> None:
    home = _demo()
    every_room = ["living", "kitchen", "bathroom", "hall", "bedroom", "up-bedroom", "up-office"]
    for seed in (1, 2, 3):
        share, changes = _walk(home, [*every_room, "up-landing"], seed)
        assert share >= 0.9, (seed, share)
        assert changes <= len(ITINERARY) + 2, (seed, changes)
        # Four receivers for ten rooms on two storeys still follow most of it.
        share, _ = _walk(home, ["living", "bedroom", "up-office", "up-landing"], seed)
        assert share >= 0.75, (seed, share)
