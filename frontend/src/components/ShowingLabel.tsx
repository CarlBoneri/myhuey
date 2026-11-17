import { useUi } from '../uiStore';

/** Says the picture is a card being shown, not the lights, and puts the live state one press away. */
export function ShowingLabel({ title }: { title: string }) {
  const setShowing = useUi((state) => state.setShowing);
  return (
    <div className="showing-label" role="status">
      <span>Showing: {title} (not on your lights)</span>
      <button type="button" onClick={() => setShowing(null)}>Show live</button>
    </div>
  );
}
