// The help that ships inside the app. Plain data, so the Help screen, the palette, and the tests
// all read the same pages. Commands shown under "Try" are checked by a test against the prompt.
import type { Route } from './router';

/** The config that starts the tool server from this repo's folder; the same as `.mcp.json`. */
export const MCP_CONFIG = JSON.stringify({ mcpServers: { myhuey: { command: 'uv', args: ['run', 'myhuey', 'mcp'] } } }, null, 2);
/** The same server without uv, from the folder's virtual environment; works from any folder. */
export const MCP_VENV_CONFIG = JSON.stringify({ mcpServers: { myhuey: { command: '/path/to/myhuey/.venv/bin/myhuey', args: ['mcp'] } } }, null, 2);

export type Block =
  | { p: string }
  | { list: string[] }
  | { steps: string[] }
  | { keys: [string, string][] }
  /** Commands to put in the prompt. They are filled in, not run. */
  | { try: string[] }
  /** A block of text to copy as written. */
  | { code: string }
  /** The prompt's whole command table, generated from the commands themselves. */
  | { commands: true }
  | { links: { label: string; route: Route }[] };

export interface Topic { id: string; title: string; summary: string; blocks: Block[] }

export const TOPICS: Topic[] = [
  {
    id: 'start', title: 'Getting started', summary: 'Pair the bridge, draw a room, place your lights.',
    blocks: [
      { p: 'MyHuey runs on your computer and talks to your Hue bridge over your own network. Nothing leaves the house. It is built for long days at a desk: light that is easy on your eyes, set up once and then changed with a tap or a command.' },
      { steps: [
        'Pair the bridge. Settings & CLI has the setup guide: find the bridge, press its link button, done.',
        'Make a room. On the floor plan, draw the room or import the rooms you already have in the Hue app.',
        'Design it. Open the room in the Studio and add the desk, the screens, doors and windows, then drag each light to where it really is.',
        'Use it. Home turns rooms on and off and dims them. The workbench tunes one room and suggests scenes for what you are doing.',
      ] },
      { links: [
        { label: 'Open the setup guide', route: { view: 'setup' } },
        { label: 'Open the floor plan', route: { view: 'studio' } },
      ] },
    ],
  },
  {
    id: 'window', title: 'The window: tabs, prompt, and ⌘K', summary: 'Rearrange and close tabs, type commands, find anything.',
    blocks: [
      { p: 'Tabs along the top open each screen. Drag a tab to move it. The × on a tab closes it, and a middle click does too. The + at the end of the tabs brings closed tabs back and can reset them all. Opening a screen whose tab is closed reopens it.' },
      { p: 'The tabs can sit in the top bar (the default), in a strip just above the prompt, or in a rail down the left or right side. Change the position in Settings under Preferences, by right-clicking the tab bar (Shift-F10 on a focused tab does the same), or by typing tabs top, tabs bottom, tabs left, or tabs right. In a rail, Alt-Shift-↑ ↓ moves the focused tab. In a window narrower than 720 px the tabs stay in the top bar.' },
      { p: 'A rail can be resized: drag its inner edge (double-click resets it, and the arrow keys work when the edge is focused), or type tabs width 260. The button at the top of the rail, or tabs collapse and tabs expand, folds it to an icon strip; dragging it very narrow does the same.' },
      { p: 'The prompt at the bottom runs commands through the same API the screens use and shows what really happened. It understands a fixed list and nothing else: it never runs a shell. Click the line above it for the history.' },
      { p: '⌘K (Ctrl-K) opens the palette. Type a few letters of a room, scene, group, screen, theme, or help page and press Enter. Workflows, in the top bar, is a drawer of ready-made commands for the room you were last in.' },
      { p: 'Side panels fold. Click a panel title, or the triangle beside it, to hide its contents; Alt-click folds or opens every panel in that sidebar. What you fold stays folded next time.' },
      { keys: [['⌘K / Ctrl-K', 'Command palette'], ['/', 'Jump to the prompt'], ['↑ ↓ in the prompt', 'Earlier and later commands'], ['Alt-Shift-← → (↑ ↓ in a rail)', 'Move the focused tab'], ['Esc', 'Close the palette, leave the prompt, deselect']] },
    ],
  },
  {
    id: 'home', title: 'Home', summary: 'Every room at a glance: on, off, dim, and one-tap scenes.',
    blocks: [
      { p: 'Home always shows your active layout, even while a sandbox is open. Each room has a power switch and a dimmer in Quick settings, and a tile showing how many lights are on and their colors.' },
      { list: [
        'Click a tile to open that room’s workbench.',
        'The ⋮ on a tile opens three eye-comfort suggestions for right now, a mode picker, and the room’s saved scenes. Tap one and it goes to the lights.',
        'The dimmer only changes lights that are on. Lights that are off stay off.',
      ] },
      { try: ['room on Office', 'room dim Office 30', 'room off Office'] },
    ],
  },
  {
    id: 'workbench', title: 'Room workbench', summary: 'Tune one room: each light, its scenes, and suggestions.',
    blocks: [
      { p: 'The workbench is where you use a room. It has All on, All off, the room dimmer, and a card per light. Click a card for that light’s brightness, white temperature (2000 to 6500 K), and color. Gradient lights also get a gradient editor and effects.' },
      { p: 'The side lists the room’s scenes with Apply, and the suggestions panel stays open under the lights.' },
      { try: ['open workbench Office', 'scene list', 'scene apply office_night'] },
    ],
  },
  {
    id: 'design', title: 'Design a room', summary: 'Outline, furniture, doors and windows, and where the lights sit.',
    blocks: [
      { p: 'The Studio is one place for designing rooms, and you can open it from its tab without going through a room first. Its header has a Room menu and four views: Home plan (the whole floor plan), Room plan, 3D, and Photo. Choose another room in the menu and you stay on the same view of it; choose Whole home to go back to the floor plan. The room designer draws one room to scale. Everything is measured in real units, and you can type lengths as 12ft 6in, 3.8m, or 380cm.' },
      { steps: [
        'Shape the room. Use the outline tool to drag corners, add a corner with +, or pick Rectangle or L-shape in the Room panel.',
        'Add doors and windows with the openings tool. Windows keep a sill and a top height.',
        'Add furniture from the Furniture panel: desks, monitors, shelves, pillars. Drag to move, drag the handle to turn, set heights in its panel.',
        'Place lights. Drag a light from “Lights to place” onto the plan. It is drawn at its real size: strips long and thin, bulbs round.',
        'Set each light’s height and role in its panel, or leave both on Auto.',
      ] },
      { p: 'You can also place Hue products you do not own yet from Plan lights. They take part in suggestions and nothing is sent to the bridge for them.' },
      { keys: [['Arrows', 'Nudge the selection (Shift for a bigger step)'], ['R / Shift-R', 'Rotate 15°'], ['Delete', 'Remove the selection'], ['Esc', 'Deselect']] },
      { try: ['open plan Office', 'open 3d Office', 'open photo Office'] },
    ],
  },
  {
    id: 'glare', title: '3D view and the glare check', summary: 'See the room in 3D and find lights that hurt your eyes.',
    blocks: [
      { p: 'The 3D view is one of the Studio’s four views. Its Room menu switches to another room and stays in 3D, and the Studio · 3D & Glare tab always opens it, for the room you were last in or else the first. It draws the room from the same data as the plan: walls on the real outline up to the ceiling, doors and windows at their heights, furniture as solids, and each light at its height in its live color.' },
      { list: [
        'Drag the background to orbit. Shift-drag or Space-drag pans. The wheel zooms toward the cursor.',
        'Drag a light and it slides across the room at its own height. Hold Alt (Option) and drag to raise or lower it.',
        'Drag a desk and the screens and lights on it come along. Shift-drag turns it.',
        'Desk eye-level sits you at the desk, looking at the screen.',
      ] },
      { p: 'The glare table under the view checks every light from the desk seat. “Reflects in the screen” means the light bounces off a monitor into your eyes. “In your line of sight” and “At the edge of your view” mean you see the light itself while looking at the screen. A light just behind a screen is a bias light, which is good.' },
      { p: 'Each flagged light gets a level to stay under. Fix glare dims the lit lights that are over it and never brightens anything. Standing is a preview: it raises your eyes and any sit-stand desk, and it is not saved.' },
      { keys: [['= and -', 'Zoom in and out'], ['0', 'Fit the room'], ['Arrows', 'Orbit (with nothing selected)'], ['Alt-drag a light', 'Change its height']] },
      { try: ['room glare Office', 'room posture Office standing', 'room glare Office --fix'] },
    ],
  },
  {
    id: 'suggestions', title: 'Eye-comfort suggestions', summary: 'Scenes made from what you are doing, the time, and your room.',
    blocks: [
      { p: 'Pick a mode (Code, Work, Study, Read, Chill) and MyHuey proposes scenes for this moment. It uses the clock, your wake time and bedtime from Settings, and where each light sits relative to your seat and screen.' },
      { list: [
        'Lights by the desk stay near white, at a temperature that warms toward evening.',
        'A light just behind the monitor stays dim, as a bias light.',
        'Lights in your view or behind your chair get less color and less brightness.',
        'The rest of the room carries the palette’s color.',
      ] },
      { p: 'A suggestion is only a preview until you send it. Save one and it becomes an ordinary scene you can edit.' },
      { try: ['suggest --room Office --mode code', 'suggest --room Office --mode relax --apply'] },
    ],
  },
  {
    id: 'scenes', title: 'Scenes', summary: 'Paint colors onto a room, or lay an image over it.',
    blocks: [
      { p: 'A scene belongs to one room. In the scene editor you paint zones of color onto the room’s plan, or lay an image over it, and each light takes the color under it. Gradient lights take several colors along their length.' },
      { list: [
        'Base decides what lights outside every zone do: off, keep as they are, one color, or the nearest zone.',
        'Click a light in “What each light gets” to override just that light.',
        'Preview sends the scene to the lights without saving it.',
        'The Hue gallery on the Scenes screen recreates the Hue app’s scenes in any room.',
      ] },
      { try: ['open scenes', 'scene list'] },
    ],
  },
  {
    id: 'lights', title: 'Lights and groups', summary: 'Every light on the bridge, and saved sets of them.',
    blocks: [
      { p: 'Lights & Groups lists every light the bridge knows, grouped by room. Select several to change them together. Save a selection as a group, and save the group’s look to put every light back exactly as it is now, colors and gradients included.' },
      { try: ['groups list', 'groups apply Desk'] },
    ],
  },
  {
    id: 'layouts', title: 'Layouts and sandboxes', summary: 'Try a different arrangement without touching your home.',
    blocks: [
      { p: 'A layout is a whole home: rooms, furniture, light positions, and scenes. One layout is active and runs the app. The others are sandboxes, copies you can change freely.' },
      { list: [
        'While a sandbox is open, a banner says so on every screen and the prompt shows its name.',
        'Home keeps showing and controlling the active layout.',
        'Make active swaps the sandbox in. Your previous layout is kept as a sandbox.',
      ] },
      { try: ['layouts list', 'layouts new', 'layouts open active'] },
    ],
  },
  {
    id: 'themes', title: 'Themes', summary: 'MyHuey’s own themes, plus the ones from your editor and your shell.',
    blocks: [
      { p: 'The theme menu in the top bar changes the look from any screen. Settings has the same menu, plus System, which follows your computer’s light or dark mode with a theme you choose for each.' },
      { p: 'Besides MyHuey’s own seven themes, the menu lists the colour themes installed in VS Code on this computer and the palettes from Starship’s presets. A theme only recolours the app. Your lights always show their real colours.' },
      { p: 'An imported theme supplies a background, a text colour, and terminal colours. MyHuey works the rest out and adjusts text until it reads clearly, so greys can be a little lighter or darker than in your editor.' },
      { p: 'Installed a new theme in VS Code? Run `uv run python scripts/import_editor_themes.py` in the MyHuey folder, rebuild the web app, and restart `myhuey serve`.' },
      { try: ['theme dracula', 'theme vscode-dark-modern', 'theme Tokyo Night', 'theme system'] },
    ],
  },
  {
    id: 'commands', title: 'Commands', summary: 'Everything the prompt understands.',
    blocks: [
      { p: 'Commands follow the real myhuey CLI where it has one, so `myhuey room dim --name Office --level 30` works as typed. The short form works too. A command with no room uses the room you were last in. Names can be shortened to their first letters when that is not ambiguous, and names with spaces can be quoted.' },
      { commands: true },
      { p: 'Commands act on the layout named in the prompt. room posture and room glare exist only here for now, not in the terminal CLI. The full CLI is described under Settings & CLI.' },
    ],
  },
  {
    id: 'assistant', title: 'Your assistant', summary: 'Let the AI assistant you already use read your home and design lights.',
    blocks: [
      { p: 'MyHuey has no AI of its own. `myhuey mcp` is a tool server that your own assistant (Claude Code, Claude Desktop, Cursor, VS Code, or any MCP client) starts on this computer, so it can read your rooms and lights and design scenes and layouts for you. MyHuey needs no account or API key, and its server talks only to your bridge and to this app’s address: it sends nothing to the internet. But the assistant reads what the tools return (your room names, layouts, and light states), and that goes wherever the assistant sends its conversations, so it falls under that assistant’s privacy terms, not MyHuey’s. The tools never return the bridge key.' },
      { p: 'This config starts the server with `uv`. Put it in the `.mcp.json` of the MyHuey folder (Claude Code finds it there already); it works from that folder only. Anywhere else, add `"--directory", "/path/to/myhuey"` after `"run"`, or use the form below. Settings has the same text under Command line, with a Copy button.' },
      { code: MCP_CONFIG },
      { p: 'Without `uv`, or when an app such as Claude Desktop cannot find it (apps opened from the dock often miss your shell’s PATH), point the config at the `myhuey` in the folder’s virtual environment. It works from any folder:' },
      { code: MCP_VENV_CONFIG },
      { p: 'If MyHuey runs on a home server and your assistant on a laptop, the config’s command is `ssh`, with args `["you@homeserver", "/path/to/myhuey/.venv/bin/myhuey", "mcp", "--app-url", "http://homeserver:8000"]`, so the link to the 3D view opens in the laptop’s browser. Start the app on the server with `myhuey serve --host 0.0.0.0` so that address answers beyond the server itself. Whether the app is answering is checked from the server’s side.' },
      { list: [
        'It builds layouts only in a sandbox, a private copy of your home. Every layout-writing tool refuses the active home.',
        'Only three tools change your real lights: apply_scene, room_power, and room_dim. The assistant is taught to use them only when you ask.',
        'It never deletes anything from your active home, and never deletes a layout. It can remove rooms (with their scenes) and lights only inside a sandbox it is building.',
        'It cannot touch bridge pairing.',
        'It cannot make a sandbox active. Look at it in the app, then use Make active yourself.',
      ] },
      { p: 'Try asking: “Make the office easy on the eyes for coding tonight, warm and dim, and show me before you apply it.” Or: “Build my office in a sandbox, 12 by 14 feet, desk on the north wall under the window.”' },
      { links: [{ label: 'Open Settings', route: { view: 'settings' } }] },
    ],
  },
  {
    id: 'data', title: 'Your data', summary: 'Where things are stored, and what leaves your computer.',
    blocks: [
      { p: 'Everything is stored on this computer under ~/.myhuey: one database, your uploaded images, and the bridge’s pinned certificate. The pairing key never reaches the browser. Fonts and code are bundled, so the app makes no requests to the internet while it runs. Bridge discovery can ask Hue’s discovery service once, when you ask it to find bridges.' },
      { p: 'Tab order, folded panels, pane sizes, and the room you were last in are remembered in this browser only.' },
    ],
  },
];

