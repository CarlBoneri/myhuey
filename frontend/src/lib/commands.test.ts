import { describe, expect, it } from 'vitest';
import { matchScore, parseArgs, plan, quote, search, shortcuts, tokenize, type Snapshot } from './commands';

const snapshot: Snapshot = {
  rooms: [{ name: 'Office' }, { name: 'Living room' }, { name: 'Loft' }],
  scenes: [{ id: 's1', name: 'Late night', room: 'Office' }, { id: 's2', name: 'Dusk', room: 'Loft' }, { id: 's3', name: 'Dusk', room: 'Office' }],
  groups: [{ id: 'g1', name: 'Desk Halo' }, { id: 'g2', name: 'Key lights' }],
  layouts: [{ id: 'a', name: 'My home', active: true }, { id: 'b', name: 'Late-night rig', active: false }],
  currentRoom: 'Office',
};
const run = (line: string, from: Snapshot = snapshot) => plan(line, from);
const message = (line: string) => { const intent = run(line); return intent.kind === 'error' ? intent.message : `not an error: ${intent.kind}`; };

describe('reading a line', () => {
  it('keeps quoted phrases together', () => {
    expect(tokenize('groups apply "Desk Halo"  --x \'a b\'')).toEqual(['groups', 'apply', 'Desk Halo', '--x', 'a b']);
  });
  it('separates words from flags, with and without values', () => {
    expect(parseArgs(['room', 'glare', 'Office', '--fix', '--mode', 'work', '--level=30'])).toEqual({
      words: ['room', 'glare', 'Office'], flags: { fix: true, mode: 'work', level: '30' },
    });
    expect(parseArgs(['--fix', 'Office']).words).toEqual(['Office']); // --fix never swallows the next word
  });
});

describe('room commands', () => {
  it('takes the real CLI form and the short form, with or without the myhuey prefix', () => {
    const want = { kind: 'dim', room: 'Office', level: 30 };
    expect(run('myhuey room dim --name Office --level 30')).toEqual(want);
    expect(run('room dim Office 30')).toEqual(want);
    expect(run('ROOM DIM office 30')).toEqual(want);
    expect(run('room dim 30')).toEqual(want); // no room: the one you are in
  });
  it('reads room names of several words, quoted or not, and by their start', () => {
    expect(run('room off Living room')).toEqual({ kind: 'power', room: 'Living room', on: false });
    expect(run('room dim "Living room" 55')).toEqual({ kind: 'dim', room: 'Living room', level: 55 });
    expect(run('room on liv')).toEqual({ kind: 'power', room: 'Living room', on: true });
    expect(message('room on L')).toMatch(/more than one room/);
    expect(message('room on Garage')).toMatch(/No room named "Garage"\. Rooms: Office, Living room, Loft/);
  });
  it('refuses brightness outside 1 to 100, and words that are not numbers', () => {
    for (const line of ['room dim Office 0', 'room dim Office 101', 'room dim Office lots', 'room dim Office']) expect(message(line)).toMatch(/1 to 100/);
  });
  it('reads posture and glare', () => {
    expect(run('myhuey room posture Office standing')).toEqual({ kind: 'posture', room: 'Office', posture: 'standing' });
    expect(run('room posture seated')).toEqual({ kind: 'posture', room: 'Office', posture: 'seated' });
    expect(message('room posture Office prone')).toMatch(/seated or standing/);
    expect(run('myhuey room glare Office --fix')).toEqual({ kind: 'glare', room: 'Office', mode: 'code', fix: true });
    expect(run('room glare --mode study')).toEqual({ kind: 'glare', room: 'Office', mode: 'study', fix: false });
    expect(message('room glare Office --mode relax')).toMatch(/from the desk/);
  });
  it('says so when there is no room to fall back on', () => {
    expect(run('room on', { ...snapshot, currentRoom: null })).toMatchObject({ kind: 'error' });
    expect(run('room list')).toEqual({ kind: 'rooms' });
  });
});

