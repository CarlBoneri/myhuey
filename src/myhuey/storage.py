"""Persistence for the paired bridge and the room layouts: one JSON document in SQLite.

A path ending in .json stores the same document as a plain JSON file instead.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

DEFAULT_STORAGE_PATH = Path.home() / ".myhuey" / "myhuey.db"

_SCHEMA = "CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)"


def _normalize(data: Any) -> dict[str, Any]:
    config = dict(data) if isinstance(data, dict) else {}
    if not isinstance(config.get("bridge"), dict):
        config["bridge"] = {}
    if not isinstance(config.get("rooms"), list):
        config["rooms"] = []
    return config


def _is_json(path: Path) -> bool:
    return path.suffix.lower() == ".json"


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute(_SCHEMA)
    return connection


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    target = Path(path) if path else DEFAULT_STORAGE_PATH
    try:
        if _is_json(target):
            return _normalize(json.loads(target.read_text(encoding="utf-8")))
        with closing(_connect(target)) as connection:
            row = connection.execute("SELECT value FROM app_state WHERE key = 'config'").fetchone()
        return _normalize(json.loads(row[0]) if row else None)
    except (FileNotFoundError, json.JSONDecodeError):
        return _normalize(None)


def save_config(config: dict[str, Any], path: str | Path | None = None) -> Path:
    target = Path(path) if path else DEFAULT_STORAGE_PATH
    document = json.dumps(_normalize(config), indent=2)

    if _is_json(target):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(document, encoding="utf-8")
    else:
        with closing(_connect(target)) as connection:
            connection.execute(
                "INSERT INTO app_state(key, value) VALUES('config', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (document,),
            )
            connection.commit()

    os.chmod(target, 0o600)  # the document holds the bridge credential
    return target