export const topic = (id: string | undefined): Topic => TOPICS.find((item) => item.id === id) ?? TOPICS[0];

/** The help page that explains the screen you are on. */
export function topicFor(route: Route): string {
  switch (route.view) {
    case 'home': return 'home';
    case 'room': return 'workbench';
    case 'design': case 'studio-room': return route.tab === '3d' ? 'glare' : 'design';
    case 'studio': return 'design';
    case 'scenes': case 'scene': return 'scenes';
    case 'lights': return 'lights';
    case 'setup': return 'start';
    case 'settings': return 'data';
    default: return 'start';
  }
}

const textIn = (block: Block): string =>
  'p' in block ? block.p : 'list' in block ? block.list.join(' ') : 'steps' in block ? block.steps.join(' ')
    : 'keys' in block ? block.keys.flat().join(' ') : 'try' in block ? block.try.join(' ') : 'code' in block ? block.code : 'links' in block ? block.links.map((link) => link.label).join(' ') : '';

/** Topics that mention every typed word, best match (title, then summary, then body) first. */
export function searchHelp(query: string): Topic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return TOPICS;
  return TOPICS.map((item, index) => {
    const title = item.title.toLowerCase();
    const summary = item.summary.toLowerCase();
    const body = item.blocks.map(textIn).join(' ').toLowerCase();
    let score = 0;
    for (const word of words) {
      if (title.includes(word)) score += 3;
      else if (summary.includes(word)) score += 2;
      else if (body.includes(word)) score += 1;
      else return { item, index, score: 0 };
    }
    return { item, index, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.item);
}
