"""Persistence for the paired bridge, the room layouts, and scenes: one JSON document in SQLite.

A path ending in .json stores the same document as a plain JSON file instead. Older documents
are upgraded on load (see migrations.py); the original is kept beside it as a backup first.
Uploaded images live as files under uploads/ next to the database, never inside the document.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from .migrations import CURRENT_VERSION, migrate

DEFAULT_STORAGE_PATH = Path.home() / ".myhuey" / "myhuey.db"

_SCHEMA = "CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)"


def _normalize(data: Any) -> dict[str, Any]:
    config = dict(data) if isinstance(data, dict) else {}
    if not isinstance(config.get("bridge"), dict):
        config["bridge"] = {}
    if not isinstance(config.get("rooms"), list):
        config["rooms"] = []
    if not isinstance(config.get("scenes"), list):
        config["scenes"] = []
    if not config["rooms"] and not config["scenes"] and "schema_version" not in config:
        config["schema_version"] = CURRENT_VERSION  # nothing to migrate
    return config


def uploads_dir(path: str | Path | None = None) -> Path:
    """Where uploaded images are stored for the given storage file."""
    target = Path(path) if path else DEFAULT_STORAGE_PATH
    return target.parent / "uploads"


def backup_key(version: int) -> str:
    return f"config_backup_v{version}"


def _write_backup(target: Path, raw: dict[str, Any], version: int) -> None:
    document = json.dumps(raw, indent=2)
    if _is_json(target):
        backup = target.with_name(f"{target.stem}.v{version}.backup.json")
        if not backup.exists():
            backup.write_text(document, encoding="utf-8")
            os.chmod(backup, 0o600)
        return
    with closing(_connect(target)) as connection:
        connection.execute(
            "INSERT OR IGNORE INTO app_state(key, value) VALUES(?, ?)", (backup_key(version), document)
        )
        connection.commit()


def load_backup(version: int, path: str | Path | None = None) -> dict[str, Any] | None:
    """The document as it was before it was upgraded from `version`, if it was."""
    target = Path(path) if path else DEFAULT_STORAGE_PATH
    if _is_json(target):
        backup = target.with_name(f"{target.stem}.v{version}.backup.json")
        return json.loads(backup.read_text(encoding="utf-8")) if backup.exists() else None
    with closing(_connect(target)) as connection:
        row = connection.execute("SELECT value FROM app_state WHERE key = ?", (backup_key(version),)).fetchone()
    return json.loads(row[0]) if row else None


def _is_json(path: Path) -> bool:
    return path.suffix.lower() == ".json"


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute(_SCHEMA)
    return connection


def _read_raw(target: Path) -> Any:
    try:
        if _is_json(target):
            return json.loads(target.read_text(encoding="utf-8"))
        with closing(_connect(target)) as connection:
            row = connection.execute("SELECT value FROM app_state WHERE key = 'config'").fetchone()
        return json.loads(row[0]) if row else None
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """Read the document, upgrading and saving it first if it is from an older version."""
    target = Path(path) if path else DEFAULT_STORAGE_PATH
    raw = _read_raw(target)
    config = _normalize(raw)
    upgraded, start = migrate(config)
    if start < CURRENT_VERSION:
        _write_backup(target, raw if isinstance(raw, dict) else config, start)
        save_config(upgraded, target)
    return upgraded


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
