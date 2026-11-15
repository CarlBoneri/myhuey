// An SVG plan whose user units are centimeters. Wheel zooms around the pointer; dragging the
// empty background (or holding Space, or the middle button) pans.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import type { Pt, Units } from '../types';
import { formatLength, gridStep } from '../lib/units';

interface PlanApi {
  toPlan: (clientX: number, clientY: number) => Pt;
  cmPerPx: number;
}

const PlanContext = createContext<PlanApi>({ toPlan: () => [0, 0], cmPerPx: 1 });
export const usePlan = () => useContext(PlanContext);

interface Box { x: number; y: number; w: number; h: number }

export function PlanCanvas({
  fit, units, children, onBackgroundPointerDown, cursor, className = '', overlay, onDropData,
}: {
  fit: Box;
  units: Units;
  children: ReactNode;
  onBackgroundPointerDown?: (point: Pt, event: ReactPointerEvent<SVGSVGElement>) => boolean | void;
  cursor?: string;
  className?: string;
  overlay?: ReactNode;
  onDropData?: (point: Pt, data: DataTransfer) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<Box | null>(null);
  const spaceDown = useRef(false);
  const fitKey = `${fit.x},${fit.y},${fit.w},${fit.h}`;

  useLayoutEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width || 1, h: entry.contentRect.height || 1 }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Fit the content whenever what should fit changes (another room, a resized outline).
  useEffect(() => setView(null), [fitKey]);

  const box: Box = view ?? (() => {
    const pad = Math.max(fit.w, fit.h) * 0.08 + 30;
    const w = fit.w + pad * 2;
    const h = fit.h + pad * 2;
    const aspect = size.w / size.h;
    const [vw, vh] = w / h > aspect ? [w, w / aspect] : [h * aspect, h];
    return { x: fit.x + fit.w / 2 - vw / 2, y: fit.y + fit.h / 2 - vh / 2, w: vw, h: vh };
  })();
  const cmPerPx = box.w / size.w;

  const toPlan = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return [0, 0];
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return [point.x, point.y];
  }, []);

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const [px, py] = toPlan(event.clientX, event.clientY);
      const factor = Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      setView((current) => {
        const base = current ?? box;
        const w = Math.min(Math.max(base.w * factor, 40), 20000);
        const scale = w / base.w;
        return { x: px - (px - base.x) * scale, y: py - (py - base.y) * scale, w, h: base.h * scale };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !(event.target instanceof HTMLInputElement)) spaceDown.current = true; };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') spaceDown.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    const origin = { x: event.clientX, y: event.clientY, box };
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - origin.x) * cmPerPx;
      const dy = (e.clientY - origin.y) * cmPerPx;
      setView({ ...origin.box, x: origin.box.x - dx, y: origin.box.y - dy });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const isBackground = event.target === svgRef.current || (event.target as Element).classList?.contains('plan-bg');
    if (event.button === 1 || spaceDown.current) {
      event.preventDefault();
      startPan(event);
      return;
    }
    if (!isBackground || event.button !== 0) return;
    const handled = onBackgroundPointerDown?.(toPlan(event.clientX, event.clientY), event);
    if (!handled) startPan(event);
  };

  const step = gridStep(units, cmPerPx);
  const barCm = step * Math.max(1, Math.round(120 * cmPerPx / step));

  return (
    <PlanContext.Provider value={{ toPlan, cmPerPx }}>
      <div
        className={`plan ${className}`}
        onDragOver={(event) => onDropData && event.preventDefault()}
        onDrop={(event) => {
          if (!onDropData) return;
          event.preventDefault();
          onDropData(toPlan(event.clientX, event.clientY), event.dataTransfer);
        }}
      >
        <svg
          ref={svgRef}
          className="plan-svg"
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onPointerDown={onPointerDown}
          style={{ cursor }}
          role="application"
          aria-label="Floor plan"
        >
          <defs>
            <pattern id="grid-minor" width={step} height={step} patternUnits="userSpaceOnUse">
              <path d={`M${step},0L0,0L0,${step}`} fill="none" className="grid-line" strokeWidth={cmPerPx} />
            </pattern>
            <radialGradient id="glow">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect className="plan-bg" x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#grid-minor)" />
          {children}
        </svg>
        <div className="plan-hud">
          <div className="scale-bar" style={{ width: barCm / cmPerPx }}>
            <span>{formatLength(barCm, units)}</span>
          </div>
          <button type="button" className="pill" onClick={() => setView(null)}>Fit</button>
        </div>
        {overlay}
      </div>
    </PlanContext.Provider>
  );
}

/** Drag something on the plan. `move` gets the pointer in plan cm and the offset from the start. */
export function useDrag() {
  const { toPlan } = usePlan();
  return useCallback(
    (event: ReactPointerEvent, handlers: { move: (point: Pt, delta: Pt, e: PointerEvent) => void; end?: (moved: boolean) => void }) => {
      event.stopPropagation();
      event.preventDefault();
      const start = toPlan(event.clientX, event.clientY);
      let moved = false;
      const onMove = (e: PointerEvent) => {
        const point = toPlan(e.clientX, e.clientY);
        if (!moved && Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 3) return;
        moved = true;
        handlers.move(point, [point[0] - start[0], point[1] - start[1]], e);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        handlers.end?.(moved);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [toPlan],
  );
}
