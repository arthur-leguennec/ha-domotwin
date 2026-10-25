"""Voice at hand (`docs/DECISIONS.md`, D-041).

DomoTwin's voice blueprints are installed from its settings, from the copies it ships: nothing is
downloaded. On Home Assistant OS and Supervised, local voice is set up when an administrator asks:
the Whisper (or Speech-to-Phrase) and Piper apps are installed and started through the Supervisor,
as the Z-Wave JS and Matter integrations do theirs, added through the Wyoming integration and put
in an Assist pipeline. The models run in Home Assistant; DomoTwin calls no other service.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.hassio import is_hassio
from homeassistant.util.hass_dict import HassKey

from .compat import vol

if TYPE_CHECKING:
    from homeassistant.components.hassio import AddonManager

_LOGGER = logging.getLogger(__name__)

VOICE_KEY: HassKey[VoiceSetup] = HassKey("domotwin_voice")

#: The blueprints DomoTwin ships, the same as `blueprints/` at the top of its repository.
SHIPPED = Path(__file__).parent / "blueprints" / "automation" / "domotwin"
BLUEPRINTS = ("show_by_voice", "where_by_voice")
#: Where Home Assistant reads automation blueprints, under its configuration folder.
TARGET = ("blueprints", "automation", "domotwin")

#: The apps that hear (by choice) and the one that speaks: name and Supervisor slug.
STT_APPS = {
    "whisper": ("Whisper", "core_whisper"),
    "speech-to-phrase": ("Speech-to-Phrase", "core_speech-to-phrase"),
}
TTS_APP = ("Piper", "core_piper")
#: Piper's voice for the languages DomoTwin speaks; others keep the app's own.
PIPER_VOICES = {"en": "en_US-lessac-medium", "fr": "fr_FR-siwis-medium"}
#: Home Assistant's languages Whisper knows by another code.
WHISPER_LANGUAGES = {"nb": "no"}
#: How long the apps may take to answer once started: their first start downloads their model
#: or their voice, minutes on a small computer (s).
FIND_SECONDS = 600
PIPELINE_NAME = "DomoTwin (local)"


class VoiceError(Exception):
    """A step of the set-up that failed, with a code the frontend translates."""

    def __init__(self, code: str) -> None:
        """Keep the code."""
        super().__init__(code)
        self.code = code


@dataclass
class VoiceSetup:
    """Where the set-up of local voice is."""

    #: idle, checking, installing, starting, connecting, pipeline, done or failed.
    step: str = "idle"
    #: The app being installed or started.
    app: str | None = None
    error: str | None = None
    pipeline: str | None = None
    task: asyncio.Task[None] | None = field(default=None, repr=False)

    def as_dict(self) -> dict[str, Any]:
        """What the frontend is told."""
        return {"step": self.step, "app": self.app, "error": self.error, "pipeline": self.pipeline}


def _setup_of(hass: HomeAssistant) -> VoiceSetup:
    if (setup := hass.data.get(VOICE_KEY)) is None:
        setup = hass.data[VOICE_KEY] = VoiceSetup()
    return setup


def _blueprint_status(folder: Path) -> dict[str, str]:
    """Each blueprint: `missing`, `installed` (as shipped) or `changed` (edited, or older)."""
    status = {}
    for name in BLUEPRINTS:
        target = folder / f"{name}.yaml"
        if not target.is_file():
            status[name] = "missing"
            continue
        shipped = (SHIPPED / f"{name}.yaml").read_text(encoding="utf-8")
        same = target.read_text(encoding="utf-8") == shipped
        status[name] = "installed" if same else "changed"
    return status


def _install_blueprints(folder: Path, replace: bool) -> bool:
    """Writes the missing blueprints (and the changed ones with `replace`); whether one changed."""
    folder.mkdir(parents=True, exist_ok=True)
    replaced = False
    for name in BLUEPRINTS:
        target = folder / f"{name}.yaml"
        exists = target.is_file()
        if exists and not replace:
            continue
        shipped = (SHIPPED / f"{name}.yaml").read_text(encoding="utf-8")
        if exists and target.read_text(encoding="utf-8") == shipped:
            continue
        target.write_text(shipped, encoding="utf-8")
        replaced = replaced or exists
    return replaced


async def async_install_blueprints(hass: HomeAssistant, replace: bool) -> dict[str, str]:
    """Installs DomoTwin's blueprints in Home Assistant's blueprint folder, and says them."""
    folder = Path(hass.config.path(*TARGET))
    replaced = await hass.async_add_executor_job(_install_blueprints, folder, replace)
    # Home Assistant lists the blueprints it read once: read them again.
    blueprints = hass.data.get("blueprint", {}).get("automation")
    if blueprints is not None and hasattr(blueprints, "async_reset_cache"):
        await blueprints.async_reset_cache()
    if replaced and hass.services.has_service("automation", "reload"):
        # Automations made from a blueprint replaced take its new version.
        try:
            await hass.services.async_call("automation", "reload", blocking=True)
        except HomeAssistantError as err:
            # The files are written: an automation that does not load says so in its own logs.
            _LOGGER.warning("Automations not reloaded after the blueprints: %s", err)
    return await hass.async_add_executor_job(_blueprint_status, folder)


def _wyoming_engine(hass: HomeAssistant, host: str, domain: str) -> str | None:
    """The `stt` or `tts` entity of the Wyoming integration's entry for the app at `host`."""
    registry = er.async_get(hass)
    for entry in hass.config_entries.async_entries("wyoming"):
        if entry.data.get("host") != host:
            continue
        for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
            if entity.domain == domain and not entity.disabled:
                return entity.entity_id
    return None


