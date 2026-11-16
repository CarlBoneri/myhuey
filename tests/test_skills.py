"""The skills an assistant reads, and the guide tool that serves the same text word for word."""

import re

import pytest

from myhuey.assistant import CHANGES_LIGHTS, TOOLS, WRITES_LAYOUT, guide
from myhuey.skills import TOPICS, prompt_text, skill

# Backticked snake_case words in the skills that are argument or result names, not tools.
ALLOWED_WORDS = {
    "light_id", "copy_from", "app_url", "scene_id", "resolved_roles", "resolved_elevation", "cm_per_column", "cm_per_row",
    "screen_off_desk", "screen_faces_wall", "no_seat", "height_unknown",
}


def test_every_skill_has_front_matter_and_fits():
    for topic in TOPICS:
        item = skill(topic)
        assert item["name"] == topic and len(item["description"]) > 30 and not item["body"].startswith("---")
        assert len(item["body"].splitlines()) < 200


def test_skills_only_name_tools_that_exist():
    for topic in TOPICS:
        named = set(re.findall(r"`([a-z]+(?:_[a-z]+)+)`", skill(topic)["body"])) - ALLOWED_WORDS
        assert named <= set(TOOLS), f"{topic} names {named - set(TOOLS)}"
    assert {"preview_scene", "apply_scene", "suggest"} <= set(re.findall(r"`([a-z_]+)`", skill("myhuey-light-theme")["body"]))
    assert {"create_sandbox", "check_layout", "describe_room", "open_in_app"} <= set(
        re.findall(r"`([a-z_]+)`", skill("myhuey-room-layout")["body"])
    )


def test_the_hard_limits_are_in_the_basics():
    body = skill("myhuey-basics")["body"].lower()
    for phrase in ("sandbox", "apply_scene", "room_power", "room_dim", "never"):
        assert phrase in body


def test_guide_and_prompts_are_the_files_word_for_word():
    assert [item["topic"] for item in guide()["topics"]] == list(TOPICS)
    for topic in TOPICS:
        assert guide(topic)["text"] == skill(topic)["body"]
    assert prompt_text("myhuey-light-theme", "warm and dim in the office") == \
        skill("myhuey-basics")["body"] + "\n\n" + skill("myhuey-light-theme")["body"] + "\n\nRequest: warm and dim in the office"
    with pytest.raises(ValueError, match="myhuey-basics, myhuey-light-theme, myhuey-room-layout"):
        guide("cooking")


def test_tools_are_complete_and_described():
    assert list(TOOLS)[0] == "guide" and set(CHANGES_LIGHTS) | set(WRITES_LAYOUT) <= set(TOOLS) and len(TOOLS) == 24
    for name, tool in TOOLS.items():
        assert tool.__doc__ and len(tool.__doc__.strip().splitlines()[0]) > 20, name
    for name in CHANGES_LIGHTS:
        assert TOOLS[name].__doc__.strip().startswith("Changes the real lights.")
