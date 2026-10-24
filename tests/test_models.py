"""The 3D files of user models: upload, reading, checks of models and clean-up of unused files."""

from __future__ import annotations

from http import HTTPStatus
import os
from pathlib import Path
import time
from typing import Any

from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.components.diagnostics import (
    get_diagnostics_for_config_entry,
)
from pytest_homeassistant_custom_component.typing import (
    ClientSessionGenerator,
    WebSocketGenerator,
)

from custom_components.domotwin.const import MAX_MODEL_BYTES, MAX_MODELS
from homeassistant.core import HomeAssistant

from .conftest import ROOT

STOOL = (ROOT / "examples" / "models" / "stool.glb").read_bytes()
STL = (ROOT / "examples" / "models" / "stool.stl").read_bytes()


def model(digest: str, size: int = len(STOOL), file_format: str = "glb") -> dict[str, Any]:
    """A model entry of an overlay for a file."""
    return {
        "model": {
            "name": "Stool",
            "size": [38, 38, 71],
            "file": {"format": file_format, "hash": digest, "bytes": size, "up": "y"},
        }
    }


async def upload(client: Any, data: bytes, file_format: str = "glb") -> Any:
    return await client.post(f"/api/domotwin/models?format={file_format}", data=data)


async def test_upload_and_read_back(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_client: ClientSessionGenerator,
    config_dir: Path,
) -> None:
    client = await hass_client()
    response = await upload(client, STOOL)
    assert response.status == HTTPStatus.OK
    result = await response.json()
    digest = result["hash"]
    assert result == {"hash": digest, "bytes": len(STOOL), "format": "glb"}
    assert (config_dir / "domotwin" / "models" / f"{digest}.glb").read_bytes() == STOOL
    # The same file again: the same name.
    assert (await (await upload(client, STOOL)).json())["hash"] == digest

    response = await client.get(f"/api/domotwin/models/{digest}.glb")
    assert response.status == HTTPStatus.OK
    assert await response.read() == STOOL
    assert response.headers["Content-Type"] == "model/gltf-binary"
    assert "immutable" in response.headers["Cache-Control"]
    for name in (f"{digest}.stl", "../secrets.yaml", f"{digest[:-1]}.glb", "x.glb"):
        assert (await client.get(f"/api/domotwin/models/{name}")).status == HTTPStatus.NOT_FOUND


async def test_uploads_are_checked(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_client: ClientSessionGenerator,
    hass_client_no_auth: ClientSessionGenerator,
    hass_read_only_access_token: str,
) -> None:
    reader = await hass_client(hass_read_only_access_token)
    response = await upload(reader, STOOL)
    assert response.status == HTTPStatus.FORBIDDEN
    assert (await response.json())["code"] == "unauthorized"
    anonymous = await hass_client_no_auth()
    assert (await upload(anonymous, STOOL)).status == HTTPStatus.UNAUTHORIZED

    admin = await hass_client()
    assert (await upload(admin, STOOL, "fbx")).status == HTTPStatus.BAD_REQUEST
    for data, file_format in ((b"hello", "stl"), (STL, "glb"), (b"\x00\x01", "obj"), (b"", "3mf")):
        response = await upload(admin, data, file_format)
        assert response.status == HTTPStatus.BAD_REQUEST, file_format
        assert (await response.json())["code"] == "not_model"
    assert (await upload(admin, STL, "stl")).status == HTTPStatus.OK
    huge = b"glTF" + bytes(MAX_MODEL_BYTES)
    response = await upload(admin, huge)
    assert response.status == HTTPStatus.REQUEST_ENTITY_TOO_LARGE
    assert (await response.json())["code"] == "too_large"


async def test_views_wait_for_the_integration(
    hass: HomeAssistant, config_entry: MockConfigEntry, hass_client: ClientSessionGenerator
) -> None:
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    client = await hass_client()
    response = await upload(client, STOOL)
    assert response.status == HTTPStatus.SERVICE_UNAVAILABLE


async def test_models_in_overlays_and_plans_are_checked(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    digest = "a" * 64

    async def save(**payload: Any) -> dict[str, Any]:
        await client.send_json_auto_id({"type": "domotwin/plan/save", **payload})
        reply: dict[str, Any] = await client.receive_json()
        return reply

    assert (await save(plan=demo_plan, layout={"@model:m-1": model(digest)}))["success"]
    bad: list[dict[str, Any]] = [
        {"@model:bad id": model(digest)},
        {"@model:m-1": model("A" * 64)},
        {"@model:m-1": model(digest, size=MAX_MODEL_BYTES + 1)},
        {"@model:m-1": {"model": {**model(digest)["model"], "size": [38, 38, 400]}}},
        {"@model:m-1": {"model": {**model(digest)["model"], "kit": {"parts": []}}}},
        {"@model:m-1": {"model": {"name": "x", "size": [1, 1, 1]}}},
        {"@model:m-1": {"x": 1}},
    ]
    with_data = model(digest)
    with_data["model"]["file"]["data"] = "data:model/gltf-binary;base64,AAAA"
    bad.append({"@model:m-1": with_data})
    for layout in bad:
        reply = await save(layout=layout)
        assert reply["error"]["code"] == "invalid_layout", layout
    many = {f"@model:m-{i}": model(digest) for i in range(MAX_MODELS + 1)}
    assert (await save(layout=many))["error"]["code"] == "too_many_models"
    heavy = {f"@model:m-{i}": model(digest, size=MAX_MODEL_BYTES) for i in range(3)}
    assert (await save(layout=heavy))["error"]["code"] == "too_large"
    # A plan's own models count too, and are checked the same way.
    plan = {**demo_plan, "models": {f"p-{i}": model(digest)["model"] for i in range(MAX_MODELS)}}
    assert (await save(plan=plan, layout={"@model:m-1": model(digest)}))["error"][
        "code"
    ] == "too_many_models"
    embedded = {**demo_plan, "models": {"p-1": with_data["model"]}}
    assert (await save(plan=embedded))["error"]["code"] == "invalid_plan"


async def test_unused_files_go_after_a_day_and_all_with_the_integration(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_client: ClientSessionGenerator,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    config_dir: Path,
) -> None:
    http = await hass_client()
    used = (await (await upload(http, STOOL)).json())["hash"]
    unused = (await (await upload(http, STL, "stl")).json())["hash"]
    folder = config_dir / "domotwin" / "models"
    (folder / ".upload-left-over").write_bytes(b"x")
    client = await hass_ws_client(hass)
    layout = {"@model:m-1": model(used)}
    await client.send_json_auto_id(
        {"type": "domotwin/plan/save", "plan": demo_plan, "layout": layout}
    )
    assert (await client.receive_json())["success"]
    # Uploaded a moment ago: kept (an import not saved yet).
    assert len(list(folder.iterdir())) == 3

    diagnostics = await get_diagnostics_for_config_entry(hass, hass_client, setup_integration)
    assert diagnostics["model_files"] == {"files": 2, "bytes": len(STOOL) + len(STL)}
    assert diagnostics["layout_models"] == 1

    old = time.time() - 2 * 86_400
    for path in folder.iterdir():
        os.utime(path, (old, old))
    await client.send_json_auto_id({"type": "domotwin/plan/save", "layout": layout})
    assert (await client.receive_json())["success"]
    assert sorted(p.name for p in folder.iterdir()) == [f"{used}.glb"]
    assert unused not in str(list(folder.iterdir()))

    assert await hass.config_entries.async_remove(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert not folder.exists()
