// @vitest-environment jsdom
import { fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { bindPushToTalk } from '../../../src/renderer/src/features/voice/push-to-talk';

it('prevents Space activation, ignores repeats, releases on blur and unbinds', () => {
  const held = vi.fn();
  const off = bindPushToTalk(window, held);
  expect(fireEvent.keyDown(window, { code: 'Space' })).toBe(false);
  fireEvent.keyDown(window, { code: 'Space', repeat: true });
  expect(held.mock.calls).toEqual([[true]]);
  fireEvent.blur(window);
  expect(held.mock.calls).toEqual([[true], [false]]);
  fireEvent.keyDown(window, { code: 'Space' });
  expect(fireEvent.keyUp(window, { code: 'Space' })).toBe(false);
  off();
  fireEvent.keyDown(window, { code: 'Space' });
  expect(held.mock.calls).toEqual([[true], [false], [true], [false]]);
});
it('does not steal Space from editing, modifiers or a dialog', () => {
  const held = vi.fn();
  const off = bindPushToTalk(window, held);
  const input = document.createElement('input');
  document.body.append(input);
  fireEvent.keyDown(input, { code: 'Space' });
  input.remove();
  fireEvent.keyDown(window, { code: 'Space', ctrlKey: true });
  const dialog = document.createElement('div');
  dialog.role = 'dialog';
  document.body.append(dialog);
  fireEvent.keyDown(window, { code: 'Space' });
  dialog.remove();
  expect(held).not.toHaveBeenCalled();
  off();
});
it('releases when hidden and on unbind', () => {
  const held = vi.fn();
  const off = bindPushToTalk(window, held);
  fireEvent.keyDown(window, { code: 'Space' });
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  expect(held.mock.calls).toEqual([[true], [false]]);
  hidden.mockRestore();
  fireEvent.keyDown(window, { code: 'Space' });
  off();
  expect(held.mock.calls).toEqual([[true], [false], [true], [false]]);
});