describe('other commands', () => {
  it('reads suggest as the CLI does', () => {
    expect(run('myhuey suggest --room Office --mode code')).toEqual({ kind: 'suggest', room: 'Office', mode: 'code', apply: false });
    expect(run('suggest --room "Living room" --mode relax --apply')).toEqual({ kind: 'suggest', room: 'Living room', mode: 'relax', apply: true });
    expect(message('suggest --room Office --mode dance')).toMatch(/code, work, study, read, relax/);
  });
  it('finds groups, scenes, and layouts by name, start of name, or ID', () => {
    expect(run('myhuey groups apply "Desk Halo"')).toEqual({ kind: 'group-apply', id: 'g1', name: 'Desk Halo' });
    expect(run('groups apply desk')).toEqual({ kind: 'group-apply', id: 'g1', name: 'Desk Halo' });
    expect(run('scene apply late night')).toEqual({ kind: 'scene-apply', id: 's1', name: 'Late night' });
    expect(run('scene apply --scene s2')).toEqual({ kind: 'scene-apply', id: 's2', name: 'Dusk' });
    expect(message('scene apply Dusk')).toMatch(/more than one scene/); // two rooms have a Dusk
    expect(run('layouts open late')).toEqual({ kind: 'layout-open', id: 'b', name: 'Late-night rig' });
    expect(run('layouts open active')).toEqual({ kind: 'layout-open', id: null, name: 'My home' });
    expect(run('myhuey layouts list')).toEqual({ kind: 'layouts' });
  });
  it('opens screens and rooms', () => {
    expect(run('open scenes')).toEqual({ kind: 'open', route: { view: 'scenes' }, label: 'scenes' });
    expect(run('open 3d')).toEqual({ kind: 'open', route: { view: 'design', room: 'Office', tab: '3d' }, label: '3d · Office' });
    expect(run('open workbench Living room')).toMatchObject({ route: { view: 'room', room: 'Living room' } });
  });
  it('switches themes', () => {
    expect(run('theme dracula')).toEqual({ kind: 'theme', theme: 'dracula' });
    expect(run('theme Solarized Light')).toEqual({ kind: 'theme', theme: 'solarized-light' });
    expect(run('theme system')).toEqual({ kind: 'theme', theme: 'system' });
    expect(message('theme warp')).toMatch(/No theme named "warp"/);
    expect(run('theme monokai')).toEqual({ kind: 'theme', theme: 'monokai' }); // the id wins over VS Code's Monokai
    expect(run('theme vscode-dark-modern')).toEqual({ kind: 'theme', theme: 'vscode-dark-modern' });
    expect(run('theme Tokyo Night')).toEqual({ kind: 'theme', theme: 'starship-tokyo-night' });
    expect(run('theme Monokai Pro')).toEqual({ kind: 'theme', theme: 'vscode-monokai-pro' }); // a whole name, though others start with it
    expect(message('theme one dark')).toMatch(/more than one theme\. Use its id: vscode-one-dark-pro/);
  });
  it('never pretends to run what it cannot', () => {
    expect(message('myhuey serve --port 8000')).toMatch(/not available in the browser prompt/);
    expect(message('rm -rf ~')).toMatch(/not available in the browser prompt/);
    expect(message('room delete Office')).toMatch(/Not in the browser prompt: room delete/);
    expect(message('layouts delete late')).toMatch(/Not in the browser prompt/);
    expect(message('   ')).toMatch(/Type a command/);
    expect(run('help')).toEqual({ kind: 'help' });
  });
});

describe('shortcuts', () => {
  const list = shortcuts(snapshot);
  it('every ready-made command is one the prompt understands', () => {
    for (const item of list) expect(run(item.command), item.command).not.toMatchObject({ kind: 'error' });
    expect(list.find((item) => item.title === 'Apply Dusk')!.command).toBe('scene apply s2'); // by ID: two scenes share the name
    expect(quote('Living room')).toBe('"Living room"');
  });
  it('builds workflows for the room you are in, or the first room', () => {
    expect(list[0]).toMatchObject({ group: 'Workflows', command: 'suggest --room Office --mode code --apply' });
    expect(shortcuts({ ...snapshot, currentRoom: 'Gone' })[0].command).toContain('--room Office');
    expect(shortcuts({ ...snapshot, rooms: [], scenes: [], groups: [], currentRoom: null }).some((item) => item.group === 'Workflows')).toBe(false);
  });
  it('searches by every typed word, best match first', () => {
    expect(search(list, 'living off')[0].command).toBe('room off "Living room"');
    expect(search(list, 'office off')[0].command).toBe('room off Office'); // "off" is a whole word there, only the start of "Office"
    expect(search(list, 'dracula')[0].command).toBe('theme dracula');
    expect(search(list, 'glare')[0].title).toBe('Fix glare in Office');
    expect(search(list, 'zzz')).toEqual([]);
    expect(search(list, '').length).toBe(Math.min(40, list.length));
    expect(matchScore(list[0], 'code')).toBeGreaterThan(matchScore(list[0], 'suggest'));
  });
});
