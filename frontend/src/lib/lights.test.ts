import { describe, expect, it } from 'vitest';
import type { BridgeLight, Placement, ProfileTable } from '../types';
import { placedProfile } from './lights';

const table = { default: { label: 'Fallback' }, model: {}, product: {}, archetype: {} } as unknown as ProfileTable;
const placement = { light_id: 'p', product: {} } as unknown as Placement;

describe('placedProfile', () => {
  it('uses the bridge light profile when it has one', () => {
    expect(placedProfile(placement, { profile: { label: 'Strip' } } as unknown as BridgeLight, table).label).toBe('Strip');
  });
  it('falls back as with no bridge light when a record has no profile', () => {
    expect(placedProfile(placement, { id: 'p' } as unknown as BridgeLight, table).label).toBe('Fallback');
  });
});
