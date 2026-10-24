"""`domotwin.show`: requests checked, then sent to every screen listening (D-029)."""

from __future__ import annotations

from pathlib import Path
import shutil
from typing import Any, cast

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.compat import vol
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

BLUEPRINT = (
    Path(__file__).parent.parent / "blueprints" / "automation" / "domotwin" / "show_by_voice.yaml"
)


async def test_a_show_request_reaches_the_screens(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
) -> None:
    # A screen of a user who is not an administrator listens too.
    screen = await hass_ws_client(hass, hass_read_only_access_token)
    await screen.send_json_auto_id({"type": "domotwin/subscribe"})
    assert (await screen.receive_json())["success"]

    request = {"room": " Kitchen ", "view": "walk", "screen": "hallway"}
    await hass.services.async_call("domotwin", "show", request, blocking=True)
    event = await screen.receive_json()
    assert event["type"] == "event"
    assert event["event"] == {
        "kind": "show",
        "show": {"room": "Kitchen", "view": "walk", "screen": "hallway"},
    }

    # No screen named: every screen.
    await hass.services.async_call(
        "domotwin", "show", {"storey": "all", "screen": ""}, blocking=True
    )
    assert (await screen.receive_json())["event"]["show"] == {"storey": "all"}


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"screen": "hallway"},
        {"room": ""},
        {"room": "x" * 101},
        {"room": "Kitchen", "screen": "the hallway"},
        {"room": "Kitchen", "colour": "red"},
    ],
)
async def test_show_requests_are_checked(
    hass: HomeAssistant, setup_integration: MockConfigEntry, data: dict[str, str]
) -> None:
    with pytest.raises(vol.Invalid):
        await hass.services.async_call("domotwin", "show", data, blocking=True)


async def test_the_voice_blueprint_shows_the_room_said(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    config_dir: Path,
) -> None:
    """Imported as is, the blueprint turns "show me the kitchen" into `domotwin.show`."""
    target = config_dir / "blueprints" / "automation" / "domotwin"
    target.mkdir(parents=True)
    shutil.copy(BLUEPRINT, target / BLUEPRINT.name)
    assert await async_setup_component(hass, "homeassistant", {})
    assert await async_setup_component(hass, "conversation", {})
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": {
                "use_blueprint": {
                    "path": "domotwin/show_by_voice.yaml",
                    "input": {"screen": "hallway", "view": "walk"},
                }
            }
        },
    )
    await hass.async_block_till_done()
    screen = await hass_ws_client(hass)
    await screen.send_json_auto_id({"type": "domotwin/subscribe"})
    assert (await screen.receive_json())["success"]

    answer = await hass.services.async_call(
        "conversation",
        "process",
        {"text": "show me the kitchen", "language": "en"},
        blocking=True,
        return_response=True,
    )
    event = await screen.receive_json()
    assert event["event"] == {
        "kind": "show",
        "show": {"room": "kitchen", "view": "walk", "screen": "hallway"},
    }
    speech = cast("Any", answer)["response"]["speech"]["plain"]["speech"]
    assert speech == "kitchen, on the screen."
