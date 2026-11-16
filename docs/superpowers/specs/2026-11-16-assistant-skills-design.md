# Assistant skills and an MCP server: describe it, and MyHuey builds it

Status: approved by the owner on 2026-11-16, including the two answers under "Decided by the owner".

## Intent

Someone using MyHuey should be able to say what they want in plain words and get it:

- **A light theme for a room.** "Warm and dim in the office, a little teal behind the monitor,
  nothing bright behind me." A scene comes out.
- **A layout.** "A 12 by 14 foot office, desk on the north wall with two monitors, a floor lamp
  in the corner by the window." The room, its furniture, and its light positions come out.

MyHuey does not ship or call a language model. Its users have cloned the repo and run it on
their own network, so they are already in an IDE or a terminal with an AI assistant they chose
and pay for. MyHuey gives that assistant two things: **tools** to read and change the home (an
MCP server), and **skills** that teach it how to use those tools well. The owner's words: "they
are either in their ide or a terminal anyways and thus can use any language model they provide
access to."

## Goals

1. `myhuey mcp` starts an MCP server over stdio that any MCP-capable assistant can launch
   (Claude Code, Claude Desktop, Cursor, VS Code agent mode, Codex CLI, Gemini CLI, and others).
2. Its tools cover the two jobs end to end: read the home, design and preview and save and
   apply a scene, and build a room layout in a sandbox.
3. A `skills/` folder in the repo holds the know-how as plain Markdown: the coordinate system
   and units, what makes light easy on the eyes at a desk, and the steps for each job. The same
   text reaches an assistant that has no notion of "skills" in two more ways: a `guide` tool the
   model can call by itself, and MCP prompts a person can pick (see How the know-how travels).
4. A cloned repo works with no setup beyond the assistant's own: project-level config files
   point the assistant at the server and the skills.
5. Every tool is a plain Python function over `HueRoomService`, tested with pytest like the
   rest of the backend.

## Non-goals

- A chat box inside the MyHuey web app, and any model call made by MyHuey itself. (Considered;
  see Approaches. The tools built here are the ones such a chat would need later.)
- A network-facing MCP endpoint. The server speaks stdio only.
- Tools that delete anything from the active layout, that delete a scene or a layout (a sandbox
  included), or that pair or unpair a bridge. Inside a sandbox the assistant may correct its own
  work: see Layouts.
- A tool that makes a sandbox the active layout. A person does that in the app.
- Tools for photos, floor-plan images and tracing, light groups, preferences, and themes.
- A glare-check tool. The glare check exists only in the browser today; a server-side one is
  the separate "glare slice 1" plan. Until it lands, skills use roles and `suggest` (below).
- Evaluating how well a given model follows the skills. That depends on the user's model.

## Anti-goals

- **Changing the active home by surprise.** Layout-writing tools must refuse to touch the
  active layout. Enforced in the tools, not asked for in the skills.
- **Lights changing without being asked.** Only `apply_scene` and `room_power`/`room_dim` send
  anything to the bridge, and their descriptions say so in the first sentence so an assistant's
  own permission prompt is meaningful.
- **Leaking the bridge key.** No tool returns the bridge credential, certificate, or the raw
  document.
- **A model-shaped hole in the mission.** No API key field, no account, and no request from
  MyHuey to anything on the internet. (Checking whether the user's own MyHuey web app answers
  on their own machine or network, for `open_in_app`, is not that.)
- **Skills that drift from the tools.** A skill may only name tools that exist; a test checks it.

## Constraints

- Stack: Python 3.11+, the existing `HueRoomService`, argparse CLI, pytest. Flat modules under
  `src/myhuey/`.
- One new dependency: the official `mcp` Python SDK, pinned to an exact version (2.3.0 is
  current on PyPI at the time of writing). Its server API changed between 1.x and 2.x: the
  builder reads the 2.x documentation rather than relying on memory.
