"""Uploaded images: room photos and scene images.

Uploads are size- and type-checked, decoded with Pillow, rotated upright, scaled down, and
re-encoded. Re-encoding drops EXIF data such as GPS location. Files get server-generated names
and live under the uploads directory beside the database, never inside the saved document.
"""

from __future__ import annotations

import io
import re
import time
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 50_000_000  # decompression-bomb guard, about 8K x 6K
MAX_SIDE = 3200  # stored images are scaled to fit this
# MPO is how Pillow reports a phone JPEG that carries extra images (depth or HDR maps).
# Only the main image is kept: re-encoding writes a single-frame JPEG.
ALLOWED_FORMATS = {"JPEG": "image/jpeg", "MPO": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
_NAME = re.compile(r"^[0-9a-f]{32}\.(jpg|png)$")
SAMPLE_SIDE = 96  # scene colors are read from a small copy, which averages away noise

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class ImageRejected(ValueError):
    """The upload is not an image this app accepts."""


def _open(data: bytes) -> Image.Image:
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageRejected(f"Images can be at most {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    if not data:
        raise ImageRejected("The upload is empty")
    try:
        probe = Image.open(io.BytesIO(data))
        if probe.format not in ALLOWED_FORMATS:
            raise ImageRejected("Upload a JPEG, PNG, or WebP image")
        probe.verify()
        image = Image.open(io.BytesIO(data))
        image.load()
    except ImageRejected:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, ValueError):
        raise ImageRejected("The file is not a readable JPEG, PNG, or WebP image") from None
    return image


def store_image(data: bytes, directory: Path) -> dict[str, int | str]:
    """Validate, clean, and save an upload. Returns {"file", "width", "height"}."""
    image = ImageOps.exif_transpose(_open(data))
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    directory.mkdir(parents=True, exist_ok=True)
    if has_alpha:
        name = f"{uuid.uuid4().hex}.png"
        image.convert("RGBA").save(directory / name, "PNG", optimize=True)
    else:
        name = f"{uuid.uuid4().hex}.jpg"
        image.convert("RGB").save(directory / name, "JPEG", quality=88, optimize=True)
    return {"file": name, "width": image.width, "height": image.height}


def image_path(directory: Path, name: str) -> Path:
    """The stored file for a name this module generated. Anything else is refused."""
    if not _NAME.fullmatch(name or ""):
        raise ImageRejected("Unknown image")
    path = directory / name
    if not path.is_file():
        raise ImageRejected("Unknown image")
    return path


def media_type(name: str) -> str:
    return "image/png" if name.endswith(".png") else "image/jpeg"


def extract_palette(path: Path, count: int = 5, mood: str = "colorful") -> list[dict[str, float | str]]:
    """Swatches with where they sit in the image. See palette.extract_theme."""
    from .palette import extract_theme

    return extract_theme(path, count, mood)


def theme_from_bytes(data: bytes, count: int = 5, mood: str = "colorful") -> list[dict[str, float | str]]:
    """A theme from an image that is checked but not stored."""
    from .palette import extract_theme

    image = ImageOps.exif_transpose(_open(data)).convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    buffer.seek(0)
    return extract_theme(buffer, count, mood)  # type: ignore[arg-type]


class ImageSampler:
    """Reads colors from an image at fractional positions (0 to 1 across, 0 to 1 down)."""

    def __init__(self, path: Path) -> None:
        with Image.open(path) as source:
            image = source.convert("RGB")
            image.thumbnail((SAMPLE_SIDE, SAMPLE_SIDE), Image.Resampling.BOX)
        self._image = image

    def color_at(self, u: float, v: float) -> tuple[int, int, int] | None:
        if not (0.0 <= u <= 1.0 and 0.0 <= v <= 1.0):
            return None
        x = min(self._image.width - 1, int(u * self._image.width))
        y = min(self._image.height - 1, int(v * self._image.height))
        return self._image.getpixel((x, y))  # type: ignore[return-value]


def prune_unreferenced(directory: Path, referenced: set[str], min_age_seconds: float = 3600) -> list[str]:
    """Delete stored images nothing refers to. Fresh files are kept so an upload that
    has not been saved into a scene or room yet is not lost."""
    removed: list[str] = []
    if not directory.is_dir():
        return removed
    cutoff = time.time() - min_age_seconds
    for path in directory.iterdir():
        if _NAME.fullmatch(path.name) and path.name not in referenced and path.stat().st_mtime < cutoff:
            path.unlink(missing_ok=True)
            removed.append(path.name)
    return removed
