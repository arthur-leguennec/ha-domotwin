"""How well the rooms are found (M41): the tallies, alone."""

from __future__ import annotations

from datetime import UTC, datetime

from custom_components.domotwin.locating.measure import SETTLE, SHORT_STAY, Measure, Tally

START = datetime(2026, 3, 2, 9, 0, tzinfo=UTC)


def test_a_tally_counts_changes_storeys_flickers_and_time_unknown() -> None:
    tally = Tally()
    clock = 0.0

    def stay(place: str | None, storey: int | None, seconds: float) -> None:
        nonlocal clock
        for _ in range(int(seconds // 2)):
            clock += 2
            tally.add(place, storey, clock, 2, counting=True)

    stay("kitchen", 0, 600)
    stay(None, None, 60)
    # Back where it was after a while unknown: no change.
    stay("kitchen", 0, 60)
    stay("living", 0, 10)
    stay("kitchen", 0, 600)
    stay("bedroom", 1, 1200)
    assert tally.changes == 3
    assert tally.storey_changes == 1
    # The living room for ten seconds: one flicker.
    assert tally.short == 1
    figures = tally.figures()
    assert figures["hours"] == round(2530 / 3600, 2)
    assert figures["changes_per_hour"] == round(3 / (2530 / 3600), 1)
    assert figures["unknown_share"] == round(60 / 2530, 3)
    assert figures["right_share"] is None
    assert Tally().figures()["changes_per_hour"] is None
    assert SHORT_STAY == 30.0
    # A storey known only once the plan is read: a later change of storey is still one.
    late = Tally()
    late.add("hall", None, 2, 2, counting=True)
    late.add("hall", 0, 4, 2, counting=True)
    late.add("bedroom", 1, 100, 2, counting=True)
    assert late.storey_changes == 1


BERMUDA = "sensor.phone_area"


def test_witnesses_and_bermuda_side_by_side() -> None:
    measure = Measure(START)
    for _ in range(30):
        # DomoTwin says the office (area office), Bermuda the office too, a presence sensor
        # alone in the office says so as well.
        measure.tick(
            2,
            {"phone": ("office", 1, "office")},
            {"phone": (BERMUDA, "office", 1)},
            {"phone": ("office", "office")},
        )
    for _ in range(30):
        # Bermuda hesitates: the bedroom upstairs; nobody witnesses.
        measure.tick(2, {"phone": ("office", 1, "office")}, {"phone": (BERMUDA, "bedroom", 2)}, {})
    for _ in range(30):
        measure.tick(2, {"phone": ("office", 1, "office")}, {"phone": (BERMUDA, "office", 1)}, {})
    shown = measure.figures()["phone"]
    assert shown["domotwin"]["right_share"] == 1.0
    assert shown["domotwin"]["changes_per_hour"] == 0.0
    assert shown["bermuda"]["right_share"] == 1.0
    assert shown["bermuda"]["changes_per_hour"] == round(2 / (180 / 3600), 1)
    assert shown["bermuda"]["storey_changes_per_hour"] == shown["bermuda"]["changes_per_hour"]
    assert shown["agreement"] == round(120 / 180, 3)
    # A device without Bermuda shows DomoTwin's figures alone.
    phone = {"phone": (BERMUDA, "office", 1)}
    measure.tick(2, {"phone": ("office", 1, "office"), "keys": (None, None, None)}, phone, {})
    assert set(measure.figures()["keys"]) == {"domotwin"}
    # Paired with another of Bermuda's sensors: its figures start again; unpaired, they go.
    measure.tick(
        2, {"phone": ("office", 1, "office")}, {"phone": ("sensor.x_area", "office", 1)}, {}
    )
    assert measure.figures()["phone"]["bermuda"]["hours"] == round(2 / 3600, 2)
    assert measure.devices["phone"].bermuda.seconds == 2
    assert measure.devices["phone"].own_area.seconds == 2
    measure.tick(2, {"phone": ("office", 1, "office")}, {}, {})
    assert set(measure.figures()["phone"]) == {"domotwin"}


def test_pauses_are_not_counted_and_devices_no_longer_followed_are_forgotten() -> None:
    measure = Measure(START)
    assert measure.tick(2, {"phone": ("office", 1, None)}, {}, {})
    # Home Assistant busy for a minute: not a minute in the office.
    measure.tick(60, {"phone": ("office", 1, None)}, {}, {})
    measure.tick(0, {"phone": ("office", 1, None)}, {}, {})
    assert measure.devices["phone"].own.seconds == 2
    assert measure.tick(2, {}, {}, {})
    assert measure.devices == {}
    # Nothing followed: nothing changes, nothing to save.
    assert not measure.tick(2, {}, {}, {})
    measure.tick(2, {"keys": ("hall", 0, None)}, {}, {})
    measure.forget("keys")
    assert measure.devices == {}


def test_the_rooms_settle_after_a_start() -> None:
    measure = Measure(START)
    for room in ("hall", "office"):
        for _ in range(int(SETTLE // 4)):
            measure.tick(2, {"phone": (room, 0, None)}, {}, {})
    # Found in the hall, then the office, within the first minute: not a change.
    assert measure.devices["phone"].own.changes == 0
    measure.tick(2, {"phone": ("hall", 0, None)}, {}, {})
    assert measure.devices["phone"].own.changes == 1
    # Read again after a restart: settling again.
    read = Measure.read(measure.stored(), START)
    read.tick(2, {"phone": ("office", 0, None)}, {}, {})
    read.tick(2, {"phone": ("hall", 0, None)}, {}, {})
    assert read.devices["phone"].own.changes == 1
    # A device followed later settles too.
    for k in range(10):
        room = "hall" if k % 2 else "office"
        measure.tick(2, {"phone": ("hall", 0, None), "watch": (room, 0, None)}, {}, {})
    assert measure.devices["watch"].own.changes == 0


def test_a_pause_ends_no_stay_short() -> None:
    measure = Measure(START)
    for _ in range(40):
        measure.tick(2, {"phone": ("office", 0, None)}, {}, {})
    measure.tick(2, {"phone": ("hall", 0, None)}, {}, {})
    # Five minutes in the hall, Home Assistant busy meanwhile: not a flicker when it goes on.
    measure.tick(300, {"phone": ("hall", 0, None)}, {}, {})
    measure.tick(2, {"phone": ("office", 0, None)}, {}, {})
    tally = measure.devices["phone"].own
    assert tally.changes == 2
    assert tally.short == 0


def test_domotwin_by_area_beside_bermuda() -> None:
    measure = Measure(START)
    for _ in range(40):
        measure.tick(2, {"phone": ("living", 0, "open")}, {"phone": (BERMUDA, "open", 0)}, {})
    # The living room and the kitchen are one area: a change of room, not of area.
    for _ in range(5):
        measure.tick(2, {"phone": ("kitchen", 0, "open")}, {"phone": (BERMUDA, "open", 0)}, {})
    shown = measure.figures()["phone"]
    assert measure.devices["phone"].own.changes == 1
    assert measure.devices["phone"].own_area.changes == 0
    assert shown["domotwin_areas"]["changes_per_hour"] == 0.0
    assert shown["agreement"] == 1.0
    stored = Measure.read(measure.stored(), START)
    assert stored.figures() == measure.figures()


def test_kept_across_restarts() -> None:
    measure = Measure(START)
    for room in ("office", "living", "office"):
        for _ in range(20):
            measure.tick(2, {"phone": (room, 0, room)}, {"phone": (BERMUDA, room, 0)}, {})
    stored = measure.stored()
    read = Measure.read(stored, datetime(2026, 3, 3, tzinfo=UTC))
    assert read.started == START
    assert read.figures() == measure.figures()
    # What is wrong reads as nothing; nothing stored starts now.
    assert Measure.read({"devices": {"x": {"own": {"changes": -1, "seconds": "a"}}}}, START)
    assert Measure.read(None, START).started == START
    broken = Measure.read({"started": "soon", "devices": {"x": {"both": 3, "same": 9}}}, START)
    assert broken.started == START
    assert broken.devices["x"].same == 3
    assert broken.devices["x"].own.figures()["hours"] == 0
    # No share above the whole.
    bad = {"seconds": 100, "unknown": 500, "witnessed": 10, "right": 90}
    over = Tally.read(bad).figures()
    assert over["unknown_share"] == 1.0
    assert over["right_share"] == 1.0
    assert read.devices["phone"].sensor == BERMUDA
    # Started again: nothing left.
    measure.reset(datetime(2026, 3, 4, tzinfo=UTC))
    assert measure.figures() == {}
