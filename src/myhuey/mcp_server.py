"""The MCP server: a thin protocol layer over `assistant.TOOLS`. No rules live here.

Each tool is bound to one service (and `open_in_app` to this server's app URL), keeps its name,
docstring, and the rest of its signature, and turns the service's own errors into `ToolError`,
the only exception whose message the model gets to read. Nothing but protocol goes to stdout.
"""

from __future__ import annotations

import functools
import inspect
import json
import logging
import threading
from collections.abc import Callable
from typing import Any

import requests
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .assistant import CHANGES_LIGHTS, TOOLS, WRITES_LAYOUT
from .errors import HueError
from .roles import using_body
from .service import HueRoomService
from .skills import prompt_text

DEFAULT_APP_URL = "http://127.0.0.1:8000"

INSTRUCTIONS = (
    "MyHuey plans a Philips Hue home: rooms, lights, and scenes. Call `guide` before designing a "
    "scene or a layout; it returns the rules and the method. Three rules hold throughout. "
    "Layouts are only built in a sandbox: call create_sandbox, then pass its id as layout; the "
    "active home is never edited here. Three tools change the real lights: apply_scene, "
    "room_power, and room_dim. Nothing here deletes from the active home."
)

# Tools that neither change lights nor write a layout but are not read-only: create_sandbox and
# save_scene save something, and open_in_app makes a request to the app's address.
_NOT_READ_ONLY = ("create_sandbox", "save_scene", "open_in_app")

_log = logging.getLogger(__name__)


def _bound(tool: Callable[..., Any], service: HueRoomService, app_url: str, one_at_a_time: threading.Lock) -> Callable[..., Any]:
    """The tool with `service` (and `app_url`) filled in, hidden from its schema, errors made readable.

    The SDK runs each sync tool in its own worker thread, so calls an assistant sends together run
    at once. The service loads, changes, and saves the whole document, so two writes at once would
    lose one; `one_at_a_time` makes the calls take turns."""
    signature = inspect.signature(tool, eval_str=True)
    fixed: dict[str, Any] = {"service": service} if "service" in signature.parameters else {}
    if tool.__name__ == "open_in_app":
        fixed["app_url"] = app_url
    hidden = set(fixed)

    @functools.wraps(tool)
    def call(*args: Any, **kwargs: Any) -> Any:
        try:
            with one_at_a_time, using_body(service.body()):
                result = tool(**fixed, **kwargs)
        except (HueError, ValueError) as exc:
            raise ToolError(str(exc)) from exc
        except requests.RequestException as exc:
            # Its message can print the URL, and a v1 bridge URL holds the key.
            raise ToolError("The bridge or the app could not be reached.") from exc
        except Exception as exc:
            # A bug, or input of a shape the tool did not expect. The traceback goes to stderr (the
            # client's log); the model gets a sentence it can act on, with no paths or code in it.
            _log.error("Tool %s failed", tool.__name__, exc_info=exc)
            raise ToolError(
                f"{tool.__name__} failed with an unexpected {type(exc).__name__}. The input may be malformed: "
                "check each argument's type and shape against the tool's description, then try again."
            ) from exc
        # The SDK sends a list as one text block per item; the model should get one JSON document.
        return json.dumps(result, indent=2, ensure_ascii=False) if isinstance(result, list) else result

    call.__signature__ = signature.replace(  # type: ignore[attr-defined]
        parameters=[p for name, p in signature.parameters.items() if name not in hidden]
    )
    call.__annotations__ = {k: v for k, v in tool.__annotations__.items() if k not in hidden}
    return call


def build_server(service: HueRoomService, app_url: str = DEFAULT_APP_URL) -> MCPServer:
    server = MCPServer("myhuey", instructions=INSTRUCTIONS)
    one_at_a_time = threading.Lock()
    for name, tool in TOOLS.items():
        read_only = name not in CHANGES_LIGHTS and name not in WRITES_LAYOUT and name not in _NOT_READ_ONLY
        server.tool(name=name, annotations=ToolAnnotations(readOnlyHint=read_only), structured_output=False)(
            _bound(tool, service, app_url, one_at_a_time)
        )

    @server.prompt()
    def design_light_theme(request: str) -> str:
        """Design a light scene for a room from a request."""
        return prompt_text("myhuey-light-theme", request)

    @server.prompt()
    def design_room_layout(request: str) -> str:
        """Build a room layout in a sandbox from a request."""
        return prompt_text("myhuey-room-layout", request)

    return server


def run(db: str | None, app_url: str = DEFAULT_APP_URL) -> None:
    """Serve over stdio until the client closes it."""
    build_server(HueRoomService(db), app_url).run("stdio")
