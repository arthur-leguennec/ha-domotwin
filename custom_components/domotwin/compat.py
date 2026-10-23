"""Compatibility with the supported Home Assistant versions."""

from __future__ import annotations

# Home Assistant 2026.10 replaced voluptuous with probatio, which has the same API.
try:
    import probatio as vol
except ImportError:  # Home Assistant before 2026.10
    import voluptuous as vol  # type: ignore[no-redef]

__all__ = ["vol"]
