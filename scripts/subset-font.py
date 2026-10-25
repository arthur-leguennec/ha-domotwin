#!/usr/bin/env python3
"""Makes DomoTwin's bundled font, frontend/fonts/inter-variable.woff2, from Inter's release.

Inter 4.1 (https://github.com/rsms/inter/releases/tag/v4.1, SIL Open Font License 1.1, no
reserved font name): `InterVariable.ttf`, SHA-256
4989b125924991b90d05b2d16e0e388c48f7d5bb8b30539bbf9c755278d0ccaf. The optical size is fixed for
text, every weight (100 to 900) is kept, and only the characters a home's names and DomoTwin's
texts use: Latin, the punctuation, the units (°, ², ₂, µ), arrows and a few signs. About 60 kB.

    pip install fonttools brotli
    python3 scripts/subset-font.py path/to/InterVariable.ttf
"""

from __future__ import annotations

import hashlib
import io
from pathlib import Path
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SOURCE_SHA256 = "4989b125924991b90d05b2d16e0e388c48f7d5bb8b30539bbf9c755278d0ccaf"
OUT = Path(__file__).resolve().parent.parent / "frontend" / "fonts" / "inter-variable.woff2"
UNICODES = (
    "U+0020-007E",  # Basic Latin
    "U+00A0-017F",  # Latin-1 and Latin Extended-A
    "U+0300-0308",  # the combining accents
    "U+02C6,U+02DA,U+02DC",
    "U+2000-206F",  # punctuation
    "U+2070-209F",  # superscripts and subscripts (CO₂, m²)
    "U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+2248,U+2260,U+2264-2265,U+FEFF,U+FFFD",
)
FEATURES = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk", "tnum", "case"]


def main(source: Path) -> None:
    """Writes the subset of `source` to `OUT`."""
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        sys.exit(f"{source} is not Inter 4.1's InterVariable.ttf (SHA-256 {digest})")
    # Saved and read again: the subsetter needs the instance's tables loaded in full.
    instance = io.BytesIO()
    instancer.instantiateVariableFont(TTFont(source, recalcTimestamp=False), {"opsz": 14}).save(
        instance
    )
    instance.seek(0)
    font = TTFont(instance, recalcTimestamp=False)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = FEATURES
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.hinting = False
    options.desubroutinize = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(",".join(UNICODES)))
    subsetter.subset(font)
    subset.save_font(font, str(OUT), options)
    sys.stdout.write(f"{OUT}: {OUT.stat().st_size} bytes\n")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
