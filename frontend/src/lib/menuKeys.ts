// Arrow, Home and End movement shared by the tab menus: over the menu's buttons, wrapping at the ends.

/** Moves focus for ArrowDown, ArrowUp (wrapping), Home and End. Returns true when it handled the key, so the caller can preventDefault. */
export function moveMenuFocus(menu: HTMLElement, key: string): boolean {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return false;
  const buttons = [...menu.querySelectorAll<HTMLElement>('button')];
  if (!buttons.length) return true;
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  const next = key === 'Home' ? 0 : key === 'End' ? buttons.length - 1
    : (at + (key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
  return true;
}
