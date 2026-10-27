"""HTTP views: the 3D files of user models, and the guests' page (D-067).

A file is uploaded as the body of `POST /api/domotwin/models?format=<format>` and answered with
its SHA-256; it is read back with `GET /api/domotwin/models/<sha256>.<format>`. Both need a
signed-in user (Home Assistant's authentication); uploads need an administrator.

A guest pass's link, `/api/domotwin/guest/<secret>`, opens a page of DomoTwin's own, outside Home
Assistant's sign-in; the page reads the home through the pass (`…/home`), follows it (`…/events`),
acts through it (`POST …/call`) and reads the 3D files of its pieces (`…/models/<file>`). Each is
checked against the pass, every time (`guests.py`).
"""

from __future__ import annotations

from http import HTTPStatus
import json
from pathlib import Path
from typing import Any

from aiohttp import web

from homeassistant.components.http import KEY_HASS, KEY_HASS_USER, HomeAssistantView
from homeassistant.core import HomeAssistant, callback

from . import frontend
from .const import GUEST_PAGE, GUEST_URL, MAX_MODEL_BYTES, MODEL_FORMATS, MODELS_URL
from .data import DATA_KEY, GUESTS_KEY, VIEWS_REGISTERED_KEY, WIFI_KEY
from .guests import (
    GuestError,
    Guests,
    async_guest_call,
    followed_by,
    guest_call,
    guest_home,
    guest_models,
)
from .models import async_store, file_path, looks_like

# Cached by the browser for a year: a file's name is its content's hash.
CACHE_CONTROL = "private, max-age=31536000, immutable"


def _error(code: str, status: HTTPStatus) -> web.Response:
    return web.json_response({"code": code}, status=status)


class ModelUploadView(HomeAssistantView):
    """Keeps an uploaded 3D file."""

    url = MODELS_URL
    name = "api:domotwin:models"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        """Store the body; answer `{"hash", "bytes", "format"}`."""
        hass: HomeAssistant = request.app[KEY_HASS]
        if DATA_KEY not in hass.data:
            return _error("not_loaded", HTTPStatus.SERVICE_UNAVAILABLE)
        if not request[KEY_HASS_USER].is_admin:
            return _error("unauthorized", HTTPStatus.FORBIDDEN)
        file_format = request.query.get("format", "")
        if file_format not in MODEL_FORMATS:
            return _error("not_model", HTTPStatus.BAD_REQUEST)
        data = await _read_body(request)
        if data is None:
            return _error("too_large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        if not looks_like(data, file_format):
            return _error("not_model", HTTPStatus.BAD_REQUEST)
        digest = await async_store(hass, data, file_format)
        return web.json_response({"hash": digest, "bytes": len(data), "format": file_format})


async def _read_body(request: web.Request) -> bytes | None:
    """The body, or None past the size of a model file."""
    if (request.content_length or 0) > MAX_MODEL_BYTES:
        return None
    data = bytearray()
    async for chunk in request.content.iter_chunked(65_536):
        data.extend(chunk)
        if len(data) > MAX_MODEL_BYTES:
            return None
    return bytes(data)


class ModelFileView(HomeAssistantView):
    """Serves a kept 3D file."""

    url = MODELS_URL + "/{name}"
    name = "api:domotwin:models:file"
    requires_auth = True

    async def get(self, request: web.Request, name: str) -> web.StreamResponse:
        """The file, or 404."""
        hass: HomeAssistant = request.app[KEY_HASS]
        found = file_path(hass, name)
        if found is None:
            return _error("not_found", HTTPStatus.NOT_FOUND)
        path, media_type = found
        if not await hass.async_add_executor_job(path.is_file):
            return _error("not_found", HTTPStatus.NOT_FOUND)
        return web.FileResponse(
            path, headers={"Content-Type": media_type, "Cache-Control": CACHE_CONTROL}
        )


# The guests' page: what it may load and where it may be shown. Its scripts, styles, fonts and
# 3D engine are DomoTwin's own files (`/domotwin_static/`), the pictures Home Assistant's; nothing
# from anywhere else, in no frame of another site. The tests' server sends the same
# (`frontend/e2e/serve.mjs`).
GUEST_CSP = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)
GUEST_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}
#: A link's secret in the address (what `secrets.token_urlsafe(32)` writes, and a little more).
LINK_ROUTE = "{token:[A-Za-z0-9_-]{40,100}}"
#: The longest action a guest's page sends (bytes).
MAX_CALL_BYTES = 4096


def _guest_error(view: HomeAssistantView, err: GuestError) -> web.Response:
    return view.json({"code": err.code, **err.details}, err.status, headers=GUEST_HEADERS)


def _guests(hass: HomeAssistant) -> Guests:
    if (guests := hass.data.get(GUESTS_KEY)) is None or DATA_KEY not in hass.data:
        raise GuestError("not_loaded", HTTPStatus.SERVICE_UNAVAILABLE)
    return guests


def _wifi(hass: HomeAssistant) -> dict[str, Any] | None:
    """The home's Wi-Fi as an administrator sees it (its password too), if one is given."""
    wifi = hass.data.get(WIFI_KEY)
    if wifi is None or not wifi.is_set:
        return None
    return wifi.get(admin=True, password=True)


