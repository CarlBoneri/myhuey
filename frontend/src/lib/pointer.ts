// Which presses may start a resize. Only the main button does; on a Mac, Ctrl+click is a right-click.
export function isResizePress(event: { button: number; ctrlKey: boolean }, mac: boolean): boolean {
  return event.button === 0 && !(mac && event.ctrlKey);
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '';
  return /mac/i.test(platform);
}
