'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';
const POLL_MS = 5000;
const GRID = 10;
const BULB_RADIUS = 26;
const HOME_MIN_VIEW = { width: 2940, height: 1380 };
const DEFAULT_LIGHT_COLOR = '#ffd89a';

const state = {
  bridge: { configured: false, ip: '' },
  pairingWindow: 30,
  rooms: [],
  lights: new Map(),
  lightsError: '',
  selected: null,
  dragging: false,
  sending: 0,
  setup: { open: false, finding: false, found: null, error: '', pairing: null },
};

let liveUpdates = [];
let reloadTurn = 0;
let toastTimer = 0;
const pendingChanges = new Map();

// DOM helpers. Text always goes in through textContent, never as markup.

function build(namespace, tag, attrs, children) {
  const node = namespace ? document.createElementNS(namespace, tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'text') node.textContent = value;
    else if (!namespace && key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

const h = (tag, attrs, ...children) => build(null, tag, attrs, children);
const s = (tag, attrs, ...children) => build(SVG_NS, tag, attrs, children);

// Register a node whose content follows live light state. It is refreshed without a rebuild.
function live(node, update) {
  liveUpdates.push(() => update(node));
  update(node);
  return node;
}

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
const snap = (value) => Math.round(value / GRID) * GRID;
const shorten = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const roomPath = (name) => `/api/rooms/${encodeURIComponent(name)}`;

function toast(message, isError = true) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.toggle('notice', !isError);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 6000);
}

// Server access

async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error('The MyHuey server is not responding.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && data.detail;
    if (typeof detail === 'string') throw new Error(detail);
    if (Array.isArray(detail)) throw new Error(detail.map((item) => item.msg).join('; '));
    throw new Error(`The request failed (HTTP ${response.status}).`);
  }
  return data;
}

async function load() {
  const status = await api('/api/setup/status');
  const data = {
    bridge: { configured: status.configured, ip: status.bridge.ip || '' },
    pairingWindow: status.pairing_window,
    rooms: await api('/api/rooms'),
    lights: new Map(),
    lightsError: '',
  };
  if (status.configured) {
    try {
      data.lights = new Map((await api('/api/lights')).map((light) => [light.id, light]));
    } catch (error) {
      data.lightsError = error.message;
    }
  }
  return data;
}

// Everything that decides which controls exist. Light on/off, brightness, and color are left out.
function structure() {
  const lights = [...state.lights.values()].map((light) => [
    light.id, light.name, light.supports_color, light.supports_color_temp, light.brightness === null,
  ]);
  return JSON.stringify([state.bridge, state.lightsError, state.rooms, lights]);
}

async function reload(full = false) {
  const turn = ++reloadTurn;
  let data;
  try {
    data = await load();
  } catch (error) {
    setStatus(error.message, true);
    return;
  }
  if (turn !== reloadTurn || state.dragging || state.sending) return;

  const before = structure();
  Object.assign(state, data);
  if (full || structure() !== before) render();
  else renderLive();
}

async function act(work) {
  try {
    await work();
  } catch (error) {
    toast(error.message);
  }
  await reload(true);
}

// Light changes. One request per light at a time; values picked meanwhile are merged into the next one.

function setLight(id, changes) {
  const light = state.lights.get(id);
  if (!light) return;
  Object.assign(light, changes);
  renderLive();

  const waiting = pendingChanges.get(id);
  if (waiting) {
    Object.assign(waiting, changes);
    return;
  }
  pendingChanges.set(id, { ...changes });
  sendChanges(id);
}

async function sendChanges(id) {
  state.sending += 1;
  try {
    while (Object.keys(pendingChanges.get(id)).length) {
      const changes = pendingChanges.get(id);
      pendingChanges.set(id, {});
      await api(`/api/lights/${encodeURIComponent(id)}/state`, { method: 'PUT', body: changes });
    }
  } catch (error) {
    toast(error.message);
  } finally {
    pendingChanges.delete(id);
    state.sending -= 1;
  }
  if (!state.sending) await reload();
}

// Descriptions

