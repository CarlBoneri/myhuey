// Help, inside the app: a list of topics and the page for one of them. The pages are data
// (lib/helpDocs.ts); the command table is built from the prompt's own command list.
import { useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { HELP } from '../lib/commands';
import { searchHelp, topic as findTopic, type Block } from '../lib/helpDocs';
import { href } from '../lib/router';
import { useUi } from '../uiStore';

function BlockView({ block }: { block: Block }) {
  const setDraft = useUi((state) => state.setDraft);
  if ('p' in block) return <p>{block.p}</p>;
  if ('list' in block) return <ul>{block.list.map((item) => <li key={item}>{item}</li>)}</ul>;
  if ('steps' in block) return <ol>{block.steps.map((item) => <li key={item}>{item}</li>)}</ol>;
  if ('keys' in block) {
    return (
      <table className="help-keys">
        <tbody>{block.keys.map(([key, what]) => <tr key={key}><th scope="row"><kbd>{key}</kbd></th><td>{what}</td></tr>)}</tbody>
      </table>
    );
  }
  if ('links' in block) return <p className="button-row">{block.links.map((link) => <a key={link.label} className="button small" href={href(link.route)}>{link.label}</a>)}</p>;
  const rows: [string, string][] = 'commands' in block ? HELP : block.try.map((command) => [command, '']);
  return (
    <div className="help-try">
      {'try' in block && <span className="help-try-label">Try in the prompt</span>}
      {rows.map(([command, what]) => (
        <div key={command} className="help-command">
          <code>{command}</code>
          {what && <span>{what}</span>}
          {'try' in block && (
            <button type="button" className="pane-fold" title="Put it in the prompt (it does not run until you press Enter)"
              aria-label={`Put ${command} in the prompt`} onClick={() => { setDraft(command); document.querySelector<HTMLInputElement>('.prompt-line input')?.focus(); }}>
              <CornerDownLeft size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function HelpView({ topic }: { topic?: string }) {
  const [query, setQuery] = useState('');
  const found = searchHelp(query);
  const current = findTopic(topic);
  return (
    <div className="page help">
      <header className="page-head">
        <div>
          <p className="eyebrow">Help</p>
          <h1>{current.title}</h1>
        </div>
      </header>
      <div className="help-layout">
        <nav className="help-nav" aria-label="Help topics">
          <label className="help-search">
            <Search size={14} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search help" aria-label="Search help" spellCheck={false} />
          </label>
          {found.map((item) => (
            <a key={item.id} href={href({ view: 'help', topic: item.id })} className={item.id === current.id ? 'active' : ''} aria-current={item.id === current.id ? 'page' : undefined}>
              <strong>{item.title}</strong>
              <small>{item.summary}</small>
            </a>
          ))}
          {!found.length && <p className="hint">Nothing mentions “{query}”. Try fewer words.</p>}
        </nav>
        <article className="help-page">
          <p className="help-summary">{current.summary}</p>
          {current.blocks.map((block, index) => <BlockView key={index} block={block} />)}
        </article>
      </div>
    </div>
  );
}
