// Vitest setup for every unit test file: jest-dom's matchers (toHaveClass, toHaveFocus and so
// on), and, in jsdom files only, unmounting what each test rendered.
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// tldraw never loads in unit tests: the board's canvas renders nothing (the session screen's
// tests show the board too). A test file can mock it again with a stand-in of its own.
vi.mock('../../src/renderer/src/board/tldraw/TldrawCanvas', () => ({ TldrawCanvas: () => null }));

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
}