function describe(light) {
  if (!light) return state.bridge.configured ? 'Not on the bridge' : 'No bridge paired';
  if (!light.reachable) return 'Unreachable';
  if (!light.on) return 'Off';
  return light.brightness === null ? 'On' : `On, ${Math.round((light.brightness / 254) * 100)}% brightness`;
}

function roomCount(room) {
  if (!room || !room.lights.length) return 'No lights';
  const lit = room.lights.filter((placed) => {
    const light = state.lights.get(placed.light_id);
    return light && light.on && light.reachable;
  }).length;
  return `${lit} of ${room.lights.length} on`;
}

const findRoom = (name) => state.rooms.find((room) => room.name === name);

function currentRoom() {
  const match = location.hash.match(/^#\/room\/(.+)$/);
  if (!match) return null;
  try {
    return findRoom(decodeURIComponent(match[1])) || null;
  } catch {
    return null;
  }
}

function openRoom(name) {
  location.hash = `#/room/${encodeURIComponent(name)}`;
}

function select(lightId) {
  if (state.selected === lightId) return;
  state.selected = lightId;
  render();
}

// Floor plans

function planPoint(svg, event) {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
}

// Pointer dragging in plan units. A press that does not move counts as a click.
function drag(svg, target, { start, move, drop, click }) {
  target.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    const origin = planPoint(svg, down);
    let moved = false;
    target.setPointerCapture(down.pointerId);
    start();

    const onMove = (event) => {
      if (!moved && Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < 4) return;
      moved = true;
      state.dragging = true;
      const point = planPoint(svg, event);
      move(point.x - origin.x, point.y - origin.y);
    };
    const onEnd = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onEnd);
      target.removeEventListener('pointercancel', onEnd);
      state.dragging = false;
      if (moved) drop();
      else click();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onEnd);
    target.addEventListener('pointercancel', onEnd);
  });
}

function bulb(room, placed, withLabel) {
  const x = clamp(placed.x, 0, room.width);
  const y = clamp(placed.y, 0, room.height);
  const group = s('g', { class: 'light', transform: `translate(${x} ${y})`, 'data-key': `light:${placed.light_id}` },
    s('circle', { class: 'glow', r: BULB_RADIUS * 2.4 }),
    s('circle', { class: 'bulb', r: BULB_RADIUS }),
    withLabel && s('text', { class: 'light-label', y: BULB_RADIUS + 24, text: shorten(placed.label, 22) }),
  );

  const light = state.lights.get(placed.light_id);
  if (!light) group.classList.add('unknown');
  else if (!light.reachable) group.classList.add('unreachable');
  else if (light.on) {
    const level = light.brightness === null ? 1 : light.brightness / 254;
    group.style.setProperty('--light', light.color || DEFAULT_LIGHT_COLOR);
    group.style.setProperty('--glow', (0.12 + 0.4 * level).toFixed(2));
  }
  return group;
}

function roomOnHomePlan(svg, room) {
  const group = s('g', {
    class: 'room',
    transform: `translate(${room.x} ${room.y})`,
    tabindex: 0,
    role: 'link',
    'aria-label': `${room.name}, ${roomCount(room)}`,
    'data-key': `room:${room.name}`,
  },
    s('rect', { class: 'room-floor', width: room.width, height: room.height, rx: 18 }),
    room.lights.map((placed) => bulb(room, placed, false)),
    s('text', { class: 'room-name', x: 32, y: 66, text: shorten(room.name, 28) }),
    s('text', { class: 'room-count', x: 32, y: 112, text: roomCount(room) }),
  );

  let origin;
  drag(svg, group, {
    start: () => { origin = { x: room.x, y: room.y }; },
    move: (dx, dy) => {
      room.x = snap(origin.x + dx);
      room.y = snap(origin.y + dy);
      group.setAttribute('transform', `translate(${room.x} ${room.y})`);
    },
    drop: () => act(() => api(roomPath(room.name), { method: 'PATCH', body: { x: room.x, y: room.y } })),
    click: () => openRoom(room.name),
  });
  group.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openRoom(room.name);
  });
  return group;
}

