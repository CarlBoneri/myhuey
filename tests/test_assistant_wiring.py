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
    for words in ("## Use it from your assistant", '"command": "uv"', "ssh", "--app-url", "myhuey mcp --list"):
        assert words in text
