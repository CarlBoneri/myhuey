/** Call `fn` at most once per `ms`: the first value goes at once, later ones within the window
 * collapse into the latest, which goes when the window ends. `flush()` sends a waiting value now.
 * Used where one gesture fans out to many lights, so a drag never floods the bridge. */
export function throttleLatest<T>(fn: (value: T) => void, ms: number): ((value: T) => void) & { flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiting: { value: T } | null = null;
  const open = () => {
    timer = setTimeout(() => {
      timer = null;
      if (waiting) { const { value } = waiting; waiting = null; fn(value); open(); }
    }, ms);
  };
  const send = (value: T) => {
    if (timer) { waiting = { value }; return; }
    fn(value);
    open();
  };
  send.flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (waiting) { const { value } = waiting; waiting = null; fn(value); }
  };
  return send;
}
