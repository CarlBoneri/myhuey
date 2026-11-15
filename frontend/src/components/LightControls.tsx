import { useState } from 'react';
import type { BridgeLight } from '../types';
import { sendLight } from '../store';
import { kelvinToHex } from '../lib/color';
import { ColorPicker } from './ColorPicker';
import { LiveGradientEditor } from './GradientEditor';
import { HueIcon, Slider, Toggle } from './ui';

export function LightHeader({ light }: { light: BridgeLight }) {
  return (
    <div className="light-header">
      <span className="light-icon" style={{ color: light.on && light.color ? light.color : undefined }}>
        <HueIcon name={light.profile.icon} size={26} />
      </span>
      <div>
        <strong>{light.name}</strong>
        <small>
          {light.productname || light.type}
          {light.profile.gradient && <span className="tag">Gradient</span>}
          {!light.reachable && <span className="tag warn">Unreachable</span>}
        </small>
      </div>
      <Toggle checked={light.on} label={`Turn ${light.name} ${light.on ? 'off' : 'on'}`} onChange={(on) => sendLight(light.id, { on }, { on })} />
    </div>
  );
}

export function LightControls({ light, palette }: { light: BridgeLight; palette?: string[] }) {
  const [brightness, setBrightness] = useState<number | null>(null);
  const [kelvin, setKelvin] = useState<number | null>(null);
  const shownBrightness = brightness ?? light.brightness ?? 0;
  return (
    <div className="light-controls">
      <LightHeader light={light} />
      {light.brightness !== null && (
        <Slider
          label="Brightness"
          value={shownBrightness}
          min={1}
          max={254}
          format={(v) => `${Math.round((v / 254) * 100)}%`}
          track="linear-gradient(90deg, #1b1a24, #fff4dc)"
          onChange={(v) => {
            setBrightness(v);
            sendLight(light.id, { brightness: v, on: true }, { brightness: v, on: true });
          }}
          onCommit={() => setBrightness(null)}
        />
      )}
      {light.supports_color_temp && (
        <Slider
          label="Color temperature"
          value={kelvin ?? light.color_temp ?? 2700}
          min={2000}
          max={6500}
          step={100}
          format={(v) => `${v} K`}
          track={`linear-gradient(90deg, ${kelvinToHex(2000)}, ${kelvinToHex(4000)}, ${kelvinToHex(6500)})`}
          onChange={(v) => {
            setKelvin(v);
            sendLight(light.id, { color_temp: v, on: true }, { color_temp: v, color: kelvinToHex(v), on: true });
          }}
          onCommit={() => setKelvin(null)}
        />
      )}
      {light.gradient && light.supports_color && <LiveGradientEditor light={light} palette={palette} />}
      {!light.gradient && light.supports_color && (
        <ColorPicker
          compact
          value={light.color ?? '#ffffff'}
          palette={palette}
          onChange={(hex) => sendLight(light.id, { color: hex, on: true }, { color: hex, on: true })}
        />
      )}
    </div>
  );
}