function homeStage() {
  if (!state.rooms.length) {
    return [h('div', { class: 'empty' },
      h('h2', { text: state.bridge.configured ? 'No rooms yet' : 'Pair your Hue bridge to get started' }),
      h('p', {
        text: state.bridge.configured
          ? 'Add a room on the left, or import the rooms already set up on your bridge.'
          : 'Use the Bridge panel on the left. You will need to press the round link button on the bridge.',
      }),
    )];
  }

  const pad = 60;
  const left = Math.min(...state.rooms.map((room) => room.x)) - pad;
  const top = Math.min(...state.rooms.map((room) => room.y)) - pad;
  const right = Math.max(...state.rooms.map((room) => room.x + room.width)) + pad;
  const bottom = Math.max(...state.rooms.map((room) => room.y + room.height)) + pad;
  const svg = s('svg', {
    class: 'plan home-plan',
    viewBox: `${left} ${top} ${Math.max(right - left, HOME_MIN_VIEW.width)} ${Math.max(bottom - top, HOME_MIN_VIEW.height)}`,
    preserveAspectRatio: 'xMinYMin meet',
    role: 'group',
    'aria-label': 'Home floor plan',
  });
  svg.append(...state.rooms.map((room) => roomOnHomePlan(svg, room)));
  return [h('p', { class: 'hint', text: 'Select a room to open it. Drag a room to rearrange the floor plan.' }), svg];
}

function lightOnRoomPlan(svg, room, placed) {
  const id = placed.light_id;
  const group = bulb(room, placed, true);
  group.setAttribute('tabindex', 0);
  group.setAttribute('role', 'button');
  group.setAttribute('aria-pressed', String(state.selected === id));
  group.setAttribute('aria-label', `${placed.label}, ${describe(state.lights.get(id))}`);
  group.classList.toggle('selected', state.selected === id);

  const moveTo = (x, y) => {
    placed.x = clamp(snap(x), 0, room.width);
    placed.y = clamp(snap(y), 0, room.height);
    group.setAttribute('transform', `translate(${placed.x} ${placed.y})`);
  };
  const save = () => api(`${roomPath(room.name)}/lights`, {
    method: 'POST',
    body: { light_id: id, x: placed.x, y: placed.y },
  }).catch((error) => toast(error.message));

  let origin;
  drag(svg, group, {
    start: () => { origin = { x: placed.x, y: placed.y }; },
    move: (dx, dy) => moveTo(origin.x + dx, origin.y + dy),
    drop: save,
    click: () => select(id),
  });

  const steps = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] };
  let nudged = false;
  group.addEventListener('keydown', (event) => {
    if (steps[event.key]) {
      event.preventDefault();
      moveTo(placed.x + steps[event.key][0], placed.y + steps[event.key][1]);
      nudged = true;
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(id);
    }
  });
  group.addEventListener('keyup', () => {
    if (nudged) save();
    nudged = false;
  });
  return group;
}

function roomStage(room) {
  const pad = 30;
  const svg = s('svg', {
    class: 'plan room-plan',
    viewBox: `${-pad} ${-pad} ${room.width + 2 * pad} ${room.height + 2 * pad}`,
    role: 'group',
    'aria-label': `${room.name} floor plan`,
  },
    s('defs', null,
      s('pattern', { id: 'grid', width: 50, height: 50, patternUnits: 'userSpaceOnUse' },
        s('path', { class: 'grid-line', d: 'M 50 0 L 0 0 0 50' }))),
    s('rect', { class: 'room-floor', width: room.width, height: room.height, rx: 14, onpointerdown: () => select(null) }),
    s('rect', { width: room.width, height: room.height, fill: 'url(#grid)', 'pointer-events': 'none' }),
  );
  if (!room.lights.length) {
    svg.append(s('text', {
      class: 'plan-hint', x: room.width / 2, y: room.height / 2, text: 'Place a light from the panel on the left.',
    }));
  }
  svg.append(...room.lights.map((placed) => lightOnRoomPlan(svg, room, placed)));
  return [
    h('p', { class: 'hint', text: 'Select a light to control it. Drag it, or use the arrow keys, to move it.' }),
    svg,
  ];
}

// Sidebar panels

const panel = (title, ...children) => h('section', { class: 'panel' }, h('h2', { text: title }), ...children);

