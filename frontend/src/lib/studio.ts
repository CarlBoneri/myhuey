// The Studio as one module: which room it opens, and where its room picker and view switch go.
// Everything that has to decide "which room?" (the header, the window tab, room-less addresses,
// and the typed commands) asks studioRoom, so the rule exists once.
import type { DesignTab, Route } from './router';

/** The four Studio views: the whole-home plan, and one room's plan, 3D view, or photo. */
export type StudioView = 'home' | DesignTab;
export const STUDIO_VIEWS: StudioView[] = ['home', 'plan', '3d', 'photo'];

type Named = { name: string }[];

/** The room the Studio opens: the focused one, else the one you were last in, else the first. Null with no rooms. */
export function studioRoom(rooms: Named, current: string | null | undefined, focus?: string | null): string | null {
  const exists = (name: string | null | undefined): name is string => !!name && rooms.some((room) => room.name === name);
  if (exists(focus)) return focus;
  if (exists(current)) return current;
  return rooms[0]?.name ?? null;
}

/** Which Studio view a screen is (the home plan for anything that is not a room's designer). */
export const studioViewOf = (route: Route): StudioView => (route.view === 'design' ? route.tab : 'home');

/** The screen for a view of one room; the home plan focused on it for 'home'. */
function viewOf(view: StudioView, room: string | null): Route {
  if (view === 'home') return room ? { view: 'studio', focus: room } : { view: 'studio' };
  return room ? { view: 'design', room, tab: view } : { view: 'studio' };
}

/**
 * Change the view and keep the room. `on` is the room on screen (or focused on the home plan).
 * From the home plan with nothing focused, the room is the remembered one, else the first.
 */
export function switchView(_from: StudioView, to: StudioView,ctx: { rooms: Named; remembered: string | null; on: string | null }): Route {
  if (to === 'home') return viewOf('home', ctx.on);
  return viewOf(to, studioRoom(ctx.rooms, ctx.remembered, ctx.on));
}

/**
 * Change the room and keep the view. `next` is null for "Whole home": from a room screen that is
 * the home plan focused on the room you were in; on the home plan it clears the focus.
 */
export function pickRoom(view: StudioView, next: string | null, on: string | null): Route {
  if (next === null) return viewOf('home', view === 'home' ? null : on);
  return viewOf(view, next);
}

/** A room-less Studio address, turned into the screen it stands for. Other routes pass through. */
export function resolveStudioRoute(route: Route, rooms: Named, current: string | null): Route {
  if (route.view !== 'studio-room') return route;
  const room = studioRoom(rooms, current);
  return room ? { view: 'design', room, tab: route.tab } : { view: 'studio' };
}