- All lengths in tool inputs and outputs are centimetres, plan coordinates (x right, y down
  from the room's own origin), heights off the floor. Tools also accept length strings a person
  would type ("12ft", "3.8m") wherever a room or furniture size is given, through
  `units.parse_length`.
- Real-light checks happen in the Office only, restoring the lights afterwards. Never create
  test rooms in the owner's real database: tests use a temporary database.
- No AI attribution in commits.

## Approaches

Three ways of supplying the understanding were considered. The owner picked the first.

1. **Skills and an MCP server for the assistant people already use (chosen).** MyHuey stays
   local with no key, no account, and no model shipped. Works with any model the user provides.
   Cost: the conversation happens in their assistant, not in MyHuey's window.
2. **A chat panel in the app with the user's own API key.** Self-contained, but MyHuey would
   call a cloud model at runtime, store a key, and cost money per message, against the mission
   rule of no cloud services, accounts, or paid APIs.
3. **A chat panel in the app with a local model (Ollama).** Local and free, but needs a
   multi-gigabyte install, and small local models are unreliable at multi-step work with real
   coordinates and units.

Within approach 1, two builder-level choices were made (builder's calls, not the owner's):

- **The server uses `HueRoomService` directly**, like the CLI, instead of calling the HTTP API.
  It then works whether or not `myhuey serve` is running, takes `--db` like every other
  command, and adds no network surface. For a MyHuey on another machine, the assistant launches
  it over SSH (`ssh host myhuey mcp`): stdio travels over the SSH connection, so nothing new
  listens on the network.
- **Skills are plain Markdown, also served as MCP prompts.** `SKILL.md` files are what Claude
  Code and compatible agents load; an `AGENTS.md` at the repo root points other agents at the
  same files; MCP prompts carry the same text to anything else.

## Design

### The command

`myhuey mcp [--db PATH] [--app-url URL]` runs the server on stdio until its input closes. It
prints nothing to stdout except protocol messages (logs go to stderr). `--app-url` is where the
person's browser reaches the web app, default `http://127.0.0.1:8000`; over SSH it is the
remote machine's address as the laptop sees it (`--app-url http://homeserver:8000`).
`myhuey mcp --list` prints the tool names and one-line descriptions and exits, for people
checking what an assistant will be able to do.

### Tools

Module `src/myhuey/assistant.py` holds the tool functions (plain functions taking a service and
simple arguments, returning JSON-safe dicts). Module `src/myhuey/mcp_server.py` registers them
with the SDK and nothing else. Every tool returns `{"ok": false, "error": "..."}`-style
failures as tool errors with the same plain-language messages the API gives (unknown room,
light, scene; out-of-range values), never a traceback.

Every tool that reads or writes rooms, scenes, or lights-in-rooms takes an optional `layout`
(a sandbox's name or id). Without it, reads use the active layout.

**Reading**

| Tool | Returns |
|---|---|
| `list_rooms` | Each room's name, size, light count, and whether it has a desk and screens |
| `get_room` | One room in full: outline, ceiling, openings, furniture (kind, position, size, rotation, elevation, height), and lights (id, name, product, position, height, pinned role, role per focus) |
| `describe_room` | A top-down text drawing of the room on a character grid, with a legend, so the assistant can check where things ended up |
| `list_lights` | The bridge's lights with live state (on, brightness %, colour or kelvin, reachable) and which room each is placed in. Says so plainly when no bridge is paired or it is not answering |
| `list_scenes` | Saved scenes, optionally for one room |
| `list_layouts` | The active layout and the sandboxes |
| `catalog` | The furniture kinds with their default sizes and heights, and the Hue products that can be planned |
| `suggest` | MyHuey's own eye-comfort suggestions for a room and mode at a time of day: a baseline the assistant can start from or compare against |

**Scenes** (the "light theme" job). A designed scene is expressed as per-light overrides, the
format suggestions already use: for each light id, either `colors` (1 to 5 hex colours; several
make a gradient on gradient lights) or `white` (kelvin, 2000 to 6500), plus `brightness`
(1 to 100) and optionally `on: false`.

| Tool | Does |
|---|---|
| `preview_scene` | Takes a room, a name, and overrides. Returns what each light would show. Saves nothing and sends nothing |
| `save_scene` | Saves it as an ordinary scene (new, or replacing one by id). Sends nothing |
| `apply_scene` | **Changes the real lights.** Sends a saved scene, or an unsaved one given inline, to the room. Returns what each light took, and which refused |
| `room_power`, `room_dim` | **Change the real lights.** On or off; brightness for the lit ones |

Lights not mentioned in the overrides are left as they are (base mode "keep"), unless the
caller passes `others: "off"`.

**Layouts** (the "describe a layout" job). All of these require a sandbox and refuse the active
layout with a message that says how to make one.

| Tool | Does |
|---|---|
| `create_sandbox` | A new sandbox, empty or copied from the active layout or another sandbox. Returns its id and name |
| `add_room` | A room from a width and depth (a rectangle) or an outline of corners, with a ceiling height and units |
| `update_room` | Reshapes or resizes a room already in the sandbox (new width and depth, or a new outline), or changes its ceiling height. Doors and windows follow their walls as they do in the app |
| `remove_room` | Takes a room out of the sandbox, with its furniture, light placements, and scenes |
| `remove_light` | Takes a light's placement out of a room in the sandbox. The light itself stays on the bridge |
| `set_openings` | The room's doors and windows: wall (edge index), offset along it, width, and for windows sill and top |
| `set_furniture` | Replaces the room's furniture with the list given: kind, x, y, rotation, and optional size, elevation, height (defaults from the catalog) |
| `place_light` | Puts a paired light (by id) or a planned catalog light into the room at x, y with optional rotation, height, length, and role. Calling it again for the same light moves it |
| `check_layout` | Problems a person would see at a glance: furniture or lights outside the outline, furniture overlapping, a monitor not on a desk, a monitor facing a wall or away from where the seat would be, a light with no height on a product that has no sensible default, no desk or screen at all. Each with a plain sentence and the item it concerns |
| `open_in_app` | The URL that opens this room in the web app's 3D view with the sandbox open (`<app-url>/?layout=<id>#/studio/room/<room>/3d`), and whether the app answered a health check there within two seconds. When it did not, the result says to start `myhuey serve` or pass `--app-url` |

`open_in_app` needs one small web-app change: on load, a `layout` query parameter opens that
sandbox (through the existing `openLayout`) and is then removed from the address bar.

### Skills

```
skills/
  README.md                      what these are, and how each assistant picks them up
  myhuey-basics/SKILL.md         shared reference, loaded by the other two
  myhuey-light-theme/SKILL.md    "a light theme for a room"
  myhuey-room-layout/SKILL.md    "describe a layout and have it generated"
```

- **myhuey-basics.** The coordinate system and units, with a worked example. Which way furniture
  faces at rotation 0. What the roles mean (bias, task, view, behind, ambient) and how MyHuey
  works them out. The eye-comfort rules the suggestion engine already follows, stated as rules
  an assistant can apply: lights near the eyes and screen stay near white; a light just behind
  a screen is a bias light and stays dim; lights in view or behind the chair get less colour and
  less brightness; colour goes to the rest of the room, stronger the farther from the seat;
  warmer and dimmer toward bedtime. What the tools will refuse and why.
- **myhuey-light-theme.** The steps: read the room; call `suggest` for a baseline when the
  request names an activity; assign every light by its role; `preview_scene`; describe the
  result to the person in their terms and ask before `apply_scene` or `save_scene`. Planned
  lights take part in a preview and are never sent.
- **myhuey-room-layout.** The steps: restate the room with numbers before building and ask only
  for what is missing and matters (size, where the desk and screens go, which lights);
  `create_sandbox`; `add_room`; openings; furniture from the catalog; lights; `describe_room`
  and `check_layout`, fixing what they report; finish with `open_in_app` and what to look at.
  Never activates the sandbox.

Each `SKILL.md` has the usual front matter (`name`, `description` saying when to use it) and
stays under about 200 lines.

### How the know-how travels

The skill files are the single source. `skills/` at the repo root is the canonical copy; the
wheel includes it as package data (`myhuey/skills/`), and the server reads it from the package,
falling back to the repo root in an editable install. Three routes carry it, none with its own
copy of the text:

- **Assistants with a skills feature** load the `SKILL.md` files themselves.
- **The `guide` tool** (in the Reading group): `guide()` lists the three topics with their
  descriptions; `guide(topic)` returns that skill's body, word for word. A model can call it
  without the person doing anything. The server's `instructions`, which every client receives
  on connecting, are one short fixed paragraph: what MyHuey is, "call `guide` before designing
  a scene or a layout", and the three hard rules (layouts only in a sandbox; three tools change
  real lights; nothing here deletes from the active home).
- **MCP prompts**, for clients that show them: `design_light_theme(request)` and
  `design_room_layout(request)`. Each prompt's text is the basics body, then that job's body,
  then a final line `Request: <request>`.

The drift test checks exactly this: `guide(topic)` equals the skill file's body, each prompt
equals basics body + job body + the request line, and every backticked tool name in a skill is
a registered tool.

### Wiring for a cloned repo

- `.mcp.json` at the repo root registers the server for project-scoped MCP clients:
  command `uv`, args `run myhuey mcp`.
- `.claude/skills/` holds symlinks to the three skill folders so Claude Code finds them in this
  repo; `skills/README.md` gives the one-line copy command for using them elsewhere.
- `AGENTS.md` at the repo root: three short paragraphs for other agents, pointing at
  `skills/` and at `myhuey mcp`.
- README: a new "Use it from your assistant" section with the config snippet for the common
  clients, the SSH form for a MyHuey on another machine, and two example requests.
- In the app: a Help page ("Your assistant") with the same content, and the config snippet with
  a Copy button on the Settings screen's command-line panel.

### Tests

- `tests/test_assistant_tools.py`: every tool against a temporary database with a fake bridge
  session (as `tests/conftest.py` provides). Including: layout-writing tools refuse the active
  layout; nothing is sent to the bridge by any tool other than the three marked ones; no tool
  output contains the bridge username; `check_layout` reports each problem kind; `describe_room`
  for a known room matches a stored drawing.
- `tests/test_mcp_server.py`: the server lists every tool and prompt with a description, and a
  tool call round-trips through the SDK's in-process client.
- `tests/test_skills.py`: every skill has front matter; every backticked tool name in a skill
  exists; the prompts' text equals the skill files' bodies.
- Frontend: a test for the `layout` query parameter.

## Checked against `mcp` 2.3.0

Tried in a throwaway environment on 2026-11-16, so the plan can rely on it:

- The server class is `from mcp.server.mcpserver import MCPServer` (1.x's `FastMCP` is gone).
  `@server.tool()` and `@server.prompt()` register plain functions; the docstring becomes the
  description and the type hints the argument schema. `server.run("stdio")` serves stdio.
- A tool that raises `mcp.server.mcpserver.exceptions.ToolError("message")` returns
  `is_error=True` with the message for the model to read, and no traceback. Any other exception
  is reported only as "Error executing tool <name>" with a traceback on stderr. So the server
  turns `HueError` and `ValueError` from the service into `ToolError` with the same message.
- Tests can drive the server in process: `async with mcp.Client(server) as client:` then
  `list_tools()`, `call_tool(name, arguments)`, `list_prompts()`, `get_prompt(name, arguments)`.
  A dict returned by a tool arrives as JSON text in `result.content[0].text`.

## Left to the builder

- Tool argument names and exact JSON shapes, within the tables above.
- How `describe_room` draws (grid resolution, characters, legend).
- The wording of the skills, within the content listed.
- Whether `mcp` is a core dependency or an optional extra. If an extra, `myhuey mcp` must say
  exactly how to install it.

## Order of work

This lands before the server-side glare check (`docs/superpowers/plans/2026-11-16-glare-1-checker.md`),
and does not depend on it. That plan adds fields and methods; it does not change the service
methods these tools call. When it lands, a `check_glare` tool and a paragraph in the basics
skill are a small follow-up.

## Decided by the owner

- **The assistant may fix its own work inside a sandbox** (2026-11-16): reshape a room, remove a
  room, remove a light placement, and replace furniture and openings. The ban on deleting covers
  the active layout, scenes, and layouts themselves, sandboxes included. Making a sandbox
  active stays with the person, in the app.
- **This builds on the current `feat/room-3d-view` branch**, committed first: the terminal-style
  window, tabs, help pages, folding panels, and imported themes.

## The builder's calls in this document (for the owner to check)

1. Stdio only, using the service directly; a remote MyHuey is reached over SSH.
2. The assistant may apply a scene to the real lights when asked, and may turn a room on, off,
   or dim it. It can never activate a sandbox or touch pairing. (What it may remove was decided
   by the owner, above.)
3. Layouts are only ever built in a sandbox.
4. No glare tool until the server-side glare check exists.
5. One new pinned dependency, the official `mcp` SDK.
6. Skills are served as files, through a `guide` tool the model can call, and as MCP prompts,
   so they work with assistants that have no skills feature.
7. `myhuey mcp --app-url` says where the web app is, for the link `open_in_app` returns.
8. This lands before the server-side glare check.
