"""Voice at hand (D-041): the blueprints installed from the settings, local voice set up."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin import voice
from homeassistant.components.hassio import AddonError, AddonInfo, AddonState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from .conftest import ROOT


async def _ask(client: Any, message: dict[str, Any]) -> dict[str, Any]:
    await client.send_json_auto_id(message)
    answer: dict[str, Any] = await client.receive_json()
    return answer


def test_the_shipped_blueprints_are_the_repository_s() -> None:
    # The integration installs its own copies; the repository's are what an import link reads.
    for name in voice.BLUEPRINTS:
        shipped = (voice.SHIPPED / f"{name}.yaml").read_text(encoding="utf-8")
        published = ROOT / "blueprints" / "automation" / "domotwin" / f"{name}.yaml"
        assert shipped == published.read_text(encoding="utf-8"), name


async def test_blueprints_installed_from_the_settings(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    config_dir: Path,
) -> None:
    client = await hass_ws_client(hass)
    got = await _ask(client, {"type": "domotwin/voice/get"})
    assert got["result"]["supervisor"] is False
    assert got["result"]["blueprints"] == {"show_by_voice": "missing", "where_by_voice": "missing"}
    assert got["result"]["setup"]["step"] == "idle"
    assert got["result"]["language"] == "en"
    assert got["result"]["piper_voice"] == "en_US-lessac-medium"

    done = await _ask(client, {"type": "domotwin/voice/blueprints"})
    assert done["result"]["blueprints"] == {
        "show_by_voice": "installed",
        "where_by_voice": "installed",
    }
    folder = config_dir / "blueprints" / "automation" / "domotwin"
    assert (folder / "show_by_voice.yaml").read_text(encoding="utf-8") == (
        voice.SHIPPED / "show_by_voice.yaml"
    ).read_text(encoding="utf-8")

    # Edited by its user: kept, unless replaced.
    (folder / "where_by_voice.yaml").write_text("blueprint: {}\n", encoding="utf-8")
    kept = await _ask(client, {"type": "domotwin/voice/blueprints"})
    assert kept["result"]["blueprints"]["where_by_voice"] == "changed"
    replaced = await _ask(client, {"type": "domotwin/voice/blueprints", "replace": True})
    assert replaced["result"]["blueprints"]["where_by_voice"] == "installed"


async def test_voice_set_up_by_administrators_on_the_supervisor_only(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
) -> None:
    reader = await hass_ws_client(hass, hass_read_only_access_token)
    for message in (
        {"type": "domotwin/voice/blueprints"},
        {"type": "domotwin/voice/setup", "stt": "whisper"},
    ):
        refused = await _ask(reader, message)
        assert refused["error"]["code"] == "unauthorized"
    client = await hass_ws_client(hass)
    refused = await _ask(client, {"type": "domotwin/voice/setup", "stt": "whisper"})
    assert refused["error"]["code"] == "no_supervisor"
    wrong = await _ask(client, {"type": "domotwin/voice/setup", "stt": "siri"})
    assert wrong["error"]["code"] == "invalid_format"


@dataclass
class FakeApps:
    """The Supervisor's store: what is installed and running, what was done."""

    installed: set[str]
    running: set[str]
    options: dict[str, dict[str, Any]]
    done: list[str]
    fail: str | None = None
    #: The Supervisor refuses the options set (a language the app does not know).
    refuse_options: bool = False

    def manager(self, _hass: Any, _logger: Any, name: str, slug: str) -> Any:
        """An `AddonManager` of one app of this store."""
        apps = self

        async def info() -> AddonInfo:
            state = (
                AddonState.RUNNING
                if slug in apps.running
                else AddonState.NOT_RUNNING
                if slug in apps.installed
                else AddonState.NOT_INSTALLED
            )
            return AddonInfo(
                available=True,
                hostname=None,
                options=dict(apps.options.get(slug, {})),
                state=state,
                update_available=False,
                version="1",
            )

        async def install() -> None:
            if apps.fail == slug:
                raise AddonError(f"{name} could not be installed")
            apps.done.append(f"install {slug}")
            apps.installed.add(slug)

        async def set_options(options: dict[str, Any]) -> None:
            if apps.refuse_options:
                raise AddonError(f"{name} refused its options")
            apps.done.append(f"options {slug}")
            apps.options[slug] = options

        async def start() -> None:
            apps.done.append(f"start {slug}")
            apps.running.add(slug)

        return SimpleNamespace(
            async_get_addon_info=info,
            async_install_addon=install,
            async_set_addon_options=set_options,
            async_start_addon=start,
        )


