import { useEffect, useState } from 'react';
import { Link2, Search } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { Field, HueIcon, Panel, Segmented, TextInput, Toggle } from '../components/ui';
import type { Preferences } from '../types';
import { quarterHours } from '../lib/suggest';

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
          <p><a className="button subtle" href="#/setup">Run the setup guide</a></p>
          <p className="hint">The bridge certificate is pinned on first contact. The pairing key stays on this computer and is never sent to the browser.</p>
        </Panel>
        <PreferencesPanel />
        <Panel title="Command line">
          <p className="hint">Everything here also works from the terminal:</p>
          <pre className="code">{`myhuey bridge setup
myhuey room update --name Office --width 12ft --height "10ft 6in"
myhuey furniture add --room Office --kind desk --width 5ft --depth 30in
myhuey scene list
myhuey scene apply --scene "Sunset"
myhuey palette --file photo.jpg --mood bright
myhuey suggest --room Office --mode code --save "Late night"
myhuey palettes --tag warm`}</pre>
        </Panel>
      </div>
    </div>
  );
}

function PreferenceRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="pref-row">
      <div className="pref-text"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      {children}
    </div>
  );
}

function PreferencesPanel() {
  const { preferences: p, setPreferences } = useStore();
  const set = (changes: Partial<Preferences>) => void setPreferences(changes);
  const choice = <K extends keyof Preferences>(key: K, values: Preferences[K][], format: (v: Preferences[K]) => string) => (
    <Segmented label={key} value={String(p[key])} onChange={(v) => set({ [key]: values.find((x) => String(x) === v) } as Partial<Preferences>)}
      options={values.map((v) => ({ value: String(v), label: format(v) }))} />
  );
  return (
    <Panel title="Preferences">
      <h3 className="pref-group">Rooms</h3>
      <PreferenceRow label="Brightness slider on each room" hint="Dims or brightens every light that is on, in the room list and on the room page.">
        <Toggle checked={p.room_sliders} onChange={(room_sliders) => set({ room_sliders })} label="Brightness slider on each room" />
      </PreferenceRow>
      <PreferenceRow label="Only while lights are on" hint="Hide a room's slider while all its lights are off.">
        <Toggle checked={p.room_sliders_when_on_only} onChange={(room_sliders_when_on_only) => set({ room_sliders_when_on_only })} label="Only while lights are on" />
      </PreferenceRow>
      <PreferenceRow label="Glow around lit lights" hint="The soft halo on plans. Turn off for a calmer screen.">
        <Toggle checked={p.show_light_glow} onChange={(show_light_glow) => set({ show_light_glow })} label="Glow around lit lights" />
      </PreferenceRow>
      <PreferenceRow label="Units for new rooms">
        {choice('default_units', ['imperial', 'metric'], (v) => (v === 'imperial' ? 'Feet & inches' : 'Meters'))}
      </PreferenceRow>
      <h3 className="pref-group">Your day</h3>
      <PreferenceRow label="Wake time" hint="Suggested scenes brighten and cool after you wake.">
        <TimeSelect label="Wake time" value={p.wake_time} onChange={(wake_time) => set({ wake_time })} />
      </PreferenceRow>
      <PreferenceRow label="Bedtime" hint="Suggested scenes warm and dim over the four hours before it, and leave out blue-heavy palettes.">
        <TimeSelect label="Bedtime" value={p.bed_time} onChange={(bed_time) => set({ bed_time })} />
      </PreferenceRow>
      <h3 className="pref-group">Bridge</h3>
      <PreferenceRow label="Refresh light states" hint="How often this page reads the lights while it is open.">
        {choice('poll_seconds', [2, 5, 10, 30, 0], (v) => (v ? `${v}s` : 'Off'))}
      </PreferenceRow>
      <PreferenceRow label="Gap between light commands" hint="Signify advises about 100 ms. Wider is gentler when switches and other apps share the bridge.">
        {choice('command_gap_ms', [100, 150, 200, 300], (v) => `${v} ms`)}
      </PreferenceRow>
    </Panel>
  );
}

function TimeSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <select className="input time-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {quarterHours().map((time) => <option key={time} value={time}>{time}</option>)}
    </select>
  );
}
