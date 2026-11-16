import { describe, expect, it } from 'vitest';
import { plan, shortcuts, search, type Snapshot } from './commands';
import { MCP_CONFIG, TOPICS, searchHelp, topic, topicFor } from './helpDocs';
import { parseRoute, href } from './router';

// The rooms, scene, and group the help pages use in their examples.
const snapshot: Snapshot = {
  rooms: [{ name: 'Office' }], scenes: [{ id: 's1', name: 'office_night', room: 'Office' }], groups: [{ id: 'g1', name: 'Desk' }],
  layouts: [{ id: 'a', name: 'My home', active: true }], currentRoom: 'Office',
};

describe('the help pages', () => {
  it('have unique ids, a title, a summary, and something to read', () => {
    expect(new Set(TOPICS.map((item) => item.id)).size).toBe(TOPICS.length);
    for (const item of TOPICS) {
      expect(item.title && item.summary, item.id).toBeTruthy();
      expect(item.blocks.length, item.id).toBeGreaterThan(0);
    }
  });
  it('only show commands the prompt really understands', () => {
    const shown = TOPICS.flatMap((item) => item.blocks.flatMap((block) => ('try' in block ? block.try : [])));
    expect(shown.length).toBeGreaterThan(15);
    for (const command of shown) expect(plan(command, snapshot), command).not.toMatchObject({ kind: 'error' });
  });
  it('link only to screens that exist', () => {
    for (const item of TOPICS) for (const block of item.blocks) if ('links' in block) for (const link of block.links) expect(parseRoute(href(link.route))).toEqual(link.route);
  });
  it('can be found by what they say', () => {
    expect(searchHelp('glare')[0].id).toBe('glare');
    expect(searchHelp('sandbox')[0].id).toBe('layouts');
    expect(searchHelp('close tab')[0].id).toBe('window');
    expect(searchHelp('fold panel')[0].id).toBe('window');
    expect(searchHelp('zzzz')).toEqual([]);
    expect(searchHelp('  ')).toHaveLength(TOPICS.length);
  });
  it('open on the page for the screen you are on, and fall back to the first page', () => {
    expect(topicFor({ view: 'design', room: 'Office', tab: '3d' })).toBe('glare');
    expect(topicFor({ view: 'design', room: 'Office', tab: 'plan' })).toBe('design');
    for (const view of ['home', 'studio', 'scenes', 'lights', 'settings', 'setup'] as const) expect(TOPICS.some((item) => item.id === topicFor({ view }))).toBe(true);
    expect(topic('nope').id).toBe('start');
    expect(parseRoute('#/help/glare')).toEqual({ view: 'help', topic: 'glare' });
    expect(parseRoute('#/help')).toEqual({ view: 'help' });
  });
});

describe('finding help and design from the palette', () => {
  const list = shortcuts(snapshot);
  it('offers every help page and the design steps', () => {
    for (const item of TOPICS) expect(plan(`open help ${item.id}`, snapshot)).toEqual({ kind: 'open', route: { view: 'help', topic: item.id }, label: `help · ${item.title}` });
    expect(search(list, 'design a room')[0]).toMatchObject({ title: 'Design a room: Office', command: 'open plan Office' });
    expect(search(list, 'place lights')[0].command).toBe('open plan Office');
    expect(search(list, 'sandbox')[0].command).toBe('layouts new');
    expect(search(list, 'help glare')[0].command).toBe('open help glare');
    expect(search(list, 'pair')[0].command).toBe('open setup');
    expect(search(list, 'reset tabs')[0].command).toBe('tabs reset');
  });
  it('reads the new commands', () => {
    expect(plan('layouts new', snapshot)).toEqual({ kind: 'layout-new', name: null });
    expect(plan('layouts new Evening rig', snapshot)).toEqual({ kind: 'layout-new', name: 'Evening rig' });
    expect(plan('open help', snapshot)).toMatchObject({ route: { view: 'help' } });
    expect(plan('open help nope', snapshot)).toMatchObject({ kind: 'error' });
    expect(plan('tabs reset', snapshot)).toEqual({ kind: 'tabs-reset' });
    expect(plan('open setup', snapshot)).toMatchObject({ route: { view: 'setup' } });
  });
});

describe('the assistant help page', () => {
  it('exists and is found by mcp and assistant', () => {
    expect(TOPICS.some((item) => item.id === 'assistant')).toBe(true);
    expect(searchHelp('mcp')[0].id).toBe('assistant');
    expect(searchHelp('assistant')[0].id).toBe('assistant');
  });
  it('shows a config that starts the tool server', () => {
    expect(JSON.parse(MCP_CONFIG).mcpServers.myhuey.args).toEqual(['run', 'myhuey', 'mcp']);
  });
});
