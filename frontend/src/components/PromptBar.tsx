// The prompt pinned to the bottom of every screen: type a command, see what it really did.
// Commands are a fixed set that call the same API as the screens (see lib/commands.ts).
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { runCommand } from '../lib/runCommand';

const firstLine = (text: string) => text.split('\n')[0];

export function PromptBar() {
  const { layout, layouts } = useStore();
  const { history, busy, clearHistory, draft: value, setDraft: setValue } = useUi();
  const [open, setOpen] = useState(false);
  const [recall, setRecall] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const feed = useRef<HTMLOListElement>(null);
  const last = history[history.length - 1];
  const sandbox = layout ? layouts.find((item) => item.id === layout)?.name ?? 'sandbox' : null;
  const active = layouts.find((item) => item.active)?.name ?? 'home';

  // "/" jumps to the prompt from anywhere you are not already typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || target?.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) feed.current?.scrollTo(0, feed.current.scrollHeight); }, [open, history.length]);

  const submit = async () => {
    const line = value.trim();
    if (!line || busy) return;
    setValue('');
    setRecall(null);
    const entry = await runCommand(line);
    if (entry.output.includes('\n')) setOpen(true); // help and other long answers need the room
  };
  const typed = history.map((entry) => entry.command);
  const step = (direction: -1 | 1) => {
    if (!typed.length) return;
    const next = recall === null ? (direction === -1 ? typed.length - 1 : null) : recall + direction;
    if (next === null || next >= typed.length) { setRecall(null); setValue(''); return; }
    setRecall(Math.max(0, next));
    setValue(typed[Math.max(0, next)]);
  };

  return (
    <footer className="prompt">
      {open && (
        <div className="prompt-feed">
          <header>
            <span>What ran here</span>
            <button type="button" className="pane-fold" onClick={clearHistory} disabled={!history.length} aria-label="Clear the history" title="Clear the history"><Trash2 size={12} /></button>
          </header>
          {history.length ? (
            <ol ref={feed}>
              {history.map((entry) => (
                <li key={entry.id} className={entry.ok ? '' : 'failed'}>
                  <span className="prompt-cmd"><span aria-hidden="true">$ </span>{entry.command}</span>
                  <pre>{entry.output}</pre>
                  <small>{new Date(entry.at).toLocaleTimeString()} · {entry.ms} ms · {entry.ok ? 'ok' : 'failed'}</small>
                </li>
              ))}
            </ol>
          ) : <p className="hint">Nothing yet. Commands typed here call the same API as the screens; nothing runs a shell. Type help.</p>}
        </div>
      )}
      <button type="button" className={`prompt-last${last && !last.ok ? ' failed' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}
        title={open ? 'Hide the history' : 'Show the history'}>
        {last ? (
          <>
            <span className="prompt-cmd"><span aria-hidden="true">$ </span>{last.command}</span>
            <span className="prompt-arrow" aria-hidden="true">→</span>
            <span className="prompt-out">{firstLine(last.output)}</span>
            <small>{last.ms} ms · {last.ok ? 'ok' : 'failed'}</small>
          </>
        ) : <span className="prompt-out idle">Type a command below, or press ⌘K. Try help.</span>}
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronUp size={13} aria-hidden="true" />}
      </button>
      <form className="prompt-line" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <span className="prompt-path" aria-hidden="true">~/myhuey</span>
        <span className={`prompt-layout${sandbox ? ' sandbox' : ''}`} title={sandbox ? 'A sandbox is open: commands act on it' : 'Commands act on the active layout'}>
          {sandbox ? `sandbox:${sandbox}` : `active:${active}`}
        </span>
        <span className="prompt-caret" aria-hidden="true">❯</span>
        <input ref={input} value={value} spellCheck={false} autoComplete="off" autoCapitalize="off" aria-label="Command"
          placeholder="Try: room glare Office --fix · suggest --room Office --mode code · help"
          onChange={(event) => { setValue(event.target.value); setRecall(null); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') { event.preventDefault(); step(-1); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); step(1); }
            else if (event.key === 'Escape') (event.target as HTMLInputElement).blur();
          }} />
        <button type="submit" className="button small primary" disabled={busy || !value.trim()}>{busy ? 'Running…' : 'Run'}</button>
      </form>
    </footer>
  );
}