def _language(hass: HomeAssistant) -> str:
    """Home Assistant's language, without its region (`fr` for `fr-CA`)."""
    return hass.config.language.split("-")[0].lower()


def _options(slug: str, options: dict[str, Any], language: str) -> dict[str, Any]:
    """The app's options in the user's language, where it has an option for it."""
    if slug == "core_whisper" and "language" in options:
        return {**options, "language": WHISPER_LANGUAGES.get(language, language)}
    if slug == TTS_APP[1] and "voice" in options and language in PIPER_VOICES:
        return {**options, "voice": PIPER_VOICES[language]}
    return options


async def _async_app(hass: HomeAssistant, setup: VoiceSetup, name: str, slug: str) -> str:
    """Installs (set to the home's language), and starts an app; its host name."""
    from homeassistant.components import hassio  # noqa: PLC0415 (only on the Supervisor)

    manager: AddonManager = hassio.AddonManager(hass, _LOGGER, name, slug)
    info = await manager.async_get_addon_info()
    if info.state is hassio.AddonState.NOT_INSTALLED:
        if not info.available:
            raise VoiceError("app_unavailable")
        setup.step, setup.app = "installing", name
        await manager.async_install_addon()
        info = await manager.async_get_addon_info()
        # Only an app installed here is set: one installed before keeps its user's settings.
        wanted = _options(slug, info.options, _language(hass))
        if wanted != info.options:
            try:
                await manager.async_set_addon_options(wanted)
            except hassio.AddonError as err:
                # A language the app does not know: it keeps its own.
                _LOGGER.warning("%s keeps its settings: %s", name, err)
    if info.state is not hassio.AddonState.RUNNING:
        setup.step, setup.app = "starting", name
        await manager.async_start_addon()
    # The Supervisor's host name for an app: its slug, with dashes.
    return info.hostname or slug.replace("_", "-")


async def _async_add_wyoming(
    hass: HomeAssistant,
    names: tuple[str, str],
    slugs: tuple[str, str],
    hosts: tuple[str, str],
) -> tuple[str, str]:
    """Accepts the Wyoming integration's discoveries of these apps, no other.

    Until both engines exist: the speech-to-text of the first app, the text-to-speech of the second.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + FIND_SECONDS
    ours = tuple(f"/addon/{slug}/" for slug in slugs)
    if any(
        entry.source == "ignore" and any(app.lower() == entry.title.lower() for app in names)
        for entry in hass.config_entries.async_entries("wyoming", include_ignore=True)
    ):
        # Home Assistant was told to ignore one of them: its discovery will not come.
        raise VoiceError("ignored")
    while True:
        for flow in hass.config_entries.flow.async_progress_by_handler("wyoming"):
            context = flow["context"]
            url = str(context.get("configuration_url", ""))
            if context.get("source") == "hassio" and any(app in url for app in ours):
                try:
                    await hass.config_entries.flow.async_configure(flow["flow_id"], {})
                except Exception:  # noqa: BLE001 (an app not answering yet: tried again)
                    _LOGGER.debug("Wyoming discovery %s not accepted yet", flow["flow_id"])
        stt_id = _wyoming_engine(hass, hosts[0], "stt")
        tts_id = _wyoming_engine(hass, hosts[1], "tts")
        if stt_id and tts_id:
            return stt_id, tts_id
        if loop.time() > deadline:
            raise VoiceError("not_found")
        await asyncio.sleep(2)


def _pipelines(hass: HomeAssistant) -> list[Any]:
    from homeassistant.components import assist_pipeline  # noqa: PLC0415 (loaded with Assist)

    return list(assist_pipeline.async_get_pipelines(hass))


async def _async_create_pipeline(hass: HomeAssistant, stt_id: str, tts_id: str) -> Any:
    from homeassistant.components import assist_pipeline  # noqa: PLC0415 (loaded with Assist)

    return await assist_pipeline.async_create_default_pipeline(
        hass, stt_engine_id=stt_id, tts_engine_id=tts_id, pipeline_name=PIPELINE_NAME
    )


def _prefer_if_deaf(hass: HomeAssistant, pipeline_id: str) -> None:
    """Makes the pipeline Assist's preferred one when the preferred one cannot hear."""
    from homeassistant.components import assist_pipeline  # noqa: PLC0415 (loaded with Assist)
    from homeassistant.components.assist_pipeline.const import DOMAIN  # noqa: PLC0415

    if assist_pipeline.async_get_pipeline(hass).stt_engine:
        return
    # Assist's own store, under its domain since 2025.1: no public call sets the preferred one.
    hass.data[DOMAIN].pipeline_store.async_set_preferred_item(pipeline_id)


