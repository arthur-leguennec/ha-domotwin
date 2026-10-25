"""The brand images Home Assistant and HACS show for the integration (`brand/`).

Rendered by `scripts/render-brand.mjs` from `docs/brand/icon.svg`; the sizes are those of Home
Assistant's brands: a square icon of 256 px, a logo 128 px high, and their 2x versions.
"""

from __future__ import annotations

import hashlib
import struct

import pytest

from .conftest import ROOT

BRAND = ROOT / "custom_components" / "domotwin" / "brand"


def size(name: str) -> tuple[int, int]:
    data = (BRAND / name).read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", name
    width, height = struct.unpack(">II", data[16:24])
    # Colour type 6: RGBA, the background left transparent.
    assert data[25] == 6, name
    return width, height


@pytest.mark.parametrize(("name", "scale"), [("icon.png", 1), ("icon@2x.png", 2)])
def test_the_icon_is_square(name: str, scale: int) -> None:
    assert size(name) == (256 * scale, 256 * scale)


@pytest.mark.parametrize(
    ("name", "scale"),
    [("logo.png", 1), ("logo@2x.png", 2), ("dark_logo.png", 1), ("dark_logo@2x.png", 2)],
)
def test_the_logo_is_as_high_as_brands_want(name: str, scale: int) -> None:
    width, height = size(name)
    assert height == 128 * scale
    assert width > height


def test_the_images_are_rendered_from_the_current_sources() -> None:
    # Written by `scripts/render-brand.mjs`: run it again after changing the drawing or the font.
    lines = (ROOT / "docs" / "brand" / "sources.sha256").read_text().splitlines()
    assert lines
    for line in lines:
        digest, path = line.split("  ", 1)
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest, path
