// The prompt's command language. A typed line becomes an intent: one of a fixed set of things
// the app can already do through its API. Nothing here runs a shell, and nothing runs on the
// server. Commands follow the real `myhuey` CLI where it has one (`room dim --name Office
// --level 30`), and also take the short positional form (`room dim Office 30`).
import type { Route } from './router';
import type { Posture } from './rig';
import { THEMES, type Theme } from './theme';
import { TOPICS } from './helpDocs';
import { RAIL_MAX, RAIL_MIN, TAB_PLACEMENTS, clampRail, type TabPlacement } from './tabs';
import { studioRoom } from './studio';

export interface Snapshot {
  rooms: { name: string }[];
  scenes: { id: string; name: string; room: string }[];
  groups: { id: string; name: string }[];
  layouts: { id: string; name: string; active: boolean }[];
  /** The room commands fall back to when none is named. */
  currentRoom: string | null;
  /** The room you were last in, as remembered (no fallback). The Studio's own rule starts here. */
  remembered?: string | null;
}

export type Intent =
  | { kind: 'help' }
  | { kind: 'rooms' }
  | { kind: 'power'; room: string; on: boolean }
  | { kind: 'dim'; room: string; level: number }
  | { kind: 'posture'; room: string; posture: Posture }
  | { kind: 'glare'; room: string; mode: string; fix: boolean }
  | { kind: 'suggest'; room: string; mode: string; apply: boolean }
  | { kind: 'groups' }
  | { kind: 'group-apply'; id: string; name: string }
  | { kind: 'layouts' }
  | { kind: 'layout-open'; id: string | null; name: string }
  | { kind: 'layout-new'; name: string | null }
  | { kind: 'tabs-reset' }
  | { kind: 'tabs-place'; placement: TabPlacement }
  | { kind: 'tabs-rail'; collapsed?: boolean; width?: number }
  | { kind: 'scenes'; room: string | null }
  | { kind: 'scene-apply'; id: string; name: string }
  | { kind: 'open'; route: Route; label: string }
  | { kind: 'theme'; theme: Theme }
  | { kind: 'error'; message: string };

export const MODES = ['code', 'work', 'study', 'read', 'relax'];
/** The name each mode goes by in the prompt: the relax preset is shown, and typed, as chill. */
const MODE_NAMES: Record<string, string> = { relax: 'chill' };
const modeName = (mode: string) => MODE_NAMES[mode] ?? mode;
/** A typed mode to its id: "chill" is the relax preset, as in the CLI and the API. */
const modeId = (typed: string) => Object.keys(MODE_NAMES).find((id) => MODE_NAMES[id] === typed) ?? typed;
export const DESK_MODES = ['code', 'work', 'study'];

export const HELP: [string, string][] = [
  ['room list', 'The rooms in the open layout'],
  ['room on|off <room>', 'Turn every light in a room on or off'],
  ['room dim <room> <1-100>', 'Dim the lit lights in a room'],
  ['room posture <room> seated|standing', 'Preview sitting or standing in the 3D view'],
  ['room glare <room> [--mode code] [--fix]', 'Check for glare from the desk; --fix dims the flagged lights'],
  ['suggest --room <room> --mode <mode> [--apply]', 'Eye-comfort suggestions; --apply sends the first to the lights'],
  ['scene list | scene apply <scene>', 'Saved scenes'],
  ['groups list | groups apply <group>', 'Saved light groups and their looks'],
  ['layouts list | layouts open <layout>|active', 'Saved layouts and sandboxes'],
  ['layouts new [name]', 'Copy the open layout into a new sandbox and open it'],
  ['open home|studio|scenes|lights|settings|setup', 'Go to a screen'],
  ['open workbench|plan|3d|photo [room]', 'Go to a room: use it, or design it in the Studio. Without a room, plan, 3d, and photo open the room you were last in, else the first'],
  ['open help [topic]', 'The help pages'],
  ['tabs top|bottom|left|right', 'Put the tabs in the top bar, above the prompt, or in a rail down the left or right'],
  ['tabs collapse|expand', 'Fold the tab rail (tabs on the left or right) to icons, or open it again'],
  ['tabs width <px>', `Set the tab rail's width, ${RAIL_MIN} to ${RAIL_MAX} px`],
  ['tabs reset', 'Put every tab back, in the original order'],
  ['theme <name>|system', 'Switch the color theme'],
];

