import asyncio
import json

import pytest
from mcp import Client

from myhuey.assistant import TOOLS
from myhuey.cli import main
from myhuey.errors import LayoutChanged
from myhuey.mcp_server import INSTRUCTIONS, build_server
from myhuey.skills import skill


def _call(server, name, arguments):
    async def go():
        async with Client(server) as client:
            return await client.call_tool(name, arguments)

    return asyncio.run(go())


def test_every_tool_and_prompt_is_listed_without_the_service_argument(service):
    async def go():
        async with Client(build_server(service)) as client:
            return (await client.list_tools()).tools, (await client.list_prompts()).prompts, client.instructions

    tools, prompts, instructions = asyncio.run(go())
    assert [tool.name for tool in tools] == list(TOOLS)
    for tool in tools:
        assert tool.description and "service" not in tool.input_schema.get("properties", {}), tool.name
    place = next(tool for tool in tools if tool.name == "place_light")
    assert {"layout", "room", "x", "y"} <= set(place.input_schema["required"]) and "app_url" not in str(
        next(t for t in tools if t.name == "open_in_app").input_schema
    )
    assert {p.name for p in prompts} == {"design_light_theme", "design_room_layout"}
    assert instructions == INSTRUCTIONS and "guide" in INSTRUCTIONS and "sandbox" in INSTRUCTIONS


def test_a_call_round_trips(service):
    result = _call(build_server(service), "list_rooms", {})
    assert result.is_error is False and json.loads(result.content[0].text)[0]["name"] == "Den"

    async def prompt():
        async with Client(build_server(service)) as client:
            return (await client.get_prompt("design_light_theme", {"request": "calm"})).messages[0].content.text

    text = asyncio.run(prompt())
    assert text.endswith("Request: calm") and text.startswith(skill("myhuey-basics")["body"][:40])


# Review Focus 5
@pytest.mark.parametrize(
    "name, arguments, words",
    [
        ("get_room", {"room": "Garage"}, "Garage"),
        ("add_room", {"layout": None, "name": "X", "width": 300, "depth": 300}, "Call create_sandbox first"),
        ("preview_scene", {"room": "Den", "name": "Bad", "lights": {"99": {"white": 2700}}}, 'light "99" is not in Den'),
    ],
)
def test_expected_failures_reach_the_model_as_their_own_words(service, name, arguments, words):
    result = _call(build_server(service), name, arguments)
    assert result.is_error is True and words in result.content[0].text and "Traceback" not in result.content[0].text


def test_a_layout_swapped_mid_call_is_a_readable_error(service, monkeypatch):
    box = service.new_layout("Try")  # made first: only the tool's own save is swapped out
    monkeypatch.setattr(service, "_save", lambda config: (_ for _ in ()).throw(LayoutChanged()))
    result = _call(build_server(service), "add_room", {"layout": box["id"], "name": "X", "width": 300, "depth": 300})
    assert result.is_error is True and str(LayoutChanged()) in result.content[0].text


def test_tools_without_a_service_still_answer(service):
    for name in ("catalog", "guide"):
        assert _call(build_server(service), name, {}).is_error is False, name


def test_nothing_is_printed_to_stdout(service, capsys):
    _call(build_server(service), "list_rooms", {})
    _call(build_server(service), "catalog", {})
    assert capsys.readouterr().out == ""


def test_cli_lists_the_tools(db_path, capsys):
    with pytest.raises(SystemExit) as done:  # main always ends by raising SystemExit
        main(["--db", db_path, "mcp", "--list"])
    assert done.value.code == 0
    out = capsys.readouterr().out
    assert out.count("\n") == len(TOOLS) and "apply_scene" in out and "Changes the real lights." in out