function updateCountdown() {
  const node = document.getElementById('pairCountdown');
  const pairing = state.setup.pairing;
  if (node && pairing) node.textContent = `${Math.max(0, Math.ceil((pairing.endsAt - Date.now()) / 1000))}s left`;
}

async function pair(address) {
  const setup = state.setup;
  const ip = address.trim();
  if (!ip) {
    setup.error = 'Enter the bridge address first.';
    render();
    return;
  }

  setup.error = '';
  setup.pairing = { ip, endsAt: Date.now() + state.pairingWindow * 1000 };
  render();
  const timer = setInterval(updateCountdown, 250);
  try {
    const result = await api('/api/bridge/register', { method: 'POST', body: { bridge_ip: ip } });
    setup.open = false;
    setup.found = null;
    toast(`Paired with the bridge at ${result.bridge_ip}.`, false);
  } catch (error) {
    setup.error = error.message;
  }
  clearInterval(timer);
  setup.pairing = null;
  await reload(true);
}

async function findBridges() {
  const setup = state.setup;
  setup.error = '';
  setup.finding = true;
  render();
  try {
    setup.found = await api('/api/bridges/discover');
  } catch (error) {
    setup.found = null;
    setup.error = error.message;
  }
  setup.finding = false;
  render();
}

function bridgePanel() {
  const setup = state.setup;
  if (setup.pairing) {
    return panel('Bridge',
      h('p', { class: 'notice', text: `Press the round link button on the Hue bridge at ${setup.pairing.ip} now.` }),
      h('p', { class: 'countdown', id: 'pairCountdown', text: `${state.pairingWindow}s left` }),
    );
  }

  const parts = [];
  if (state.bridge.configured) {
    parts.push(state.lightsError
      ? h('p', { class: 'error', text: state.lightsError })
      : h('p', { text: `Paired with the bridge at ${state.bridge.ip}.` }));
    if (!setup.open) {
      parts.push(h('button', {
        class: 'quiet', id: 'pairOther', text: 'Pair a different bridge', onclick: () => { setup.open = true; render(); },
      }));
      return panel('Bridge', ...parts);
    }
  } else {
    parts.push(h('p', { text: 'Pair with your Hue bridge to see and control your lights.' }));
  }

  if (setup.error) parts.push(h('p', { class: 'error', text: setup.error }));
  parts.push(h('button', {
    id: 'findBridges', text: setup.finding ? 'Looking…' : 'Find bridges', disabled: setup.finding, onclick: findBridges,
  }));
  if (setup.found && !setup.found.length) {
    parts.push(h('p', { text: 'No bridges were found. Enter the address below.' }));
  } else if (setup.found) {
    parts.push(h('ul', { class: 'list' }, setup.found.map((bridge) => h('li', null,
      h('span', { class: 'name', text: bridge.ip }),
      h('button', { 'data-key': `pair:${bridge.ip}`, text: 'Pair', onclick: () => pair(bridge.ip) }),
    ))));
  }

  const address = h('input', { type: 'text', id: 'bridgeAddress', placeholder: '192.168.1.50' });
  parts.push(
    h('label', { for: 'bridgeAddress', text: 'Or enter the bridge address' }),
    h('form', { class: 'row', onsubmit: (event) => { event.preventDefault(); pair(address.value); } },
      address, h('button', { id: 'pairAddress', text: 'Pair' })),
  );
  return panel('Bridge', ...parts);
}

function roomsPanel() {
  const name = h('input', { type: 'text', id: 'roomName', placeholder: 'Living room', maxLength: 60 });
  const addRoom = (event) => {
    event.preventDefault();
    act(() => api('/api/rooms', { method: 'POST', body: { name: name.value } }));
  };
  const importRooms = () => act(async () => {
    const result = await api('/api/rooms/import', { method: 'POST' });
    toast(result.added.length
      ? `Imported ${result.added.join(', ')}.`
      : 'Every room on the bridge is already here.', false);
  });

  return panel('Rooms',
    h('ul', { class: 'list' }, state.rooms.map((room) => h('li', null,
      h('button', { class: 'quiet room-link', 'data-key': `open:${room.name}`, onclick: () => openRoom(room.name) },
        h('span', { class: 'name', text: room.name }),
        live(h('span', { class: 'meta' }), (node) => { node.textContent = roomCount(findRoom(room.name)); })),
    ))),
    h('label', { for: 'roomName', text: 'New room' }),
    h('form', { class: 'row', onsubmit: addRoom }, name, h('button', { id: 'addRoom', text: 'Add' })),
    state.bridge.configured && h('p', null),
    state.bridge.configured && h('button', {
      class: 'quiet', id: 'importRooms', text: 'Import rooms from the bridge', onclick: importRooms,
    }),
  );
}

