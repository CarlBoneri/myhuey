// Runs a prompt line: plans it (commands.ts), then does it through the same API calls the
// screens use. Every run is logged with what really happened and how long it took.
import { api } from '../api';
import { sendLight, useStore } from '../store';
import { useUi, type Entry } from '../uiStore';
import { HELP, plan, type Intent, type Snapshot } from './commands';
import { STATUS_LABELS, summary } from './glareMath';
import { go } from './router';
import { lightsToDim, roomGlare } from './roomGlare';
import { STANDING_DESK_CM } from './rig';
import { EYE_SEATED, EYE_STANDING } from './photo';
import { THEMES } from './theme';
import { DEFAULT_TABS } from './tabs';
import { formatLength } from './units';

export function snapshot(): Snapshot {
  const { rooms, scenes, groups, layouts } = useStore.getState();
  const current = useUi.getState().currentRoom;
  return {
    rooms, scenes, groups, layouts,
    currentRoom: current && rooms.some((room) => room.name === current) ? current : rooms.find((room) => room.name === 'Office')?.name ?? rooms[0]?.name ?? null,
  };
}

interface Outcome { output: string; ok: boolean }
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const sent = (what: string, results: { ok?: boolean; error?: string; applied?: boolean }[]): Outcome => {
  const failed = results.filter((item) => item.ok === false || item.error).length;
  const reached = results.length - failed;
  if (!results.length) return { output: `${what}: no lights to change`, ok: true };
  return { output: `${what}: ${plural(reached, 'light')} answered${failed ? `, ${failed} failed` : ''}`, ok: failed === 0 };
};

