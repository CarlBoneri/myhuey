"""The skills: Markdown that teaches an assistant to use MyHuey's tools well.

`skills/` at the repo root is the one copy of the text. The wheel ships it as `myhuey/skills`;
an editable install reads it from the repo. The `guide` tool and the MCP prompts serve these
files word for word.
"""

from __future__ import annotations

from importlib.resources import files
from pathlib import Path
from typing import Any

TOPICS = ("myhuey-basics", "myhuey-light-theme", "myhuey-room-layout")


def _folder() -> Any:
    """Where the skill folders are: inside the installed package, else the repo's `skills/`."""
    packaged = files("myhuey") / "skills"
    if packaged.is_dir():
        return packaged
    return Path(__file__).resolve().parents[2] / "skills"


def _unknown(topic: str) -> ValueError:
    return ValueError(f'There is no topic "{topic}". Topics: {", ".join(TOPICS)}.')


def skill(topic: str) -> dict[str, str]:
    """One skill as {name, description, body}: its front matter read, its body without it."""
    if topic not in TOPICS:
        raise _unknown(topic)
    text = (_folder() / topic / "SKILL.md").read_text(encoding="utf-8")
    meta: dict[str, str] = {}
    body = text
    if text.startswith("---\n"):
        head, marker, rest = text[4:].partition("\n---\n")
        if marker:
            body = rest
            for line in head.splitlines():
                key, colon, value = line.partition(":")
                if colon:
                    meta[key.strip()] = value.strip().strip('"').strip("'")
    return {"name": meta.get("name", topic), "description": meta.get("description", ""), "body": body.strip()}


def prompt_text(job: str, request: str) -> str:
    """The text of an MCP prompt: the basics, then the job's skill, then the person's request."""
    return skill("myhuey-basics")["body"] + "\n\n" + skill(job)["body"] + "\n\nRequest: " + request
