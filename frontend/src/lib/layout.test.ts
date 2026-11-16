import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { isMissingLayout, layoutHeaders } from './layout';

describe('layoutHeaders', () => {
  it('sends nothing on Active', () => expect(layoutHeaders(null, false)).toEqual({}));
  it('names the open sandbox', () => expect(layoutHeaders('s1', false)).toEqual({ 'X-Myhuey-Layout': 's1' }));
  it('leaves Active-only calls on Active', () => expect(layoutHeaders('s1', true)).toEqual({}));
});

describe('isMissingLayout', () => {
  it('spots a deleted layout', () => expect(isMissingLayout(new ApiError('That layout no longer exists', 404))).toBe(true));
  it('ignores other 404s', () => expect(isMissingLayout(new ApiError("Room 'Den' not found", 404))).toBe(false));
  it('ignores non-errors', () => expect(isMissingLayout('nope')).toBe(false));
});
