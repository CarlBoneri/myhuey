# MyHuey, for AI assistants

MyHuey is a local Philips Hue room planner: a Python package in `src/myhuey/` and a React app in
`frontend/`. It ships no AI of its own. If you are an assistant working with a person's lights or
rooms, use its tool server instead of the HTTP API or the database: `uv run myhuey mcp` starts it
over stdio (the repo's `.mcp.json` already does), and `uv run myhuey mcp --list` shows the tools.

Before designing a light scene or building a room layout, read the skills in `skills/`:
`myhuey-basics` first, then `myhuey-light-theme` or `myhuey-room-layout`. If you cannot read files,
call the `guide` tool, which serves the same text. `skills/README.md` explains how each assistant
finds them.

The limits are enforced by the tools, so do not look for a way around them. Layouts are built only
in a sandbox, never in the person's active home. Only `apply_scene`, `room_power`, and `room_dim`
change real lights, and only when the person asks. Nothing deletes a scene or a layout, and you
never make a sandbox active; the person does that in the app. To work on the code itself, see
`README.md`; run `uv run pytest -q` and `npm --prefix frontend test` before committing.
