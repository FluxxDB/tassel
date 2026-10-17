// Vitest setup for every unit test file: jest-dom's matchers (toHaveClass, toHaveFocus and so
// on), and, in jsdom files only, unmounting what each test rendered.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
}
