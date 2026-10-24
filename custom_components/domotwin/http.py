"""HTTP views of the 3D files of user models: administrators upload, signed-in users read.

A file is uploaded as the body of `POST /api/domotwin/models?format=<format>` and answered with
its SHA-256; it is read back with `GET /api/domotwin/models/<sha256>.<format>`. Both need a
signed-in user (Home Assistant's authentication); uploads need an administrator.
"""

from __future__ import annotations

from http import HTTPStatus

from aiohttp import web

from homeassistant.components.http import KEY_HASS, KEY_HASS_USER, HomeAssistantView
from homeassistant.core import HomeAssistant, callback

from .const import MAX_MODEL_BYTES, MODEL_FORMATS, MODELS_URL
from .data import DATA_KEY, VIEWS_REGISTERED_KEY
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


@callback
def async_register_views(hass: HomeAssistant) -> None:
    """Register the views once per Home Assistant run (views cannot be removed)."""
    if hass.data.get(VIEWS_REGISTERED_KEY):
        return
    hass.http.register_view(ModelUploadView())
    hass.http.register_view(ModelFileView())
    hass.data[VIEWS_REGISTERED_KEY] = True