async function execute(intent: Intent): Promise<Outcome> {
  const store = useStore.getState();
  const ui = useUi.getState();
  switch (intent.kind) {
    case 'error':
      return { output: intent.message, ok: false };
    case 'help':
      return { output: HELP.map(([usage, what]) => `${usage}  —  ${what}`).join('\n'), ok: true };
    case 'rooms':
      return { output: store.rooms.map((room) => `${room.name} (${plural(room.lights.length, 'light')})`).join(' · ') || 'No rooms yet', ok: true };
    case 'power': {
      const { results } = await api.roomPower(intent.room, intent.on);
      void store.refreshLights();
      return sent(`${intent.room} ${intent.on ? 'on' : 'off'}`, results);
    }
    case 'dim': {
      const { results } = await api.roomBrightness(intent.room, intent.level);
      void store.refreshLights();
      return sent(`${intent.room} at ${intent.level}%`, results);
    }
    case 'posture': {
      ui.setPosture(intent.posture);
      go({ view: 'design', room: intent.room, tab: '3d' });
      const room = store.rooms.find((item) => item.name === intent.room)!;
      const eyes = formatLength(intent.posture === 'standing' ? EYE_STANDING : EYE_SEATED, room.units);
      const { report } = roomGlare(room, intent.posture, ui.glareMode, store.lights, store.profiles);
      return {
        output: `${intent.room}: ${intent.posture}, eyes at ${eyes}${intent.posture === 'standing' ? `, sit-stand desks at ${formatLength(STANDING_DESK_CM, room.units)}` : ''} (a preview, not saved) · ${summary(report)}`,
        ok: true,
      };
    }
    case 'glare': {
      const room = store.rooms.find((item) => item.name === intent.room)!;
      const { scene, report } = roomGlare(room, ui.posture, intent.mode, store.lights, store.profiles);
      if (!scene.eye) return { output: `${intent.room}: no desk or screen to check from. Add one in the Studio.`, ok: false };
      const flagged = report.lights.filter((light) => light.cap);
      const names = flagged.map((light) => `${store.lights[light.light_id]?.name ?? light.label} (${STATUS_LABELS[light.status].toLowerCase()})`).join(', ');
      if (!intent.fix) return { output: `${intent.room}, ${ui.posture}: ${summary(report)}${names ? ` · ${names}` : ''}`, ok: true };
      const todo = lightsToDim(room, report, store.lights);
      for (const item of todo) sendLight(item.id, { brightness: item.level }, { brightness: item.level });
      return {
        output: todo.length
          ? `${intent.room}: dimmed ${todo.map((item) => `${item.label} to ${Math.round(item.level / 2.54)}%`).join(', ')}`
          : `${intent.room}: ${flagged.length ? 'no lit light is over its limit' : 'no glare found'}, nothing sent`,
        ok: true,
      };
    }
    case 'suggest': {
      const items = await api.suggest(intent.room, { mode: intent.mode, count: 3 });
      if (!items.length) return { output: `No suggestions for ${intent.room}`, ok: false };
      if (!intent.apply) return { output: items.map((item, index) => `${index + 1}. ${item.scene.name} (${item.kelvin} K)`).join(' · '), ok: true };
      const { results } = await api.applySuggestion(intent.room, items[0].scene);
      void store.refreshLights();
      return sent(`${items[0].scene.name} in ${intent.room}`, results.filter((item) => !item.keep));
    }
    case 'groups':
      return { output: store.groups.map((group) => `${group.name} (${plural(group.lights.length, 'light')}${group.look ? ', look saved' : ''})`).join(' · ') || 'No groups yet', ok: true };
    case 'group-apply': {
      const { results } = await api.applyGroup(intent.id);
      void store.refreshLights();
      return sent(intent.name, results);
    }
    case 'layouts':
      return { output: store.layouts.map((layout) => `${layout.active ? '* ' : ''}${layout.name} (${plural(layout.rooms, 'room')}, ${plural(layout.scenes, 'scene')})${layout.id === store.layout ? ' ← open' : ''}`).join(' · '), ok: true };
    case 'layout-open':
      await store.openLayout(intent.id);
      return { output: intent.id ? `Opened the sandbox ${intent.name}` : `Back to ${intent.name}, the active layout`, ok: true };
    case 'layout-new': {
      const made = await api.createLayout(intent.name ?? undefined, store.layout ?? store.layouts.find((layout) => layout.active)?.id);
      await store.openLayout(made.id);
      return { output: `Made the sandbox ${made.name} and opened it. Your active layout is untouched.`, ok: true };
    }
    case 'tabs-reset':
      ui.setTabs(DEFAULT_TABS);
      return { output: 'Every tab is back, in the original order', ok: true };
    case 'tabs-place':
      ui.setTabPlacement(intent.placement);
      return { output: `Tabs: ${intent.placement}`, ok: true };
    case 'scenes': {
      const list = store.scenes.filter((scene) => !intent.room || scene.room.toLowerCase() === intent.room.toLowerCase());
      return { output: list.map((scene) => `${scene.name} [${scene.room}] ${scene.id}`).join(' · ') || 'No scenes yet', ok: true };
    }
    case 'scene-apply': {
      const { results } = await api.applyScene(intent.id);
      void store.refreshLights();
      return sent(intent.name, results.filter((item) => !item.keep));
    }
    case 'open':
      go(intent.route);
      return { output: `Opened ${intent.label}`, ok: true };
    case 'theme':
      await store.setPreferences({ theme: intent.theme });
      return { output: `Theme: ${intent.theme === 'system' ? 'follows the system' : THEMES.find((theme) => theme.id === intent.theme)!.label}`, ok: true };
  }
}

/** Run one line from the prompt, the palette, or a workflow. Never throws; the result is in the history. */
export async function runCommand(line: string): Promise<Entry> {
  const ui = useUi.getState();
  const command = line.trim();
  const started = performance.now();
  ui.setBusy(true);
  let outcome: Outcome;
  try {
    outcome = await execute(plan(command, snapshot()));
  } catch (error) {
    outcome = { output: (error as Error).message || 'That did not work', ok: false };
  }
  useUi.getState().setBusy(false);
  return useUi.getState().log({ command, ...outcome, ms: Math.round(performance.now() - started) });
}
