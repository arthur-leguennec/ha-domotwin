"""Fixtures for the DomoTwin integration tests."""

from __future__ import annotations

from collections.abc import Generator
import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.domotwin.const import DEFAULT_OPTIONS, DOMAIN
from homeassistant.core import HomeAssistant

ROOT = Path(__file__).parent.parent


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Load custom_components/ in every test."""


@pytest.fixture(autouse=True)
def frontend_built(tmp_path: Path) -> Generator[Path]:
    """Serve a fake built frontend so that tests do not need `scripts/build.sh`."""
    (tmp_path / "domotwin.js").write_text("export {};\n", encoding="utf-8")
    with patch("custom_components.domotwin.frontend.FRONTEND_PATH", tmp_path):
        yield tmp_path


@pytest.fixture
def demo_plan() -> dict[str, Any]:
    """The fictional demo apartment of examples/."""
    plan: dict[str, Any] = json.loads(
        (ROOT / "examples" / "demo-apartment.plan.json").read_text(encoding="utf-8")
    )
    return plan


@pytest.fixture
def demo_bindings() -> dict[str, Any]:
    """The bindings of the demo apartment."""
    bindings: dict[str, Any] = json.loads(
        (ROOT / "examples" / "demo-apartment.bindings.json").read_text(encoding="utf-8")
    )
    return bindings


@pytest.fixture
def config_entry() -> MockConfigEntry:
    """A DomoTwin config entry with the default options."""
    return MockConfigEntry(domain=DOMAIN, title="DomoTwin", options=dict(DEFAULT_OPTIONS))


@pytest.fixture
async def setup_integration(hass: HomeAssistant, config_entry: MockConfigEntry) -> MockConfigEntry:
    """Set up DomoTwin and return its entry."""
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    return config_entry
