// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '../test/dom';
import type { Furniture } from '../types';
import { sizeFromDiagonal } from '../lib/screen';
import { ScreenFields } from './ScreenFields';

const monitor = (more: Partial<Furniture> = {}): Furniture => ({
  id: 'm', kind: 'monitor-27', label: 'Dell', x: 100, y: 50, width: 59.8, depth: 20, rotation: 0, shape: 'rect', elevation: 75, height: 33.6, ...more,
});
const mount = (item: Furniture) => {
  const onChange = vi.fn();
  render(<ScreenFields item={item} onChange={onChange} />);
  return onChange;
};
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0] as Furniture;
const radio = (group: string, name: string) => within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name });

describe('ScreenFields', () => {
  it('sizes the panel from the diagonal in the chosen aspect', () => {
    const onChange = mount(monitor(sizeFromDiagonal(27, 32, 9)));
    const input = screen.getByLabelText('Diagonal (in)');
    fireEvent.change(input, { target: { value: '49' } });
    fireEvent.blur(input);
    expect(last(onChange)).toMatchObject({ width: 119.8, height: 33.7 });
  });

  it('keeps the diagonal when the aspect changes', () => {
    const onChange = mount(monitor());
    fireEvent.click(radio('Aspect', '32:9'));
    expect(last(onChange)).toMatchObject(sizeFromDiagonal(27, 32, 9));
  });

  it('turns a curved screen to portrait flat, and disables the curve while portrait', () => {
    const onChange = mount(monitor({ curve: 1800 }));
    fireEvent.click(radio('Orientation', 'Portrait'));
    expect(last(onChange)).toMatchObject({ width: 33.6, height: 59.8, curve: null });
  });

  it('greys out the curve for a portrait screen', () => {
    mount(monitor({ width: 33.6, height: 59.8 }));
    expect((radio('Curve', '1800R') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sets a sold curve, flat, or a custom one', () => {
    const onChange = mount(monitor());
    fireEvent.click(radio('Curve', '1800R'));
    expect(last(onChange).curve).toBe(1800);
    fireEvent.click(radio('Curve', 'Flat'));
    expect(last(onChange).curve).toBeNull();
    fireEvent.click(radio('Curve', 'Custom'));
    const custom = screen.getByLabelText('Curve (R)');
    fireEvent.change(custom, { target: { value: '1200' } });
    fireEvent.blur(custom);
    expect(last(onChange).curve).toBe(1200);
  });

  it('refuses a custom curve outside 500R to 10000R', () => {
    const onChange = mount(monitor({ curve: 1200 }));
    const custom = screen.getByLabelText('Curve (R)');
    fireEvent.change(custom, { target: { value: '300' } });
    fireEvent.blur(custom);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the default monitor tilt and sets a new one', () => {
    const onChange = mount(monitor());
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.value).toBe('-12');
    fireEvent.change(slider, { target: { value: '-20' } });
    expect(last(onChange).tilt).toBe(-20);
  });
});
