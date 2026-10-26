"""Per-user signature images.

A scanned signature is usually a JPG of blue/black ink on off-white paper.
Stamped as-is it leaves a grey rectangle over the document, so uploads are
cleaned: the paper becomes transparent, the ink keeps its colour, and the
image is cropped to the ink.
"""

from __future__ import annotations

import io
import os
import re
from pathlib import Path

from PIL import Image

from .config import AppConfig

_SAFE = re.compile(r"^[A-Za-z0-9_.-]+$")


class MissingSignature(LookupError):
    pass


def clean_scan(data: bytes, threshold: int = 200, max_width: int = 1200) -> bytes:
    """Return a transparent, cropped PNG of the ink in a scanned signature."""
    img = Image.open(io.BytesIO(data))
    img = img.convert("RGBA")
    gray = img.convert("L")
    # Pixels lighter than `threshold` are paper. Below that, fade in over a
    # 60-level band so pen strokes keep soft edges instead of jaggies.
    lo = max(threshold - 60, 0)

    def alpha(p: int) -> int:
        if p >= threshold:
            return 0
        if p <= lo:
            return 255
        return int(255 * (threshold - p) / (threshold - lo))

    img.putalpha(gray.point(alpha))
    bbox = img.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("no ink found in the signature image - try a darker scan")
    pad = 6
    x0, y0, x1, y1 = bbox
    img = img.crop((max(x0 - pad, 0), max(y0 - pad, 0), min(x1 + pad, img.width), min(y1 + pad, img.height)))
    if img.width > max_width:
        img = img.resize((max_width, round(img.height * max_width / img.width)), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()


def _has_alpha(data: bytes) -> bool:
    with Image.open(io.BytesIO(data)) as img:
        return img.mode in ("RGBA", "LA") or "transparency" in img.info


class SignatureStore:
    """Uploaded signatures live in `<store_dir>/<user>/<variant>.png` and take
    priority over paths configured in users.yaml. If a step asks for a variant
    the user does not have (e.g. 'initials'), the 'full' signature is used."""

    def __init__(self, cfg: AppConfig, store_dir: str | Path):
        self.cfg = cfg
        self.dir = Path(store_dir)
        self.dir.mkdir(parents=True, exist_ok=True)

    def _uploaded(self, user_id: str, variant: str) -> Path:
        if not (_SAFE.match(user_id) and _SAFE.match(variant)):
            raise ValueError("invalid user or variant name")
        return self.dir / user_id / f"{variant}.png"

    def save(self, user_id: str, variant: str, data: bytes, clean: bool = True) -> Path:
        self.cfg.user(user_id)  # raises for unknown users
        png = clean_scan(data) if clean else data
        path = self._uploaded(user_id, variant)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png)
        os.chmod(path, 0o600)
        return path

    def variants(self, user_id: str) -> list[str]:
        user = self.cfg.user(user_id)
        found = set(user.signatures)
        folder = self.dir / user_id
        if folder.is_dir():
            found.update(p.stem for p in folder.glob("*.png"))
        return sorted(found)

    def get(self, user_id: str, variant: str = "full") -> bytes:
        user = self.cfg.user(user_id)
        for v in dict.fromkeys([variant, "full"]):
            uploaded = self._uploaded(user_id, v)
            if uploaded.is_file():
                return uploaded.read_bytes()
            configured = user.signatures.get(v)
            if configured:
                path = Path(configured)
                if not path.is_absolute():
                    path = self.cfg.base_dir / path
                if path.is_file():
                    data = path.read_bytes()
                    # A raw scan dropped in by an admin gets the same cleanup as an upload.
                    return data if _has_alpha(data) else clean_scan(data)
        raise MissingSignature(f"no '{variant}' signature on file for {user.name} ({user_id})")