async def test_local_voice_set_up_on_the_supervisor(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    hass.config.language = "fr"
    # Piper was installed before, set to its user's voice: it is started, not changed.
    apps = FakeApps(
        installed={"core_piper"},
        running=set(),
        options={
            "core_whisper": {"model": "tiny-int8", "language": "en"},
            "core_piper": {"voice": "en_US-lessac-medium"},
        },
        done=[],
    )
    # What the Wyoming integration adds once a discovery is accepted: an entry for the app's host
    # and its entity.
    registry = er.async_get(hass)
    engines = {
        "f-whisper": ("core-whisper", "stt", "whisper"),
        "f-piper": ("core-piper", "tts", "piper"),
    }
    accepted: list[str] = []

    async def configure(flow_id: str, _data: dict[str, Any]) -> None:
        accepted.append(flow_id)
        host, domain, name = engines[flow_id]
        entry = MockConfigEntry(domain="wyoming", data={"host": host, "port": 10300})
        entry.add_to_hass(hass)
        registry.async_get_or_create(
            domain, "wyoming", name, config_entry=entry, suggested_object_id=name
        )

    # An engine of another Wyoming server, already there, is not taken.
    other = MockConfigEntry(domain="wyoming", data={"host": "speech-elsewhere", "port": 10300})
    other.add_to_hass(hass)
    registry.async_get_or_create(
        "stt", "wyoming", "other", config_entry=other, suggested_object_id="other"
    )

    def flow(flow_id: str, slug: str) -> dict[str, Any]:
        url = f"homeassistant://hassio/addon/{slug}/info"
        return {"flow_id": flow_id, "context": {"source": "hassio", "configuration_url": url}}

    # Another app's discovery waits for its user: it is left alone.
    flows = [
        flow("f-whisper", "core_whisper"),
        flow("f-piper", "core_piper"),
        flow("f-wake", "core_openwakeword"),
    ]
    create = AsyncMock(return_value=SimpleNamespace(id="pipeline-1"))
    client = await hass_ws_client(hass)
    with (
        patch("custom_components.domotwin.voice.is_hassio", return_value=True),
        patch("homeassistant.components.hassio.AddonManager", apps.manager),
        patch.object(
            hass.config_entries.flow, "async_progress_by_handler", side_effect=lambda _h: flows
        ),
        patch.object(hass.config_entries.flow, "async_configure", side_effect=configure),
        patch("custom_components.domotwin.voice._pipelines", return_value=[]),
        patch("custom_components.domotwin.voice._async_create_pipeline", create),
        patch("custom_components.domotwin.voice._prefer_if_deaf") as prefer,
    ):
        started = await _ask(client, {"type": "domotwin/voice/setup", "stt": "whisper"})
        assert started["success"], started
        await voice._setup_of(hass).task  # type: ignore[misc]
    setup = voice._setup_of(hass).as_dict()
    assert setup == {"step": "done", "app": None, "error": None, "pipeline": "pipeline-1"}
    # Whisper installed in French and started; Piper started as it was; DomoTwin's discoveries
    # accepted, not the other; one pipeline, made the preferred one if Assist could not hear.
    assert apps.done == [
        "install core_whisper",
        "options core_whisper",
        "start core_whisper",
        "start core_piper",
    ]
    assert apps.options["core_whisper"]["language"] == "fr"
    assert apps.options["core_piper"]["voice"] == "en_US-lessac-medium"
    assert sorted(set(accepted)) == ["f-piper", "f-whisper"]
    assert create.await_args is not None
    assert create.await_args.args[1:] == ("stt.whisper", "tts.piper")
    prefer.assert_called_once_with(hass, "pipeline-1")


async def test_a_failed_set_up_says_why(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    apps = FakeApps(installed=set(), running=set(), options={}, done=[], fail="core_whisper")
    client = await hass_ws_client(hass)
    with (
        patch("custom_components.domotwin.voice.is_hassio", return_value=True),
        patch("homeassistant.components.hassio.AddonManager", apps.manager),
    ):
        await _ask(client, {"type": "domotwin/voice/setup", "stt": "whisper"})
        await voice._setup_of(hass).task  # type: ignore[misc]
    assert voice._setup_of(hass).as_dict()["error"] == "app"
    assert voice._setup_of(hass).step == "failed"


def test_whisper_s_language_by_its_own_code() -> None:
    assert voice._options("core_whisper", {"language": "en"}, "nb") == {"language": "no"}
    assert voice._options("core_whisper", {"language": "en"}, "pt-BR") == {"language": "pt"}


def test_piper_s_voice_in_each_language_it_speaks() -> None:
    """D-081: a voice in the language when Piper has one, the app's own when it has none."""
    assert voice._options("core_piper", {"voice": "x"}, "de-CH") == {
        "voice": "de_DE-thorsten-medium"
    }
    assert voice._options("core_piper", {"voice": "x"}, "pt-BR") == {"voice": "pt_BR-faber-medium"}
    assert voice._options("core_piper", {"voice": "x"}, "pt") == {"voice": "pt_PT-tugão-medium"}
    assert voice._options("core_piper", {"voice": "x"}, "ja") == {"voice": "x"}
    assert voice._options("core_piper", {"voice": "x"}, "sv") == {"voice": "x"}
    assert voice._options("core_piper", {"voice": "x"}, "en-GB") == {"voice": "en_US-lessac-medium"}


async def test_an_ignored_discovery_is_said_at_once_and_refused_options_are_kept(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    # Home Assistant was told to ignore Piper's discovery: it will not come.
    MockConfigEntry(domain="wyoming", source="ignore", title="Piper").add_to_hass(hass)
    apps = FakeApps(installed=set(), running=set(), options={}, done=[], refuse_options=True)
    apps.options["core_whisper"] = {"language": "en"}
    client = await hass_ws_client(hass)
    with (
        patch("custom_components.domotwin.voice.is_hassio", return_value=True),
        patch("homeassistant.components.hassio.AddonManager", apps.manager),
    ):
        started = await _ask(client, {"type": "domotwin/voice/setup", "stt": "whisper"})
        assert started["success"], started
        await voice._setup_of(hass).task  # type: ignore[misc]
    # The apps were installed and started with their own settings, then the discovery said.
    assert apps.done == [
        "install core_whisper",
        "start core_whisper",
        "install core_piper",
        "start core_piper",
    ]
    assert voice._setup_of(hass).as_dict()["error"] == "ignored"
