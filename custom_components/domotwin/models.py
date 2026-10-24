"""The 3D files of user models, kept by their SHA-256 (docs/DECISIONS.md, D-013 and D-021).

Files live in `<config>/domotwin/models/<sha256>.<format>`, outside `.storage` (they would bloat
it). The browser reads and checks a file before it uploads it; the integration only checks that
the bytes look like the format and keeps them. A file that no stored plan or overlay uses is
deleted a day after its upload, and every file goes when the integration is removed.
"""

from __future__ import annotations

from collections.abc import Callable
import hashlib
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
from typing import Any

from homeassistant.core import HomeAssistant

from .const import (
    MAX_MODEL_BYTES,
    MODEL_ENTRY_PREFIX,
    MODEL_FORMATS,
    MODEL_GRACE_SECONDS,
    MODELS_DIR,
)

FORMATS = "|".join(re.escape(f) for f in MODEL_FORMATS)
FILE_NAME = re.compile(rf"^([0-9a-f]{{64}})\.({FORMATS})$")


def models_dir(hass: HomeAssistant) -> Path:
    """Where the files are kept."""
    return Path(hass.config.path(*MODELS_DIR))


def _stl(data: bytes) -> bool:
    count = int.from_bytes(data[80:84], "little") if len(data) >= 84 else -1
    return 84 + 50 * count == len(data) or data.lstrip()[:5].lower() == b"solid"


def _text(data: bytes) -> bool:
    return b"\x00" not in data[:4096]


SNIFF: dict[str, Callable[[bytes], bool]] = {
    "glb": lambda data: data.startswith(b"glTF"),
    "3mf": lambda data: data.startswith(b"PK\x03\x04"),
    "stl": _stl,
    "gltf": lambda data: _text(data) and data.lstrip().startswith(b"{"),
    "obj": _text,
}


def looks_like(data: bytes, file_format: str) -> bool:
    """Whether the bytes look like a file of the format (the browser checked it fully)."""
    sniff = SNIFF.get(file_format)
    return sniff is not None and 0 < len(data) <= MAX_MODEL_BYTES and sniff(data)


def used_hashes(plan: dict[str, Any] | None, layout: dict[str, Any]) -> set[str]:
    """The files the stored plan and its overlay use."""
    models: list[Any] = []
    if isinstance(plan, dict) and isinstance(plan.get("models"), dict):
        models.extend(plan["models"].values())
    for key, entry in layout.items():
        if key.startswith(MODEL_ENTRY_PREFIX) and isinstance(entry, dict):
            models.append(entry.get("model"))
    hashes: set[str] = set()
    for model in models:
        file = model.get("file") if isinstance(model, dict) else None
        if isinstance(file, dict) and isinstance(file.get("hash"), str):
            hashes.add(file["hash"])
    return hashes


def _store(folder: Path, data: bytes, file_format: str) -> str:
    digest = hashlib.sha256(data).hexdigest()
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{digest}.{file_format}"
    if target.exists():
        # Uploaded again: its grace period starts again.
        target.touch()
        return digest
    handle, temporary = tempfile.mkstemp(dir=folder, prefix=".upload-")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        Path(temporary).replace(target)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    return digest


def _remove_unused(folder: Path, used: set[str], now: float) -> int:
    if not folder.is_dir():
        return 0
    removed = 0
    for path in folder.iterdir():
        match = FILE_NAME.match(path.name)
        stale = now - path.stat().st_mtime > MODEL_GRACE_SECONDS
        if path.name.startswith(".upload-") and stale:
            path.unlink(missing_ok=True)
        elif match and match.group(1) not in used and stale:
            path.unlink(missing_ok=True)
            removed += 1
    return removed


def _usage(folder: Path) -> dict[str, int]:
    files = [p for p in folder.iterdir() if FILE_NAME.match(p.name)] if folder.is_dir() else []
    return {"files": len(files), "bytes": sum(p.stat().st_size for p in files)}


async def async_store(hass: HomeAssistant, data: bytes, file_format: str) -> str:
    """Keep a file; returns its SHA-256."""
    return await hass.async_add_executor_job(_store, models_dir(hass), data, file_format)


async def async_remove_unused(
    hass: HomeAssistant, plan: dict[str, Any] | None, layout: dict[str, Any]
) -> int:
    """Delete the files nothing uses any more (past their grace period). Returns how many."""
    used = used_hashes(plan, layout)
    return await hass.async_add_executor_job(_remove_unused, models_dir(hass), used, time.time())


async def async_remove_all(hass: HomeAssistant) -> None:
    """Delete every file (the integration is removed)."""
    await hass.async_add_executor_job(shutil.rmtree, models_dir(hass), True)


async def async_usage(hass: HomeAssistant) -> dict[str, int]:
    """How many files are kept and their size (diagnostics)."""
    return await hass.async_add_executor_job(_usage, models_dir(hass))


def file_path(hass: HomeAssistant, name: str) -> tuple[Path, str] | None:
    """The path and media type of a file name (`<sha256>.<format>`), or None for any other."""
    match = FILE_NAME.match(name)
    if match is None:
        return None
    return models_dir(hass) / name, MODEL_FORMATS[match.group(2)]
