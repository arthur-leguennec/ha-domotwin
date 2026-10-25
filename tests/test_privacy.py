"""Which private rooms a viewer may not see (D-039)."""

from __future__ import annotations

import pytest

from custom_components.domotwin.privacy import private_rooms
from custom_components.domotwin.validation import InvalidPayloadError, validate_settings
from homeassistant.core import State

STATES = {
    "person.alex": State("person.alex", "home", {"user_id": "u-alex"}),
    "person.sam": State("person.sam", "home", {}),
    "input_boolean.guests": State("input_boolean.guests", "off"),
    "input_boolean.night": State("input_boolean.night", "on"),
    "binary_sensor.gone": State("binary_sensor.gone", "unavailable"),
}

ROOMS = {
    "bedroom": {"people": ["person.alex"]},
    "office": {"people": []},
    "guest": {"people": [], "while": "input_boolean.guests"},
    "kids": {"people": ["person.alex"], "while": "input_boolean.night"},
    "attic": {"people": [], "while": "binary_sensor.gone"},
    "cellar": {"people": [], "while": "switch.missing"},
}


def test_who_may_see_which_room() -> None:
    # Alex's user sees the rooms kept for Alex; nobody sees the office; the guest room is open
    # while its switch is off; an entity unavailable or missing keeps a room private.
    assert private_rooms(ROOMS, STATES.get, "u-alex") == {"office", "attic", "cellar"}
    for user in (None, "u-other"):
        assert private_rooms(ROOMS, STATES.get, user) == {
            "bedroom",
            "office",
            "kids",
            "attic",
            "cellar",
        }
    # Sam has no user: being listed is not enough.
    assert private_rooms({"bedroom": {"people": ["person.sam"]}}, STATES.get, None) == {"bedroom"}
    assert private_rooms({}, STATES.get, "u-alex") == set()


@pytest.mark.parametrize(
    ("rooms", "says"),
    [
        ([], "must be an object"),
        ({f"room{k}": {"people": []} for k in range(201)}, "at most 200 private rooms"),
        ({"bedroom": {"people": ["light.lamp"]}}, "list of `person` entities"),
        ({"bedroom": {"people": "person.alex"}}, "list of `person` entities"),
        ({"bedroom": {"people": [f"person.p{k}" for k in range(51)]}}, "at most 50 people"),
    ],
)
def test_a_refusal_says_what_is_wrong(rooms: object, says: str) -> None:
    with pytest.raises(InvalidPayloadError, match=says):
        validate_settings({"rooms": rooms})
