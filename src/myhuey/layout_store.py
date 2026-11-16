"""Saved layouts other than the Active one, each kept as its own record next to the main document.

SQLite storage keeps a record under the key `layout:<id>` in `app_state`; JSON storage keeps it in
`<stem>.layout-<id>.json` beside the main file. The Active layout's home data stays in the main
document (see storage.py), so code that only knows about one home keeps working unchanged.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from .storage import DEFAULT_STORAGE_PATH, _connect, _is_json, _normalize

_PREFIX = "layout:"


def _target(path: str | Path | None) -> Path:
    return Path(path) if path else DEFAULT_STORAGE_PATH


def _file(target: Path, layout_id: str) -> Path:
    return target.with_name(f"{target.stem}.layout-{layout_id}.json")


def _write_atomic(path: Path, document: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(document, encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def _upsert(connection: sqlite3.Connection, key: str, document: str) -> None:
    connection.execute(
        "INSERT INTO app_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, document),
    )


def _delete_in(target: Path, layout_id: str, connection: sqlite3.Connection | None = None) -> None:
    """Remove one record: inside the given transaction for SQLite, or its file for JSON."""
    if connection is not None:
        connection.execute("DELETE FROM app_state WHERE key = ?", (_PREFIX + layout_id,))
    else:
        _file(target, layout_id).unlink(missing_ok=True)


def load_layout(layout_id: str, path: str | Path | None = None) -> dict[str, Any] | None:
    target = _target(path)
    try:
        if _is_json(target):
            return json.loads(_file(target, layout_id).read_text(encoding="utf-8"))
        with closing(_connect(target)) as connection:
            row = connection.execute("SELECT value FROM app_state WHERE key = ?", (_PREFIX + layout_id,)).fetchone()
        return json.loads(row[0]) if row else None
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def save_layout(record: dict[str, Any], path: str | Path | None = None) -> None:
    target = _target(path)
    document = json.dumps(record, indent=2)
    if _is_json(target):
        _write_atomic(_file(target, record["id"]), document)
        return
    with closing(_connect(target)) as connection, connection:
        _upsert(connection, _PREFIX + record["id"], document)
    os.chmod(target, 0o600)


def delete_layout(layout_id: str, path: str | Path | None = None) -> None:
    target = _target(path)
    if _is_json(target):
        _delete_in(target, layout_id)
        return
    with closing(_connect(target)) as connection, connection:
        _delete_in(target, layout_id, connection)


def list_layouts(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Every saved record (not the Active layout), oldest first."""
    target = _target(path)
    records: list[dict[str, Any]] = []
    if _is_json(target):
        for file in target.parent.glob(f"{target.stem}.layout-*.json"):
            if file.name.endswith(".backup.json"):
                continue
            try:
                records.append(json.loads(file.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
    elif target.exists():
        with closing(_connect(target)) as connection:
            rows = connection.execute("SELECT value FROM app_state WHERE key LIKE 'layout:%'").fetchall()
        records = [json.loads(value) for (value,) in rows]
    return sorted(records, key=lambda item: (item.get("created") or 0, item.get("id", "")))


def backup_layout(record: dict[str, Any], version: int, path: str | Path | None = None) -> None:
    """Keep a record as it was before it was upgraded from `version` (never overwritten)."""
    target = _target(path)
    document = json.dumps(record, indent=2)
    if _is_json(target):
        backup = target.with_name(f"{target.stem}.layout-{record['id']}.v{version}.backup.json")
        if not backup.exists():
            _write_atomic(backup, document)
        return
    with closing(_connect(target)) as connection, connection:
        connection.execute(
            "INSERT OR IGNORE INTO app_state(key, value) VALUES(?, ?)",
            (f"layout_backup:{record['id']}:v{version}", document),
        )


def swap_active(config: dict[str, Any], old_record: dict[str, Any], new_id: str, path: str | Path | None = None) -> None:
    """Make a sandbox the Active layout: the main document becomes `config`, the old Active layout
    is kept as `old_record`, and the sandbox's own record goes.

    SQLite does all three in one transaction. JSON storage writes the old layout first and removes
    the sandbox's file last, so a crash partway leaves a duplicate, never a lost layout.
    """
    target = _target(path)
    main = json.dumps(_normalize(config), indent=2)
    old = json.dumps(old_record, indent=2)
    if _is_json(target):
        _write_atomic(_file(target, old_record["id"]), old)
        _write_atomic(target, main)
        _delete_in(target, new_id)
        return
    with closing(_connect(target)) as connection, connection:
        _upsert(connection, "config", main)
        _upsert(connection, _PREFIX + old_record["id"], old)
        _delete_in(target, new_id, connection)
    os.chmod(target, 0o600)
