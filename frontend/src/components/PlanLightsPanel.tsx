import { useEffect, useState } from 'react';
import { Plus, ShoppingBag, Sparkles } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore } from '../store';
import { bounds } from '../lib/geometry';
import { MODE_LABELS } from '../lib/suggest';
import { lightFill } from '../lib/suggest';
import { Panel } from './ui';
import type { CatalogItem, Room, Setup } from '../types';

const COLOR_LABEL: Record<CatalogItem['color'], string> = { gradient: 'gradient', color: 'color', white: 'white only' };

/** Plan lights you don't own yet: add catalog products, or take one of myhuey's proposed setups. */
export function PlanLightsPanel({ room }: { room: Room }) {
  const { refreshRooms } = useStore();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [setups, setSetups] = useState<Setup[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.catalog().then(setCatalog).catch(() => setCatalog([])); }, []);

  const box = bounds(room.outline);
  const addItem = async (item: CatalogItem) => {
    const ok = await attempt(() => api.addPlannedLight(room.name, {
      catalog: item.id, x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2),
    }), `Planned a ${item.label}. Drag it where it would go.`);
    if (ok) await refreshRooms();
  };
  const loadSetups = async () => {
    setLoading(true);
    const found = await attempt(() => api.setups(room.name));
    setLoading(false);
    if (found) setSetups(found);
  };

  return (
    <Panel title={<><ShoppingBag size={16} /> Plan lights</>}>
      <p className="hint">Try lights you don't own yet. Planned lights get roles and suggestions, and nothing is sent to the bridge for them. Swap one for the real light once it's paired.</p>
      <button type="button" className="button" onClick={loadSetups} disabled={loading}><Sparkles size={14} /> {loading ? 'Thinking…' : 'Suggest setups'}</button>
      {setups && (
        <div className="setup-cards">
          {setups.map((setup, index) => (
            <article key={setup.name} className="setup-card">
              <SetupMap room={room} setup={setup} />
              <div className="setup-body">
                <h3>{setup.name}</h3>
                {setup.hint && <p className="hint">{setup.hint}</p>}
                <ul className="setup-lights">
                  {setup.lights.map((light, i) => (
                    <li key={i}><strong>{light.label}</strong> <span className={`role-badge ${light.role}`}>{light.role}</span><small>{light.why}</small></li>
                  ))}
                </ul>
                <dl className="setup-modes">
                  {Object.entries(setup.modes).map(([mode, info]) => (
                    <div key={mode}><dt>{MODE_LABELS[mode] ?? mode}</dt><dd>{info.summary} · {info.kelvin} K</dd></div>
                  ))}
                </dl>
                <button type="button" className="button small primary" onClick={async () => {
                  const ok = await attempt(() => api.addSetup(room.name, index), `Added “${setup.name}” as planned lights.`);
                  if (ok) await refreshRooms();
                }}><Plus size={14} /> Add to plan</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <h3 className="pref-group">Catalog</h3>
      <ul className="tray catalog-tray">
        {catalog.map((item) => (
          <li key={item.id} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-myhuey-catalog', item.id)}>
            <span>{item.label}<small>{COLOR_LABEL[item.color]} · good for {item.kind}</small></span>
            <button type="button" className="icon-button" aria-label={`Plan a ${item.label}`} title={`Plan a ${item.label}`} onClick={() => void addItem(item)}><Plus size={16} /></button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The room from above with a setup's proposed lights, colored as the code-mode suggestion would light them. */
function SetupMap({ room, setup }: { room: Room; setup: Setup }) {
  const box = bounds(room.outline);
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  const pad = span * 0.06;
  const preview = setup.modes.code?.preview ?? [];
  return (
    <svg className="mini-room" viewBox={`${box.minX - pad} ${box.minY - pad} ${box.maxX - box.minX + pad * 2} ${box.maxY - box.minY + pad * 2}`}
      role="img" aria-label={`${room.name} with the ${setup.name} setup`}>
      <polygon points={room.outline.map((p) => p.join(',')).join(' ')} className="mini-outline" strokeWidth={span / 150} />
      {room.furniture.map((f) => (
        <rect key={f.id} x={f.x - f.width / 2} y={f.y - f.depth / 2} width={f.width} height={f.depth} className="mini-furniture"
          transform={`rotate(${f.rotation} ${f.x} ${f.y})`} />
      ))}
      {setup.lights.map((light, i) => {
        const { fill, opacity } = lightFill(preview[i] ?? { on: true, color: '#ffd29a', brightness: 60 });
        return <circle key={i} cx={light.x} cy={light.y} r={span / 26} fill={fill} opacity={opacity} stroke="#fff" strokeDasharray={`${span / 120}`} strokeWidth={span / 300}><title>{light.label}</title></circle>;
      })}
    </svg>
  );
}
