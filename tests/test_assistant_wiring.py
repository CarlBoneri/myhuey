"""The repo is wired so a fresh clone can use the assistant tools and skills."""
import json
from pathlib import Path

TOPICS = ("myhuey-basics", "myhuey-light-theme", "myhuey-room-layout")


def test_project_config_starts_the_server():
    config = json.loads(Path(".mcp.json").read_text())
    assert config == {"mcpServers": {"myhuey": {"command": "uv", "args": ["run", "myhuey", "mcp"]}}}


def test_claude_code_finds_the_skills():
    for topic in TOPICS:
        link = Path(".claude/skills") / topic
        assert link.is_symlink() and (link / "SKILL.md").read_text() == (Path("skills") / topic / "SKILL.md").read_text()


def test_other_agents_are_pointed_at_them():
    text = Path("AGENTS.md").read_text()
    assert "skills/" in text and "myhuey mcp" in text and len(text.splitlines()) < 40


def test_readme_covers_setup_ssh_and_examples():
    text = Path("README.md").read_text()
    for words in ("## Use it from your assistant", '"command": "uv"', "ssh", "--app-url", "myhuey mcp --list",
                  '"command": "/path/to/myhuey/.venv/bin/myhuey"', '"command": "ssh"', "--host 0.0.0.0", "which uv",
                  "never deletes anything from your active home"):
        assert words in text, words
    assert "cannot delete a scene" not in text and "ssh -L" not in text


def test_no_doc_says_a_scene_is_never_deleted():
    """remove_room in a sandbox drops that room's scenes, so only the active home is safe from deletes."""
    for path in ("AGENTS.md", "skills/myhuey-basics/SKILL.md"):
        text = " ".join(Path(path).read_text().split())
        assert "deletes a scene" not in text and "active home" in text, path
