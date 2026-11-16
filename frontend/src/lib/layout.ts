// Which saved layout the web app is working on. null means the Active layout, which the app runs on.
// The open sandbox is sent with every request, except calls marked Active-only (the home screen's).

export const LAYOUT_KEY = 'myhuey.layout';
export const LAYOUT_HEADER = 'X-Myhuey-Layout';
export const MISSING_LAYOUT = 'That layout no longer exists';

export function layoutHeaders(open: string | null, activeOnly: boolean): Record<string, string> {
  return open && !activeOnly ? { [LAYOUT_HEADER]: open } : {};
}

/** The open sandbox was deleted (in another tab, or from the CLI). */
export function isMissingLayout(error: unknown): boolean {
  return error instanceof Error && (error as { status?: number }).status === 404 && error.message === MISSING_LAYOUT;
}

export function readStoredLayout(): string | null {
  try {
    return localStorage.getItem(LAYOUT_KEY) || null;
  } catch {
    return null;
  }
}

export function storeLayout(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAYOUT_KEY, id);
    else localStorage.removeItem(LAYOUT_KEY);
  } catch {
    // storage blocked: the sandbox stays open until the page reloads
  }
}