/** Split a line into words, keeping quoted phrases together: `groups apply "Desk Halo"`. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

/** Words and `--flag value` pairs. A flag with no value (or followed by another flag) is `true`. */
export function parseArgs(tokens: string[]): { words: string[]; flags: Record<string, string | true> } {
  const words: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith('--') && token.length > 2) {
      const [name, inline] = token.slice(2).split(/=(.*)/s);
      const next = tokens[i + 1];
      if (inline !== undefined) flags[name] = inline;
      else if (next !== undefined && !next.startsWith('--') && !BOOLEAN_FLAGS.includes(name)) { flags[name] = next; i++; }
      else flags[name] = true;
    } else words.push(token);
  }
  return { words, flags };
}
const BOOLEAN_FLAGS = ['fix', 'apply'];

const fail = (message: string): Intent => ({ kind: 'error', message });
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The one item a name means: an exact match ignoring case, else the only one that starts with it. */
function pick<T>(items: T[], text: string, keys: (item: T) => string[]): T | 'none' | 'many' {
  const exact = items.filter((item) => keys(item).some((key) => same(key, text)));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return 'many';
  const starts = items.filter((item) => keys(item).some((key) => key.toLowerCase().startsWith(text.trim().toLowerCase())));
  return starts.length === 1 ? starts[0] : starts.length ? 'many' : 'none';
}

function roomNamed(snapshot: Snapshot, text: string | undefined): string | Intent {
  const wanted = text ?? snapshot.currentRoom ?? undefined;
  if (!wanted) return fail('Which room? For example: room on Office');
  const found = pick(snapshot.rooms, wanted, (room) => [room.name]);
  if (found === 'none') return fail(`No room named "${wanted}". Rooms: ${snapshot.rooms.map((room) => room.name).join(', ') || 'none yet'}`);
  if (found === 'many') return fail(`"${wanted}" matches more than one room. Type more of the name.`);
  return found.name;
}

const text = (value: string | true | undefined) => (typeof value === 'string' ? value : undefined);

