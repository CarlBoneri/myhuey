// Lights and furniture drawn at real size, in plan centimeters.
import { useId } from 'react';
import type { Furniture, Opening, Profile, Pt } from '../types';
import { openingSegment } from '../lib/plan';
import { renderStops } from '../lib/color';
import { glowColor as glowTint, glowOpacity } from '../lib/suggest';

const OFF = '#3a3650';

/** A light's silhouette centered on (0, 0), running along +x. Rotate it with a parent group. */
export function LightSilhouette({
  profile, length, colors, on, selected, cmPerPx, mode = 'interpolated_palette', level,
}: {
  profile: Profile; length: number; colors: string[] | null; on: boolean; selected?: boolean; cmPerPx: number; mode?: string | null;
  /** Brightness 0-100: a dim light's glow fades toward transparent. Left out, the glow is drawn at full strength. */
  level?: number;
}) {
  const id = useId().replace(/:/g, '');
  const minPx = 4 * cmPerPx; // keep thin things visible when zoomed out
  const fill = on && colors?.length ? (colors.length > 1 ? `url(#g${id})` : colors[0]) : OFF;
  const glowColor = on && colors?.length ? glowTint(colors[Math.floor(colors.length / 2)]) : null;
  const glowFade = level == null ? undefined : glowOpacity(level);
  const stroke = selected ? 'var(--accent)' : 'var(--plan-line)';
  const strokeWidth = (selected ? 2.2 : 1) * cmPerPx;
  // Drawn as hard steps so every Hue mode (bands, mirrored, scattered) shows as it looks.
  const steps = colors && colors.length > 1 ? renderStops(colors, mode ?? 'interpolated_palette', 24) : [];
  const gradient = steps.length > 0 && (
    <defs>
      <linearGradient id={`g${id}`} x1="0" x2="1" y1="0" y2="0">
        {steps.flatMap((color, index) => [
          <stop key={`${index}a`} offset={index / steps.length} stopColor={color} />,
          <stop key={`${index}b`} offset={(index + 1) / steps.length} stopColor={color} />,
        ])}
      </linearGradient>
    </defs>
  );

  if (profile.kind === 'round') {
    const r = Math.max(profile.length / 2, minPx);
    return (
      <g>
        {glowColor && <circle r={r * 4 + 30} fill="url(#glow)" color={glowColor} opacity={glowFade} className="light-glow" />}
        <circle r={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
        <circle r={r * 0.45} fill="rgba(255,255,255,0.18)" />
      </g>
    );
  }

  const w = Math.max(profile.width, minPx);
  const half = length / 2;
  const glow = glowColor && (
    <ellipse rx={half + 40} ry={w / 2 + 45} fill="url(#glow)" color={glowColor} opacity={glowFade} className="light-glow" />
  );

  if (profile.kind === 'string') {
    const count = Math.max(2, Math.min(80, Math.round(length / 10)));
    const stops = colors && colors.length > 1 ? renderStops(colors, mode ?? 'interpolated_palette', count) : null;
    return (
      <g>
        {gradient}
        {glow}
        <line x1={-half} x2={half} y1={0} y2={0} style={{ stroke: 'var(--plan-line)' }} strokeWidth={cmPerPx} />
        {Array.from({ length: count }, (_, i) => (
          <circle key={i} cx={-half + (length * i) / (count - 1)} cy={0} r={Math.max(1.4, minPx * 0.6)} fill={on ? (stops?.[i] ?? colors?.[0] ?? OFF) : OFF} />
        ))}
        <line x1={-half} x2={half} y1={0} y2={0} stroke={selected ? stroke : 'transparent'} strokeWidth={w + 6 * cmPerPx} strokeOpacity={0.25} />
      </g>
    );
  }

  const radius = profile.kind === 'tube' ? w / 2 : profile.kind === 'strip' ? w / 2 : Math.min(w, length) * 0.18;
  return (
    <g>
      {gradient}
      {glow}
      <rect x={-half} y={-w / 2} width={length} height={w} rx={radius} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      {profile.kind === 'column' && (
        // A Signe's foot sits at its start.
        <circle cx={-half} cy={0} r={Math.max(w * 2.4, minPx * 1.2)} fill={OFF} stroke={stroke} strokeWidth={strokeWidth} />
      )}
      {profile.kind === 'strip' && on && <rect x={-half} y={-w / 2} width={length} height={w} rx={radius} fill="none" style={{ stroke: 'var(--plan-line)' }} strokeWidth={cmPerPx * 0.6} />}
    </g>
  );
}

/** A piece of furniture centered on (0, 0); width runs along x and depth along y. */
export function FurnitureShape({ item, selected, cmPerPx }: { item: Furniture; selected?: boolean; cmPerPx: number }) {
  const { width: w, depth: d } = item;
  const stroke = selected ? 'var(--accent)' : 'var(--furniture-stroke)';
  const strokeWidth = (selected ? 2 : 1.2) * cmPerPx;
  const fontSize = Math.min(Math.max(10 * cmPerPx, 6), Math.min(w, d) * 0.28, 24);
  const detail = (() => {
    switch (item.kind) {
      case 'sofa':
      case 'sectional':
        return <rect x={-w / 2 + 4} y={-d / 2 + 4} width={w - 8} height={d * 0.28} rx={6} className="furniture-detail" />;
      case 'bed-queen':
      case 'bed-king':
      case 'bed-full':
      case 'bed-twin':
        return (
          <>
            <rect x={-w / 2 + 8} y={-d / 2 + 8} width={w / 2 - 12} height={d * 0.16} rx={8} className="furniture-detail" />
            <rect x={4} y={-d / 2 + 8} width={w / 2 - 12} height={d * 0.16} rx={8} className="furniture-detail" />
          </>
        );
      case 'tv':
        return <line x1={-w / 2 + 3} x2={w / 2 - 3} y1={d / 2} y2={d / 2} stroke="var(--accent-2)" strokeWidth={2 * cmPerPx} />;
      case 'monitor-24':
      case 'monitor-27':
      case 'monitor-34':
        // The screen faces +y (toward the viewer's chair); its stand sits behind.
        return <line x1={-w / 2 + 2} x2={w / 2 - 2} y1={d / 2 - 2} y2={d / 2 - 2} stroke="var(--accent-2)" strokeWidth={2 * cmPerPx} />;
      default:
        return null;
    }
  })();
  return (
    <g>
      {item.shape === 'ellipse' ? (
        <ellipse rx={w / 2} ry={d / 2} className={`furniture furniture-${item.kind}`} stroke={stroke} strokeWidth={strokeWidth} />
      ) : (
        <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={Math.min(w, d) * 0.08} className={`furniture furniture-${item.kind}`} stroke={stroke} strokeWidth={strokeWidth} />
      )}
      {detail}
      {fontSize >= 6 && (
        <text className="furniture-label" fontSize={fontSize} textAnchor="middle" dominantBaseline="central" transform={`rotate(${-item.rotation})`}>
          {item.label}
        </text>
      )}
    </g>
  );
}

export const FURNITURE_CATALOG: { kind: string; label: string; width: number; depth: number; shape?: 'rect' | 'ellipse' }[] = [
  { kind: 'sofa', label: 'Sofa', width: 213, depth: 91 },
  { kind: 'sectional', label: 'Sectional', width: 280, depth: 180 },
  { kind: 'armchair', label: 'Armchair', width: 85, depth: 85 },
  { kind: 'coffee-table', label: 'Coffee table', width: 120, depth: 60 },
  { kind: 'tv', label: 'TV 65"', width: 145, depth: 8 },
  { kind: 'tv-stand', label: 'TV stand', width: 180, depth: 45 },
  { kind: 'bed-king', label: 'King bed', width: 193, depth: 203 },
  { kind: 'bed-queen', label: 'Queen bed', width: 152, depth: 203 },
  { kind: 'bed-full', label: 'Full bed', width: 137, depth: 191 },
  { kind: 'bed-twin', label: 'Twin bed', width: 97, depth: 191 },
  { kind: 'nightstand', label: 'Nightstand', width: 50, depth: 40 },
  { kind: 'dresser', label: 'Dresser', width: 150, depth: 50 },
  { kind: 'desk', label: 'Desk', width: 140, depth: 70 },
  { kind: 'desk-l', label: 'L-desk', width: 160, depth: 150 },
  { kind: 'desk-standing', label: 'Standing desk', width: 140, depth: 70 },
  { kind: 'monitor-24', label: 'Monitor 24"', width: 54, depth: 18 },
  { kind: 'monitor-27', label: 'Monitor 27"', width: 61, depth: 20 },
  { kind: 'monitor-34', label: 'Ultrawide 34"', width: 81, depth: 22 },
  { kind: 'monitor-49', label: 'Super ultrawide 49"', width: 119.8, depth: 12 },
  { kind: 'chair', label: 'Chair', width: 50, depth: 50 },
  { kind: 'dining-table', label: 'Dining table', width: 180, depth: 90 },
  { kind: 'round-table', label: 'Round table', width: 110, depth: 110, shape: 'ellipse' },
  { kind: 'bookshelf', label: 'Bookshelf', width: 90, depth: 30 },
  { kind: 'counter', label: 'Counter', width: 240, depth: 64 },
  { kind: 'island', label: 'Island', width: 180, depth: 100 },
  { kind: 'rug', label: 'Rug 8x10', width: 305, depth: 244 },
  { kind: 'plant', label: 'Plant', width: 45, depth: 45, shape: 'ellipse' },
  { kind: 'tree', label: 'Tree', width: 140, depth: 140, shape: 'ellipse' },
  { kind: 'bathtub', label: 'Bathtub', width: 152, depth: 76 },
  { kind: 'pillar-round', label: 'Round pillar', width: 30, depth: 30, shape: 'ellipse' },
  { kind: 'pillar-square', label: 'Square pillar', width: 30, depth: 30 },
];

/** A door or window drawn on its wall: a door as a gap with its swing, a window as a double line. Room cm. */
export function OpeningShape({ outline, opening, cmPerPx, selected }: { outline: Pt[]; opening: Opening; cmPerPx: number; selected?: boolean }) {
  const segment = openingSegment(outline, opening);
  if (!segment) return null; // its wall is gone; the next save drops it
  const [a, b] = segment;
  const stroke = selected ? 'var(--accent)' : opening.kind === 'window' ? 'var(--accent-2)' : 'var(--text-2)';
  const ux = (b[0] - a[0]) / (opening.width || 1);
  const uy = (b[1] - a[1]) / (opening.width || 1);
  // Inward normal for a clockwise outline in screen coordinates.
  const [nx, ny] = [-uy, ux];
  if (opening.kind === 'window') {
    const o = 3;
    return (
      <g className="opening window">
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--bg, #0f0e17)" strokeWidth={8 * cmPerPx} />
        <line x1={a[0] - nx * o} y1={a[1] - ny * o} x2={b[0] - nx * o} y2={b[1] - ny * o} stroke={stroke} strokeWidth={1.6 * cmPerPx} />
        <line x1={a[0] + nx * o} y1={a[1] + ny * o} x2={b[0] + nx * o} y2={b[1] + ny * o} stroke={stroke} strokeWidth={1.6 * cmPerPx} />
      </g>
    );
  }
  const w = opening.width;
  const tip: Pt = [a[0] + nx * w, a[1] + ny * w];
  return (
    <g className="opening door">
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--bg, #0f0e17)" strokeWidth={6 * cmPerPx} />
      <line x1={a[0]} y1={a[1]} x2={tip[0]} y2={tip[1]} stroke={stroke} strokeWidth={1.6 * cmPerPx} />
      <path d={`M${tip[0]},${tip[1]} A${w},${w} 0 0 1 ${b[0]},${b[1]}`} fill="none" stroke={stroke} strokeWidth={cmPerPx} strokeDasharray={`${4 * cmPerPx} ${3 * cmPerPx}`} />
    </g>
  );
}