class GuestPageView(HomeAssistantView):
    """The guests' page: the same for every link, which it reads from its own address."""

    url = f"{GUEST_URL}/{LINK_ROUTE}"
    name = "api:domotwin:guest"
    requires_auth = False

    async def get(self, request: web.Request, token: str) -> web.StreamResponse:
        """The page, or 404 when DomoTwin's frontend is not built."""
        hass: HomeAssistant = request.app[KEY_HASS]
        page = await hass.async_add_executor_job(_read_page, frontend.FRONTEND_PATH / GUEST_PAGE)
        if page is None:
            return web.Response(status=HTTPStatus.NOT_FOUND, headers=GUEST_HEADERS)
        return web.Response(
            text=page,
            content_type="text/html",
            headers={**GUEST_HEADERS, "Content-Security-Policy": GUEST_CSP},
        )


def _read_page(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


class GuestHomeView(HomeAssistantView):
    """The home as a pass shows it (`guests.guest_home`)."""

    url = f"{GUEST_URL}/{LINK_ROUTE}/home"
    name = "api:domotwin:guest:home"
    requires_auth = False

    async def get(self, request: web.Request, token: str) -> web.Response:
        """The home, or why the pass does not open it now."""
        hass: HomeAssistant = request.app[KEY_HASS]
        try:
            guests = _guests(hass)
            guest_pass = guests.check(request, token)
        except GuestError as err:
            return _guest_error(self, err)
        data = hass.data[DATA_KEY]
        home = guest_home(hass, data, _wifi(hass), guest_pass, guests.shown(data, guest_pass))
        return self.json(home, headers=GUEST_HEADERS)


class GuestEventsView(HomeAssistantView):
    """The pass's devices followed, as server-sent events (`Guests.async_stream`)."""

    url = f"{GUEST_URL}/{LINK_ROUTE}/events"
    name = "api:domotwin:guest:events"
    requires_auth = False

    async def get(self, request: web.Request, token: str) -> web.StreamResponse:
        """Follows until the pass ends, changes, or the page goes."""
        hass: HomeAssistant = request.app[KEY_HASS]
        try:
            guests = _guests(hass)
            guest_pass = guests.check(request, token)
            return await guests.async_stream(
                request, guest_pass, followed_by(guest_pass, _wifi(hass))
            )
        except GuestError as err:
            return _guest_error(self, err)


class GuestCallView(HomeAssistantView):
    """A guest's action, checked against the pass (`guests.guest_call`)."""

    url = f"{GUEST_URL}/{LINK_ROUTE}/call"
    name = "api:domotwin:guest:call"
    requires_auth = False

    async def post(self, request: web.Request, token: str) -> web.Response:
        """Does it: `{"domain", "service", "data"?, "target": {"entity_id"}}`."""
        hass: HomeAssistant = request.app[KEY_HASS]
        try:
            guests = _guests(hass)
            guest_pass = guests.check(request, token)
            call = guest_call(guest_pass, await _read_call(request))
            guests.allow_call(guest_pass)
            await async_guest_call(hass, guest_pass, call)
        except GuestError as err:
            return _guest_error(self, err)
        return self.json({"done": True}, headers=GUEST_HEADERS)


async def _read_call(request: web.Request) -> Any:
    """The action a guest's page sends, read as JSON; `GuestError` past `MAX_CALL_BYTES`."""
    if (request.content_length or 0) > MAX_CALL_BYTES:
        raise GuestError("invalid")
    raw = bytearray()
    # Read to its end, however it comes (in pieces, chunked), never past the limit.
    async for chunk in request.content.iter_chunked(1024):
        raw.extend(chunk)
        if len(raw) > MAX_CALL_BYTES:
            raise GuestError("invalid")
    try:
        return json.loads(raw)
    except ValueError as err:
        raise GuestError("invalid") from err


class GuestModelView(HomeAssistantView):
    """A 3D file a piece the pass shows is drawn from."""

    url = f"{GUEST_URL}/{LINK_ROUTE}/models/{{name}}"
    name = "api:domotwin:guest:models"
    requires_auth = False

    async def get(self, request: web.Request, token: str, name: str) -> web.StreamResponse:
        """The file, or 404 when the pass shows no piece drawn from it."""
        hass: HomeAssistant = request.app[KEY_HASS]
        try:
            guests = _guests(hass)
            guest_pass = guests.check(request, token)
        except GuestError as err:
            return _guest_error(self, err)
        shown, _, _ = guests.shown(hass.data[DATA_KEY], guest_pass)
        found = file_path(hass, name)
        if found is None or name.split(".", 1)[0] not in guest_models(shown):
            return _error("not_found", HTTPStatus.NOT_FOUND)
        path, media_type = found
        if not await hass.async_add_executor_job(path.is_file):
            return _error("not_found", HTTPStatus.NOT_FOUND)
        return web.FileResponse(
            path, headers={"Content-Type": media_type, "Cache-Control": CACHE_CONTROL}
        )


@callback
def async_register_views(hass: HomeAssistant) -> None:
    """Register the views once per Home Assistant run (views cannot be removed)."""
    if hass.data.get(VIEWS_REGISTERED_KEY):
        return
    hass.http.register_view(ModelUploadView())
    hass.http.register_view(ModelFileView())
    hass.http.register_view(GuestPageView())
    hass.http.register_view(GuestHomeView())
    hass.http.register_view(GuestEventsView())
    hass.http.register_view(GuestCallView())
    hass.http.register_view(GuestModelView())
    hass.data[VIEWS_REGISTERED_KEY] = True
