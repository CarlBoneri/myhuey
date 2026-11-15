import { useEffect, useState } from 'react';
import { Link2, Search } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { Field, HueIcon, Panel, TextInput } from '../components/ui';

export function SettingsView() {
  const { setup, lights, load, lightsError } = useStore();
  const [address, setAddress] = useState('');
  const [found, setFound] = useState<{ id: string; ip: string }[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [pairing, setPairing] = useState<{ ip: string; endsAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [pairing]);

  const pair = async (ip: string) => {
    if (!ip.trim()) return setError('Enter the bridge address first.');
    setError('');
    setPairing({ ip, endsAt: Date.now() + (setup?.pairing_window ?? 30) * 1000 });
    try {
      const result = await api.pair(ip.trim());
      useStore.getState().toast(`Paired with the bridge at ${result.bridge_ip}.`, false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setPairing(null);
  };

  return (
    <div className="page settings">
      <header className="page-head"><div><p className="eyebrow">Bridge</p><h1>Hue bridge</h1></div></header>
      <div className="settings-grid">
        <Panel title={<><HueIcon name="bridge-v2" size={18} /> Pairing</>}>
          {setup?.configured ? (
            <p>Paired with the bridge at <strong className="mono">{setup.bridge.ip}</strong>. {lightsError ? <span className="warn-text">{lightsError}</span> : `${Object.keys(lights).length} lights answer.`}</p>
          ) : (
            <p>No bridge is paired yet.</p>
          )}
          {pairing ? (
            <div className="pairing">
              <p className="notice">Press the round link button on the bridge at {pairing.ip} now.</p>
              <p className="countdown">{Math.max(0, Math.ceil((pairing.endsAt - now) / 1000))}s left</p>
            </div>
          ) : (
            <>
              <Field label="Bridge address"><TextInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.50" /></Field>
              <div className="button-row">
                <button type="button" className="button primary" onClick={() => pair(address)}><Link2 size={16} /> {setup?.configured ? 'Pair again' : 'Pair'}</button>
                <button type="button" className="button" disabled={finding} onClick={async () => {
                  setFinding(true);
                  setError('');
                  try { setFound(await api.discover()); } catch (e) { setError((e as Error).message); }
                  setFinding(false);
                }}><Search size={16} /> {finding ? 'Looking…' : 'Find bridges'}</button>
              </div>
              {found && (
                <ul className="found">
                  {found.length ? found.map((bridge) => (
                    <li key={bridge.id}><span className="mono">{bridge.ip}</span><button type="button" className="button small" onClick={() => pair(bridge.ip)}>Pair</button></li>
                  )) : <li>No bridges found. Enter the address instead.</li>}
                </ul>
              )}
              {error && <p className="error-text" role="alert">{error}</p>}
            </>
          )}
          <p className="hint">The bridge certificate is pinned on first contact. The pairing key stays on this computer and is never sent to the browser.</p>
        </Panel>
        <Panel title="Command line">
          <p className="hint">Everything here also works from the terminal:</p>
          <pre className="code">{`myhuey bridge setup
myhuey room update --name Office --width 12ft --height "10ft 6in"
myhuey furniture add --room Office --kind desk --width 5ft --depth 30in
myhuey scene list
myhuey scene apply --scene "Sunset"
myhuey palette --file photo.jpg --mood bright`}</pre>
        </Panel>
      </div>
    </div>
  );
}
