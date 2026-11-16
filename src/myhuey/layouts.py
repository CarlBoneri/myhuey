"""Which saved layout a call works on, and the rules every layout shares.

The Active layout lives in the main document; a sandbox is a separate record (layout_store.py).
`current_layout` names the open layout for this request or CLI run. None means Active.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from .models import new_id

HOME_KEYS = ("rooms", "scenes", "home")
MAX_NAME = 60
ACTIVE_DEFAULT_NAME = "My home"

current_layout: ContextVar[str | None] = ContextVar("myhuey_layout", default=None)


@contextmanager
def using_layout(layout_id: str | None) -> Iterator[None]:
    token = current_layout.set(layout_id or None)
    try:
        yield
    finally:
        current_layout.reset(token)


def ensure_identity(config: dict[str, Any]) -> bool:
    """Give the Active layout an ID and a name if it has none. True if anything changed."""
    identity = config.get("layout")
    if isinstance(identity, dict) and isinstance(identity.get("id"), str) and identity["id"]:
        if isinstance(identity.get("name"), str) and identity["name"].strip():
            return False
        config["layout"] = {**identity, "name": ACTIVE_DEFAULT_NAME}
        return True
    config["layout"] = {"id": new_id(), "name": ACTIVE_DEFAULT_NAME}
    return True


def clean_name(name: str) -> str:
    text = str(name or "").strip()
    if not 1 <= len(text) <= MAX_NAME:
        raise ValueError(f"A layout name must be 1 to {MAX_NAME} characters")
    return text