async def _async_pipeline(hass: HomeAssistant, stt_id: str, tts_id: str) -> str:
    """An Assist pipeline with these engines, made when there is none."""
    for pipeline in _pipelines(hass):
        if pipeline.stt_engine == stt_id and pipeline.tts_engine == tts_id:
            return str(pipeline.id)
    pipeline = await _async_create_pipeline(hass, stt_id, tts_id)
    if pipeline is None:
        # The engines do not speak the language Home Assistant is set to.
        raise VoiceError("language")
    return str(pipeline.id)


async def _async_set_up(hass: HomeAssistant, setup: VoiceSetup, stt: str) -> None:
    from homeassistant.components import hassio  # noqa: PLC0415 (only on the Supervisor)

    try:
        stt_host = await _async_app(hass, setup, *STT_APPS[stt])
        tts_host = await _async_app(hass, setup, *TTS_APP)
        setup.step, setup.app = "connecting", None
        stt_id, tts_id = await _async_add_wyoming(
            hass,
            (STT_APPS[stt][0], TTS_APP[0]),
            (STT_APPS[stt][1], TTS_APP[1]),
            (stt_host, tts_host),
        )
        setup.step = "pipeline"
        setup.pipeline = await _async_pipeline(hass, stt_id, tts_id)
        try:
            _prefer_if_deaf(hass, setup.pipeline)
        except (AttributeError, ImportError, KeyError) as err:
            # Assist's store changed: the pipeline is there to choose, DomoTwin's button uses it.
            _LOGGER.debug("The voice pipeline could not be made the preferred one: %s", err)
        setup.step = "done"
    except VoiceError as err:
        setup.step, setup.error = "failed", err.code
    except hassio.AddonError as err:
        _LOGGER.warning("Setting up voice: %s", err)
        setup.step, setup.error = "failed", "app"
    except Exception:
        _LOGGER.exception("Setting up voice failed")
        setup.step, setup.error = "failed", "unknown"


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """The voice commands of the websocket API."""
    websocket_api.async_register_command(hass, ws_voice_get)
    websocket_api.async_register_command(hass, ws_voice_blueprints)
    websocket_api.async_register_command(hass, ws_voice_setup)


@websocket_api.websocket_command({vol.Required("type"): "domotwin/voice/get"})
@websocket_api.async_response
async def ws_voice_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Whether local voice can be set up here, the blueprints, where a set-up is."""
    folder = Path(hass.config.path(*TARGET))
    language = _language(hass)
    connection.send_result(
        msg["id"],
        {
            "supervisor": is_hassio(hass),
            "blueprints": await hass.async_add_executor_job(_blueprint_status, folder),
            "setup": _setup_of(hass).as_dict(),
            # For the steps on Container and Core: what the apps are set to here.
            "language": WHISPER_LANGUAGES.get(language, language),
            "piper_voice": PIPER_VOICES.get(language, PIPER_VOICES["en"]),
        },
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/voice/blueprints",
        vol.Optional("replace", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_voice_blueprints(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Installs the voice blueprints. Admins only."""
    try:
        status = await async_install_blueprints(hass, msg["replace"])
    except OSError as err:
        connection.send_error(msg["id"], "blueprints_not_written", str(err))
        return
    connection.send_result(msg["id"], {"blueprints": status})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/voice/setup", vol.Required("stt"): vol.In(list(STT_APPS))}
)
@callback
def ws_voice_setup(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Starts setting up local voice on the Supervisor. Admins only."""
    if not is_hassio(hass):
        connection.send_error(msg["id"], "no_supervisor", "Home Assistant has no add-ons here")
        return
    setup = _setup_of(hass)
    if setup.task is not None and not setup.task.done():
        connection.send_error(msg["id"], "busy", "voice is being set up")
        return
    setup.step, setup.app, setup.error, setup.pipeline = "checking", None, None, None
    setup.task = hass.async_create_background_task(
        _async_set_up(hass, setup, msg["stt"]), "domotwin voice setup"
    )
    connection.send_result(msg["id"], setup.as_dict())