function lightSwitch(id) {
  const toggle = () => {
    const light = state.lights.get(id);
    if (light) setLight(id, { on: !light.on });
  };
  return live(h('button', { class: 'quiet', role: 'switch', 'data-key': `switch:${id}`, onclick: toggle }), (node) => {
    const light = state.lights.get(id);
    const on = Boolean(light && light.on && light.reachable);
    node.textContent = on ? 'On' : 'Off';
    node.disabled = !light || !light.reachable;
    node.setAttribute('aria-checked', String(on));
    node.setAttribute('aria-label', light ? light.name : `Light ${id}`);
  });
}

function allLightsPanel() {
  const placedIn = new Map();
  for (const room of state.rooms) {
    for (const placed of room.lights) placedIn.set(placed.light_id, room.name);
  }
  if (!state.lights.size) {
    return panel('Lights', h('p', { text: state.lightsError ? 'The bridge is not responding.' : 'The bridge has no lights.' }));
  }
  return panel('Lights', h('ul', { class: 'list' }, [...state.lights.values()].map((light) => h('li', null,
    h('span', { class: 'name', text: light.name }),
    h('span', { class: 'meta', text: placedIn.get(light.id) || 'Not placed' }),
    lightSwitch(light.id),
  ))));
}

function lightPanel(room) {
  const placed = room.lights.find((item) => item.light_id === state.selected);
  if (!placed) return panel('Light', h('p', { text: 'Select a light on the plan to control it.' }));

  const id = placed.light_id;
  const current = () => state.lights.get(id);
  const idle = (node) => document.activeElement !== node;
  const light = current();
  const parts = [live(h('p', { id: 'lightStatus' }), (node) => { node.textContent = describe(current()); })];

  if (light) {
    parts.push(live(
      h('button', { id: 'lightToggle', onclick: () => current() && setLight(id, { on: !current().on }) }),
      (node) => { node.textContent = current() && current().on ? 'Turn off' : 'Turn on'; },
    ));
    if (light.brightness !== null) {
      parts.push(
        h('label', { for: 'lightBrightness', text: 'Brightness' }),
        live(h('input', {
          type: 'range', id: 'lightBrightness', min: 1, max: 254,
          oninput: (event) => setLight(id, { on: true, brightness: Number(event.target.value) }),
        }), (node) => { if (idle(node) && current()) node.value = current().brightness; }),
      );
    }
    if (light.supports_color) {
      parts.push(
        h('label', { for: 'lightColor', text: 'Color' }),
        live(h('input', {
          type: 'color', id: 'lightColor',
          oninput: (event) => setLight(id, { on: true, color: event.target.value }),
        }), (node) => { if (idle(node) && current()) node.value = current().color || '#ffffff'; }),
      );
    }
    if (light.supports_color_temp) {
      parts.push(
        h('label', { for: 'lightTemp', text: 'Color temperature (warm to cool)' }),
        live(h('input', {
          type: 'range', id: 'lightTemp', min: 2000, max: 6500, step: 100,
          oninput: (event) => setLight(id, { on: true, color_temp: Number(event.target.value) }),
        }), (node) => { if (idle(node) && current()) node.value = current().color_temp || 2700; }),
      );
    }
  }

  parts.push(h('p', null), h('button', {
    class: 'quiet', id: 'lightRemove', text: 'Remove from this room',
    onclick: () => {
      state.selected = null;
      act(() => api(`${roomPath(room.name)}/lights/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    },
  }));
  return panel(placed.label, ...parts);
}

function placePanel(room) {
  if (!state.bridge.configured) {
    return panel('Place a light', h('p', { text: 'Pair a bridge from the home view to place its lights.' }));
  }
  const placed = new Set(state.rooms.flatMap((item) => item.lights.map((light) => light.light_id)));
  const free = [...state.lights.values()].filter((light) => !placed.has(light.id));
  if (!free.length) {
    return panel('Place a light', h('p', {
      text: state.lights.size ? 'Every light on the bridge is already placed in a room.' : 'No lights are available.',
    }));
  }

  const choice = h('select', { id: 'placeChoice', 'aria-label': 'Light to place' },
    free.map((light) => h('option', { value: light.id, text: light.name })));
  const place = () => {
    const count = room.lights.length;
    const light = state.lights.get(choice.value);
    state.selected = choice.value;
    act(() => api(`${roomPath(room.name)}/lights`, {
      method: 'POST',
      body: {
        light_id: choice.value,
        label: light ? light.name : null,
        x: room.width / 2 + ((count % 5) - 2) * 80,
        y: room.height / 2 + ((Math.floor(count / 5) % 3) - 1) * 100,
      },
    }));
  };
  return panel('Place a light', h('div', { class: 'row' }, choice, h('button', { id: 'placeLight', text: 'Place', onclick: place })));
}

function roomLightsPanel(room) {
  if (!room.lights.length) return panel('In this room', h('p', { text: 'No lights placed yet.' }));
  return panel('In this room', h('ul', { class: 'list' }, room.lights.map((placed) => h('li', null,
    h('button', { class: 'quiet room-link', 'data-key': `pick:${placed.light_id}`, onclick: () => select(placed.light_id) },
      h('span', { class: 'name', text: placed.label }),
      live(h('span', { class: 'meta' }), (node) => { node.textContent = describe(state.lights.get(placed.light_id)); })),
  ))));
}

function roomSettingsPanel(room) {
  const remove = () => {
    if (!confirm(`Delete the room "${room.name}"? Its light placements are removed. The lights stay on the bridge.`)) return;
    act(() => api(roomPath(room.name), { method: 'DELETE' }));
  };
  return panel('Room', h('button', { class: 'danger', id: 'deleteRoom', text: 'Delete this room', onclick: remove }));
}

// Rendering

function setStatus(text, isError) {
  const node = document.getElementById('bridgeStatus');
  node.textContent = text;
  node.classList.toggle('error', Boolean(isError));
}

function renderHeader(room) {
  document.getElementById('crumbRoom').textContent = room ? room.name : '';
  document.title = room ? `${room.name} - MyHuey` : 'MyHuey';
  if (!state.bridge.configured) setStatus('No bridge paired', false);
  else if (state.lightsError) setStatus(state.lightsError, true);
  else setStatus(`Bridge ${state.bridge.ip}: ${state.lights.size} lights`, false);
}

function renderStage(room) {
  if (state.dragging) return;
  document.getElementById('stage').replaceChildren(...(room ? roomStage(room) : homeStage()));
}

const focusKey = (node) => (node && (node.getAttribute('data-key') || node.id)) || '';

function restoreFocus(key) {
  if (!key) return;
  const target = document.getElementById(key)
    || [...document.querySelectorAll('[data-key]')].find((node) => node.getAttribute('data-key') === key);
  if (target) target.focus();
}

function render() {
  const room = currentRoom();
  const key = focusKey(document.activeElement);
  liveUpdates = [];
  renderHeader(room);
  document.getElementById('sidebar').replaceChildren(...(room
    ? [lightPanel(room), placePanel(room), roomLightsPanel(room), roomSettingsPanel(room)]
    : [bridgePanel(), roomsPanel(), state.bridge.configured && allLightsPanel()].filter(Boolean)));
  renderStage(room);
  restoreFocus(key);
}

// Light states changed but the controls did not: redraw the plan, refresh the live nodes.
function renderLive() {
  const room = currentRoom();
  const key = focusKey(document.activeElement);
  renderHeader(room);
  renderStage(room);
  liveUpdates.forEach((update) => update());
  restoreFocus(key);
}

window.addEventListener('hashchange', () => {
  state.selected = null;
  render();
});

setInterval(() => {
  if (document.hidden || state.dragging || state.sending || state.setup.pairing) return;
  reload();
}, POLL_MS);

reload(true);