/** What a typed line asks for, checked against what exists. Never throws. */
export function plan(line: string, snapshot: Snapshot): Intent {
  let tokens = tokenize(line.trim());
  if (tokens[0]?.toLowerCase() === 'myhuey') tokens = tokens.slice(1);
  if (!tokens.length) return fail('Type a command, or help');
  const { words, flags } = parseArgs(tokens);
  const [verb, action, ...rest] = words.map((word, index) => (index < 2 ? word.toLowerCase() : word));

  if (verb === 'help' || verb === '?') return { kind: 'help' };

  if (verb === 'room') {
    if (!action || action === 'list') return { kind: 'rooms' };
    if (!['on', 'off', 'dim', 'posture', 'glare'].includes(action)) {
      return fail(`Not in the browser prompt: room ${action}. Try: room on, off, dim, posture, glare, list`);
    }
    // `room dim Living room 30`: the last word is the value, the words before it the room.
    const flagValue = action === 'dim' ? text(flags.level) : action === 'posture' ? text(flags.posture) : undefined;
    const takesValue = action === 'dim' || action === 'posture';
    const value = takesValue ? flagValue ?? rest[rest.length - 1] : undefined;
    const nameWords = takesValue && flagValue === undefined ? rest.slice(0, -1) : rest;
    const room = roomNamed(snapshot, text(flags.name) ?? (nameWords.join(' ') || undefined));
    if (typeof room !== 'string') return room;
    if (action === 'on' || action === 'off') return { kind: 'power', room, on: action === 'on' };
    if (action === 'dim') {
      const level = Number(value);
      if (value === undefined || !Number.isFinite(level) || level < 1 || level > 100) return fail('Brightness is 1 to 100, for example: room dim Office 30');
      return { kind: 'dim', room, level: Math.round(level) };
    }
    if (action === 'posture') {
      const posture = (value ?? '').toLowerCase();
      if (posture !== 'seated' && posture !== 'standing') return fail('Posture is seated or standing, for example: room posture Office standing');
      return { kind: 'posture', room, posture };
    }
    const mode = (text(flags.mode) ?? 'code').toLowerCase();
    if (!DESK_MODES.includes(mode)) return fail(`The glare check is made from the desk: --mode is one of ${DESK_MODES.join(', ')}`);
    return { kind: 'glare', room, mode, fix: flags.fix === true };
  }

  if (verb === 'suggest') {
    const room = roomNamed(snapshot, text(flags.room) ?? action);
    if (typeof room !== 'string') return room;
    const mode = modeId((text(flags.mode) ?? 'code').toLowerCase());
    if (!MODES.includes(mode)) return fail(`--mode is one of ${MODES.map(modeName).join(', ')}`);
    return { kind: 'suggest', room, mode, apply: flags.apply === true };
  }

  if (verb === 'groups' || verb === 'group') {
    if (!action || action === 'list') return { kind: 'groups' };
    if (action !== 'apply') return fail(`Not in the browser prompt: groups ${action}. Try: groups list, groups apply <group>`);
    const wanted = rest.join(' ');
    if (!wanted) return fail('Which group? For example: groups apply "Desk"');
    const found = pick(snapshot.groups, wanted, (group) => [group.name, group.id]);
    if (found === 'none') return fail(`No group named "${wanted}". Groups: ${snapshot.groups.map((group) => group.name).join(', ') || 'none yet'}`);
    if (found === 'many') return fail(`"${wanted}" matches more than one group. Type more of the name.`);
    return { kind: 'group-apply', id: found.id, name: found.name };
  }

  if (verb === 'layouts' || verb === 'layout') {
    if (!action || action === 'list') return { kind: 'layouts' };
    if (action === 'new') return { kind: 'layout-new', name: text(flags.name) ?? (rest.join(' ') || null) };
    if (action !== 'open') return fail(`Not in the browser prompt: layouts ${action}. Try: layouts list, layouts open <layout>, layouts new`);
    const wanted = rest.join(' ');
    if (!wanted) return fail('Which layout? For example: layouts open active');
    const found = same(wanted, 'active') ? snapshot.layouts.find((layout) => layout.active) ?? 'none' : pick(snapshot.layouts, wanted, (layout) => [layout.name, layout.id]);
    if (found === 'none') return fail(`No layout named "${wanted}". Layouts: ${snapshot.layouts.map((layout) => layout.name).join(', ')}`);
    if (found === 'many') return fail(`"${wanted}" matches more than one layout. Type more of the name.`);
    return { kind: 'layout-open', id: found.active ? null : found.id, name: found.name };
  }

  if (verb === 'scene' || verb === 'scenes') {
    if (!action || action === 'list') return { kind: 'scenes', room: text(flags.room) ?? null };
    if (action !== 'apply') return fail(`Not in the browser prompt: scene ${action}. Try: scene list, scene apply <scene>`);
    const wanted = text(flags.scene) ?? rest.join(' ');
    if (!wanted) return fail('Which scene? For example: scene apply "Late night"');
    const found = pick(snapshot.scenes, wanted, (scene) => [scene.name, scene.id]);
    if (found === 'none') return fail(`No scene named "${wanted}"`);
    if (found === 'many') return fail(`"${wanted}" matches more than one scene. Use its ID from: scene list`);
    return { kind: 'scene-apply', id: found.id, name: found.name };
  }

  if (verb === 'open' || verb === 'go') {
    const screens: Record<string, Route> = {
      home: { view: 'home' }, studio: { view: 'studio' }, scenes: { view: 'scenes' }, lights: { view: 'lights' }, settings: { view: 'settings' }, setup: { view: 'setup' },
    };
    if (action === 'help') {
      const wanted = rest.join(' ');
      if (!wanted) return { kind: 'open', route: { view: 'help' }, label: 'help' };
      const found = pick(TOPICS, wanted, (item) => [item.id, item.title]);
      if (found === 'none' || found === 'many') return fail(`Help topics: ${TOPICS.map((item) => item.id).join(', ')}`);
      return { kind: 'open', route: { view: 'help', topic: found.id }, label: `help · ${found.title}` };
    }
    if (action && screens[action]) return { kind: 'open', route: screens[action], label: action };
    if (action === 'workbench' || action === 'plan' || action === '3d' || action === 'photo') {
      const typed = rest.join(' ') || undefined;
      // The Studio views with no room named use the Studio's rule: the remembered room, else the first.
      const unnamed = typed === undefined && action !== 'workbench';
      const defaulted = unnamed ? studioRoom(snapshot.rooms, snapshot.remembered !== undefined ? snapshot.remembered : snapshot.currentRoom) : null;
      if (unnamed && !defaulted) return fail('There are no rooms yet. Add one in the Studio first: open studio');
      const room = defaulted ?? roomNamed(snapshot, typed);
      if (typeof room !== 'string') return room;
      const route: Route = action === 'workbench' ? { view: 'room', room } : { view: 'design', room, tab: action };
      return { kind: 'open', route, label: `${action} · ${room}` };
    }
    return fail('Open what? home, studio, scenes, lights, settings, setup, help, or workbench, plan, 3d, photo with a room');
  }

  if (verb === 'tabs' || verb === 'tab') {
    if (action === 'reset') return { kind: 'tabs-reset' };
    if (action === 'collapse') return { kind: 'tabs-rail', collapsed: true };
    if (action === 'expand') return { kind: 'tabs-rail', collapsed: false };
    if (action === 'width') {
      const wanted = rest.join(' ').trim();
      if (!/^\d+(\.\d+)?$/.test(wanted)) return fail(`The rail's width is a number of pixels from ${RAIL_MIN} to ${RAIL_MAX}, for example: tabs width 260`);
      return { kind: 'tabs-rail', width: clampRail(Number(wanted)) };
    }
    const place = TAB_PLACEMENTS.find((item) => item === action);
    if (place) return { kind: 'tabs-place', placement: place };
    return fail(`Try: tabs ${TAB_PLACEMENTS.join(', tabs ')}, tabs collapse, tabs expand, tabs width <px>, or tabs reset. Drag a tab to move it; × closes it; + brings closed tabs back.`);
  }

  if (verb === 'theme') {
    const wanted = [action, ...rest].filter(Boolean).join(' ');
    if (same(wanted, 'system')) return { kind: 'theme', theme: 'system' };
    // An id wins outright, then a whole name (MyHuey's own Monokai before VS Code's), then the start of one.
    const starts = THEMES.filter((theme) => theme.label.toLowerCase().startsWith(wanted.toLowerCase()));
    const found = THEMES.find((theme) => same(theme.id, wanted)) ?? THEMES.find((theme) => same(theme.label, wanted)) // MyHuey's own come first
      ?? (starts.length === 1 ? starts[0] : starts.length ? 'many' : 'none');
    if (found === 'many') return fail(`"${wanted}" matches more than one theme. Use its id: ${THEMES.filter((theme) => theme.label.toLowerCase().startsWith(wanted.toLowerCase()) || same(theme.label, wanted)).map((theme) => theme.id).join(', ')}`);
    if (found === 'none' || !wanted) return fail(`No theme named "${wanted}". Pick one from the theme menu in the top bar, or type: theme system`);
    return { kind: 'theme', theme: found.id };
  }

  return fail(`"${tokens.join(' ')}" is not available in the browser prompt. Type help, or run it in a terminal.`);
}

