// A guided first run: find the Hue bridge, confirm it is the right one, press its link
// button, and bring its rooms in. Every step explains what happens and why.
import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, Map as MapIcon, Search, ShieldCheck, Wifi } from 'lucide-react';
import { ApiError, api } from '../api';
import { useStore } from '../store';
import { go } from '../lib/router';
import { initialSetup, orderBridges, setupReducer, SETUP_STEPS, type FoundBridge, type PairFailure } from '../lib/setupFlow';
import { Field, HueIcon, Panel, TextInput } from '../components/ui';

export const SETUP_SKIPPED_KEY = 'myhuey.setup.skipped';

const failureOf = (error: unknown): PairFailure =>
  error instanceof ApiError && error.status === 409 ? 'timeout' : error instanceof ApiError && (error.status === 502 || error.status === 0) ? 'unreachable' : 'rejected';

function Countdown({ seconds, total }: { seconds: number; total: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <svg className="countdown-ring" viewBox="0 0 128 128" role="timer" aria-label={`${seconds} seconds left`}>
      <circle cx="64" cy="64" r={r} className="track" />
      <circle cx="64" cy="64" r={r} className="progress" strokeDasharray={c} strokeDashoffset={c * (1 - seconds / total)} transform="rotate(-90 64 64)" />
      <text x="64" y="72" textAnchor="middle">{seconds}</text>
    </svg>
  );
}

