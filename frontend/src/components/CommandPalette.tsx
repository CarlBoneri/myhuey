// ⌘K: find a room, scene, group, screen, or theme and run it. Every entry is a prompt command,
// so what the palette does is exactly what typing that command does.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import { useUi } from '../uiStore';
import { search, shortcuts } from '../lib/commands';
import { runCommand, snapshot } from '../lib/runCommand';

export function CommandPalette() {
  const { setPalette } = useUi();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const all = useMemo(() => shortcuts(snapshot()), []);
  const found = useMemo(() => search(all, query), [all, query]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => { list.current?.children[index]?.scrollIntoView({ block: 'nearest' }); }, [index]);

  const run = (command: string) => {
    setPalette(false);
    void runCommand(command);
  };
  // Nothing matches: what was typed is run as a command, so the palette is also a prompt.
  const typed = query.trim();

  return (
    <div className="palette-backdrop" onPointerDown={() => setPalette(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onPointerDown={(event) => event.stopPropagation()}>
        <input autoFocus value={query} spellCheck={false} placeholder="Search rooms, scenes, groups, screens, themes… or type a command"
          aria-label="Search commands" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={found[index] ? `palette-${index}` : undefined}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((i) => Math.min(found.length - 1, i + 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            else if (event.key === 'Enter') { event.preventDefault(); if (found[index]) run(found[index].command); else if (typed) run(typed); }
            else if (event.key === 'Escape') setPalette(false);
          }} />
        <ul id="palette-list" role="listbox" ref={list}>
          {found.map((item, i) => (
            <li key={`${item.group}-${item.command}`} id={`palette-${i}`} role="option" aria-selected={i === index}
              className={i === index ? 'active' : ''} onPointerEnter={() => setIndex(i)} onClick={() => run(item.command)}>
              <span className="palette-group">{item.group}</span>
              <span className="palette-title">{item.title}{item.detail && <small>{item.detail}</small>}</span>
              <code>{item.command}</code>
            </li>
          ))}
          {!found.length && typed && (
            <li className="active" role="option" aria-selected="true" onClick={() => run(typed)}>
              <span className="palette-group">Run</span>
              <span className="palette-title">Run it as a command</span>
              <code>{typed}</code>
            </li>
          )}
        </ul>
        <footer><CornerDownLeft size={12} aria-hidden="true" /> runs it · ↑ ↓ to choose · Esc closes</footer>
      </div>
    </div>
  );
}
