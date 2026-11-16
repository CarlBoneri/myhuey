// Ready-made commands for the room you are in and your saved groups: one click runs them
// through the prompt, and each shows the command it runs.
import { Copy, Play, Sparkles, X } from 'lucide-react';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { shortcuts } from '../lib/commands';
import { runCommand, snapshot } from '../lib/runCommand';

export function WorkflowsDrawer() {
  const { rooms, groups, toast } = useStore(); // re-render when rooms or groups change
  const { currentRoom, busy, setWorkflows } = useUi();
  void rooms; void groups; void currentRoom;
  const items = shortcuts(snapshot()).filter((item) => item.group === 'Workflows' || item.group === 'Groups');
  return (
    <aside className="workflows" aria-label="Workflows">
      <header>
        <span><Sparkles size={14} aria-hidden="true" /> Workflows</span>
        <button type="button" className="pane-fold" onClick={() => setWorkflows(false)} aria-label="Close workflows" title="Close"><X size={13} /></button>
      </header>
      {items.length ? items.map((item) => (
        <article key={item.command}>
          <strong>{item.title}</strong>
          {item.detail && <p>{item.detail}</p>}
          <div className="workflow-command">
            <code><span aria-hidden="true">$ </span>myhuey {item.command}</code>
            <button type="button" className="pane-fold" aria-label={`Copy the command for ${item.title}`} title="Copy"
              onClick={() => navigator.clipboard?.writeText(`myhuey ${item.command}`).then(() => toast('Copied.', false), () => toast('Could not copy.'))}><Copy size={12} /></button>
          </div>
          <button type="button" className="button small primary" disabled={busy} onClick={() => void runCommand(item.command)}><Play size={12} /> Run</button>
        </article>
      )) : <p className="hint">Add a room in the Studio and workflows for it appear here.</p>}
      <p className="hint">These act on the layout named in the prompt. Suggestions change with the time of day, so the same workflow suits morning and night.</p>
    </aside>
  );
}