export function SetupView() {
  const { setup, lights, load, refreshRooms } = useStore();
  const [state, dispatch] = useReducer(setupReducer, undefined, initialSetup);
  const [found, setFound] = useState<FoundBridge[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [checking, setChecking] = useState('');
  const [manual, setManual] = useState('');
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const windowSeconds = setup?.pairing_window ?? 30;

  // Look for bridges as soon as the person reaches the find step.
  useEffect(() => {
    if (state.step !== 'find' || found !== null || finding) return;
    setFinding(true);
    // Ask each bridge found who it is, so a home with several can tell them apart by name.
    api.discover()
      .then((list) => Promise.all(list.map(async ({ ip }) => ({ ip, info: await api.checkBridge(ip).catch(() => null) }))))
      .then((list) => setFound(orderBridges(list)), () => setFound([]))
      .finally(() => setFinding(false));
  }, [state.step, found, finding]);

  // Each new attempt on the press step asks the bridge to pair while the person presses its button.
  // Only one request waits at a time (the server refuses a second): coming back to this step while
  // one is still waiting re-attaches to it, and its answer is never dropped, since a press that
  // paired the bridge has already made the key.
  const pairing = useRef(false);
  useEffect(() => {
    if (state.step !== 'press' || state.error || (!state.bridge && !state.candidates.length) || pairing.current) return;
    pairing.current = true;
    setDeadline(Date.now() + windowSeconds * 1000);
    (state.bridge ? api.pair(state.bridge.bridge_ip) : api.pairAny(state.candidates))
      .then(async () => {
        try { await load(); } catch { /* the lights show once the page refreshes */ }
        dispatch({ type: 'paired', lights: Object.keys(useStore.getState().lights).length });
      }, (error) => dispatch({ type: 'pairFailed', reason: failureOf(error), message: (error as Error).message }))
      .finally(() => { pairing.current = false; });
  }, [state.attempts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.step !== 'press') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.step]);

  const check = async (ip: string) => {
    if (!ip.trim()) return;
    setChecking(ip);
    try {
      dispatch({ type: 'checked', bridge: await api.checkBridge(ip.trim()) });
    } catch (error) {
      dispatch({ type: 'checkFailed', message: (error as Error).message });
    }
    setChecking('');
  };

  const skip = () => {
    try { localStorage.setItem(SETUP_SKIPPED_KEY, '1'); } catch { /* private window: it asks again next time */ }
    go({ view: 'home' });
  };

  const current = SETUP_STEPS.findIndex((s) => s.step === state.step);
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));

  return (
    <div className="page setup">
      <header className="page-head"><div><p className="eyebrow">Setup</p><h1>Connect your Hue bridge</h1></div></header>
      <ol className="setup-rail" aria-label="Setup steps">
        {SETUP_STEPS.map((s, i) => (
          <li key={s.step} className={i < current || state.step === 'done' ? 'done' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}>
            <span>{i < current || state.step === 'done' ? <Check size={14} /> : i + 1}</span>{s.label}
          </li>
        ))}
      </ol>

      <Panel className="setup-card">
        {state.step === 'welcome' && (
          <>
            <HueIcon name="bridge-v2" size={48} />
            <h2>Let's find your bridge</h2>
            <p>MyHuey talks to your Philips Hue bridge directly over your home network. Nothing goes to the cloud and there is no account to make.</p>
            <ul className="setup-needs">
              <li><Wifi size={16} /> This computer and the bridge on the same network</li>
              <li><HueIcon name="bridge-v2" size={16} /> The bridge powered on, with its three lights lit</li>
              <li><ShieldCheck size={16} /> About two minutes, and a way to reach the bridge to press its button</li>
            </ul>
            {setup?.configured && <p className="notice">Already paired with the bridge at {setup.bridge.ip}. Running setup again replaces that pairing.</p>}
            <div className="button-row">
              <button type="button" className="button primary" onClick={() => dispatch({ type: 'start' })}>Start</button>
              <button type="button" className="button subtle" onClick={skip}>Skip for now</button>
            </div>
          </>
        )}

        {state.step === 'find' && (
          <>
            <h2>Which bridge?</h2>
            {finding ? <p className="hint">Looking for bridges on your network…</p> : found?.length ? (
              <>
                {found.length > 1 && (
                  <div className="notice multi-bridge">
                    <p><strong>{found.length} bridges found.</strong> MyHuey works with one bridge: choose the one your lights are on. To be sure which, check its address in the Hue app on your phone:</p>
                    <ol>
                      <li>Open the Hue app and tap <strong>Settings</strong>.</li>
                      <li>Tap <strong>Bridges</strong>, then the bridge that runs these lights.</li>
                      <li>Open <strong>Network settings</strong>. Its <strong>IP address</strong> is the one to choose below.</li>
                    </ol>
                    <p className="hint">Menu names shift a little between app versions. The bridge's name and ID are on the same screen and match the list below.</p>
                  </div>
                )}
                {found.filter((b) => b.info).length > 1 && (
                  <p className="pick-by-button">
                    Not sure which?{' '}
                    <button type="button" className="button small" onClick={() => dispatch({ type: 'pressAny', addresses: found.filter((b) => b.info).map((b) => b.ip) })}>
                      Pick by pressing its button
                    </button>
                    {' '}MyHuey waits on every bridge and pairs the one you press.
                  </p>
                )}
                <ul className="found bridges">
                  {found.map((b) => (
                    <li key={b.ip}>
                      <span className="bridge-who">
                        <strong>{b.info?.name ?? 'Did not answer'}</strong>
                        {b.info?.paired && <span className="pill static glow">Paired now</span>}
                        <small>
                          <span className="mono">{b.ip}</span>
                          {b.info && <> · {b.info.model} · ID <span className="mono">{b.info.bridge_id.slice(-6)}</span></>}
                        </small>
                      </span>
                      <button type="button" className={`button small${b.info ? ' primary' : ''}`} disabled={!!checking} onClick={() => check(b.ip)}>{checking === b.ip ? 'Checking…' : 'Use this one'}</button>
                    </li>
                  ))}
                </ul>
              </>
            ) : found && <p className="hint">No bridge answered the search. That is common on networks that block discovery; type its address instead.</p>}
            <Field label="Bridge address" hint="In the Hue app: Settings → Bridges → your bridge → Network settings → IP address. Your router's device list shows it too.">
              <TextInput value={manual} placeholder="192.168.1.50" onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check(manual)} />
            </Field>
            {state.error && (
              <div role="alert">
                <p className="error-text">{state.error}</p>
                <p className="hint">Check the address in your router's list of devices or in the Hue app, and check that the bridge's second light (network) is on. If it is off, the bridge has lost its network cable or Wi-Fi.</p>
              </div>
            )}
            <div className="button-row">
              <button type="button" className="button subtle" onClick={() => dispatch({ type: 'back' })}><ArrowLeft size={14} /> Back</button>
              <button type="button" className="button" disabled={finding} onClick={() => setFound(null)}><Search size={14} /> Search again</button>
              <button type="button" className="button primary" disabled={!manual.trim() || !!checking} onClick={() => check(manual)}>{checking && checking === manual ? 'Checking…' : 'Check address'}</button>
            </div>
          </>
        )}

        {state.step === 'confirm' && state.bridge && (
          <>
            <h2>Found {state.bridge.name}</h2>
            <dl className="bridge-facts">
              <dt>Address</dt><dd className="mono">{state.bridge.bridge_ip}</dd>
              <dt>Model</dt><dd>{state.bridge.model || 'Unknown'}</dd>
              <dt>Bridge ID</dt><dd className="mono">{state.bridge.bridge_id}</dd>
              <dt>Software</dt><dd>{state.bridge.software}</dd>
            </dl>
            {state.bridge.paired && <p className="notice">MyHuey is already paired with this bridge. Pairing again makes a new key and keeps your rooms and scenes.</p>}
            {state.error && <p className="error-text" role="alert">{state.error}</p>}
            <p>Next you will have {windowSeconds} seconds to press the round link button on top of the bridge. Go stand by it, then continue.</p>
            <div className="button-row">
              <button type="button" className="button subtle" onClick={() => dispatch({ type: 'back' })}><ArrowLeft size={14} /> Back</button>
              <button type="button" className="button primary" onClick={() => dispatch({ type: 'pressNow' })}>I'm at the bridge</button>
            </div>
          </>
        )}

        {state.step === 'press' && (
          <>
            <h2>Press the link button</h2>
            {state.error ? (
              <>
                <p className="error-text" role="alert">{state.error}</p>
                <div className="button-row">
                  <button type="button" className="button subtle" onClick={() => dispatch({ type: 'back' })}><ArrowLeft size={14} /> Back</button>
                  <button type="button" className="button primary" onClick={() => dispatch({ type: 'pressNow' })}>Try again</button>
                </div>
              </>
            ) : (
              <div className="press">
                <Countdown seconds={seconds} total={windowSeconds} />
                {state.bridge ? (
                  <p>Press the round button on top of the bridge at <span className="mono">{state.bridge.bridge_ip}</span>. This page notices on its own.</p>
                ) : (
                  <p>Press the round button on the bridge your lights are on. MyHuey is waiting on all {state.candidates.length} bridges and pairs whichever you press.</p>
                )}
              </div>
            )}
          </>
        )}

        {state.step === 'connected' && (
          <>
            <h2><Check size={20} /> Connected</h2>
            <p>{state.lights ? `${state.lights} lights answer.` : 'The bridge answers, but has no lights yet. Add them in the Hue app, then refresh.'} The pairing key stays on this computer; the browser never sees it.</p>
            <p>Bring your Hue rooms into MyHuey now? Each becomes a room you can shape and fill on the plan. Rooms you already have are left alone.</p>
            <div className="button-row">
              <button type="button" className="button primary" onClick={async () => {
                try {
                  const result = await api.importRooms();
                  await refreshRooms();
                  dispatch({ type: 'imported', added: result.added });
                } catch (error) {
                  useStore.getState().toast((error as Error).message);
                }
              }}><Download size={14} /> Import rooms</button>
              <button type="button" className="button subtle" onClick={() => dispatch({ type: 'finish' })}>Not now</button>
            </div>
          </>
        )}

        {state.step === 'done' && (
          <>
            <h2>You're set up</h2>
            <p>
              {state.imported === null ? 'Your bridge is connected.' : state.imported.length ? `Imported ${state.imported.join(', ')}.` : 'Every Hue room was already here.'}
              {' '}Next, lay out your home so lights can be placed where they really are.
            </p>
            <div className="button-row">
              <button type="button" className="button primary" onClick={() => go({ view: 'plan' })}><MapIcon size={14} /> Lay out the floor plan</button>
              <button type="button" className="button" onClick={() => go({ view: 'lights' })}>See {Object.keys(lights).length} lights</button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