/** A name as it must be typed: quoted when it has a space. */
export const quote = (name: string) => (/\s/.test(name) ? `"${name}"` : name);

const TAB_PLACE_DETAIL: Record<TabPlacement, string> = {
  top: 'The tabs in the top bar', bottom: 'The tabs in a strip above the prompt',
  left: 'The tabs in a rail on the left', right: 'The tabs in a rail on the right',
};

export interface Shortcut { title: string; detail: string; command: string; group: string }

/** Ready-made commands for what exists right now: the palette's list and the Workflows drawer. */
export function shortcuts(snapshot: Snapshot): Shortcut[] {
  const list: Shortcut[] = [];
  const room = snapshot.currentRoom && snapshot.rooms.some((r) => r.name === snapshot.currentRoom) ? snapshot.currentRoom : snapshot.rooms[0]?.name;
  if (room) {
    const r = quote(room);
    // TODO(human): these five are a starting set. Make them your day: reorder them, change the
    // modes and the dim level, or add your own (any command the prompt understands works here).
    list.push(
      { group: 'Workflows', title: `Code in ${room}`, detail: 'Sends the first eye-comfort suggestion for coding right now', command: `suggest --room ${r} --mode code --apply` },
      { group: 'Workflows', title: `Fix glare in ${room}`, detail: 'Dims the lit lights that reflect in a screen or sit in your view', command: `room glare ${r} --fix` },
      { group: 'Workflows', title: `Stand up in ${room}`, detail: 'Previews standing in the 3D view and re-checks the glare', command: `room posture ${r} standing` },
      { group: 'Workflows', title: `Wind down ${room}`, detail: 'Sends the first relax suggestion for this time of day', command: `suggest --room ${r} --mode relax --apply` },
      { group: 'Workflows', title: `Dim ${room} to 25%`, detail: 'Lights that are off stay off', command: `room dim ${r} 25` },
    );
  }
  // Designing: the things you set up once, found by what you want to do ("design a room").
  for (const item of snapshot.rooms) {
    const r = quote(item.name);
    list.push(
      { group: 'Design', title: `Design a room: ${item.name}`, detail: 'Outline, furniture, doors and windows, and where the lights sit', command: `open plan ${r}` },
      { group: 'Design', title: `Place lights in ${item.name}`, detail: 'Drag each light to where it really is', command: `open plan ${r}` },
      { group: 'Design', title: `Photo of ${item.name}`, detail: 'Pin lights on a photo and preview scenes on it', command: `open photo ${r}` },
    );
  }
  list.push({ group: 'Design', title: 'Studio: whole home', detail: 'The floor plan, with every room', command: 'open studio' });
  if (room) list.push({ group: 'Design', title: `3D view of ${room}`, detail: 'The room in 3D, with the glare check', command: `open 3d ${quote(room)}` });
  list.push(
    { group: 'Design', title: 'Add a room or reshape one', detail: 'Draw rooms on the floor plan, or import them from the Hue app', command: 'open studio' },
    { group: 'Design', title: 'Design a scene', detail: 'Paint colors onto a room, or lay an image over it', command: 'open scenes' },
    { group: 'Design', title: 'Try a design in a sandbox', detail: 'Copies the open layout so you can change it freely', command: 'layouts new' },
    { group: 'Design', title: 'Group lights and save their look', detail: 'Pick lights, save them as a group', command: 'open lights' },
    { group: 'Design', title: 'Pair a bridge', detail: 'The setup guide', command: 'open setup' },
  );
  if (room) {
    const r = quote(room);
    list.push(
      { group: 'Glare', title: `Check glare in ${room}`, detail: 'Which lights reflect in a screen or sit in your view', command: `room glare ${r}` },
      { group: 'Glare', title: `Sit down in ${room}`, detail: 'Back to the seated view', command: `room posture ${r} seated` },
    );
    for (const mode of MODES.map(modeName)) list.push({ group: 'Suggest', title: `Suggest for ${mode} in ${room}`, detail: 'Shows the suggestions without sending them', command: `suggest --room ${r} --mode ${mode}` });
  }
  for (const group of snapshot.groups) list.push({ group: 'Groups', title: `Apply ${group.name}`, detail: 'Puts the group back to its saved look', command: `groups apply ${quote(group.name)}` });
  for (const item of snapshot.rooms) {
    const r = quote(item.name);
    list.push(
      { group: 'Rooms', title: `${item.name}: workbench`, detail: 'Lights, scenes, and suggestions', command: `open workbench ${r}` },
      { group: 'Rooms', title: `${item.name}: 3D and glare`, detail: 'The room in 3D, with the glare check', command: `open 3d ${r}` },
      { group: 'Rooms', title: `${item.name}: all on`, detail: '', command: `room on ${r}` },
      { group: 'Rooms', title: `${item.name}: all off`, detail: '', command: `room off ${r}` },
    );
  }
  for (const scene of snapshot.scenes) list.push({ group: 'Scenes', title: `Apply ${scene.name}`, detail: scene.room, command: `scene apply ${quote(scene.id)}` });
  for (const screen of ['home', 'studio', 'scenes', 'lights', 'settings']) list.push({ group: 'Screens', title: `Open ${screen}`, detail: '', command: `open ${screen}` });
  for (const layout of snapshot.layouts) list.push({ group: 'Layouts', title: layout.active ? `Back to ${layout.name} (active)` : `Open sandbox ${layout.name}`, detail: '', command: `layouts open ${layout.active ? 'active' : quote(layout.name)}` });
  for (const item of TOPICS) list.push({ group: 'Help', title: `Help: ${item.title}`, detail: item.summary, command: `open help ${item.id}` });
  list.push(
    ...TAB_PLACEMENTS.map((place): Shortcut => ({ group: 'Window', title: `Tabs: ${place}`, detail: TAB_PLACE_DETAIL[place], command: `tabs ${place}` })),
    { group: 'Window', title: 'Collapse the tab rail', detail: 'Icons only, when the tabs are on the left or right', command: 'tabs collapse' },
    { group: 'Window', title: 'Expand the tab rail', detail: 'Labels again, at the width it had', command: 'tabs expand' },
    { group: 'Window', title: 'Reset the tabs', detail: 'Every tab back, in the original order', command: 'tabs reset' },
    { group: 'Window', title: 'What can I type? (commands)', detail: 'Everything the prompt understands', command: 'help' },
  );
  for (const theme of THEMES) list.push({ group: 'Themes', title: `Theme: ${theme.label}`, detail: `${theme.kind} · ${theme.source}`, command: `theme ${theme.id}` });
  return list;
}

/**
 * How well a shortcut matches what was typed in the palette: 0 = not at all, higher = better.
 * Every typed word must appear somewhere in the title, the command, or the group.
 */
export function matchScore(shortcut: Shortcut, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const title = shortcut.title.toLowerCase();
  const rest = `${shortcut.command} ${shortcut.group}`.toLowerCase();
  let score = 0;
  const parts = title.split(/[\s:·]+/);
  for (const word of words) {
    if (parts.includes(word)) score += 6; // a whole word: "off" means "all off", not "Office"
    else if (title.startsWith(word)) score += 4;
    else if (parts.some((part) => part.startsWith(word))) score += 3;
    else if (title.includes(word)) score += 2;
    else if (rest.includes(word)) score += 1;
    else return 0;
  }
  return score;
}

export const search = (list: Shortcut[], query: string, limit = 40): Shortcut[] =>
  list.map((item, index) => ({ item, index, score: matchScore(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
