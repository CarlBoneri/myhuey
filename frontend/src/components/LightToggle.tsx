// The Studio's "Light" button: opens the lighting panel on every room view. Its state is the
// shell's, so it carries over when you switch between Room plan, 3D and Photo.
import { Sun } from 'lucide-react';
import { useUi } from '../uiStore';

export function LightToggle() {
  const open = useUi((state) => state.lightingOpen);
  const setOpen = useUi((state) => state.setLightingOpen);
  return (
    <button type="button" className={`button${open ? ' active' : ''}`} aria-pressed={open} onClick={() => setOpen(!open)}>
      <Sun size={15} /> Light
    </button>
  );
}
