# Skills for your AI assistant

MyHuey ships no AI of its own. These skills teach the assistant you already use (in your editor
or terminal) how to work with MyHuey's tools well: where things are in a room, what makes light
easy on the eyes at a desk, and the steps for each job.

| Skill | What it is for |
|---|---|
| `myhuey-basics/` | The shared reference: plan coordinates and units, which way furniture faces, light roles, the eye-comfort rules, and what the tools refuse to do. The other two build on it. |
| `myhuey-light-theme/` | "Warm and dim in the office, a little teal in the corner": design a scene, preview it, and apply or save it when you say so. |
| `myhuey-room-layout/` | "12 by 14 feet, desk on the north wall under the window": build the room in a sandbox and hand you a link to see it in 3D. |

The tools themselves come from `myhuey mcp`, a tool server your assistant starts on your own
machine. The skills are plain Markdown and the only copy of this know-how. They reach your
assistant three ways:

- **Assistants that load skill files** (Claude Code and compatible agents) read the `SKILL.md`
  files. In this repo they are found through `.claude/skills/`. To use them in another project,
  copy them in:

  ```
  mkdir -p .claude/skills && cp -R /path/to/myhuey/skills/myhuey-* .claude/skills/
  ```

- **Any assistant connected to `myhuey mcp`** can call its `guide` tool, which lists these topics
  and returns each one's text word for word.
- **Assistants that show MCP prompts** offer "design_light_theme" and "design_room_layout",
  which carry the same text with your request at the end.

The wheel ships this folder as `myhuey/skills`, so an installed MyHuey serves the same text.
Edit the files here; a test checks that every tool a skill names exists.
