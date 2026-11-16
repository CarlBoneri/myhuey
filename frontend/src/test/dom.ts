// Component tests run in happy-dom, a simulated browser with no layout. A test file opts in with
// `// @vitest-environment happy-dom` on its first line; every other test stays in plain Node.
// Sizes, scrolling and what is drawn on top of what cannot be tested this way: check those by eye.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Testing Library only cleans up after itself when vitest globals are on, and they are off here.
afterEach(cleanup);

export { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react';
