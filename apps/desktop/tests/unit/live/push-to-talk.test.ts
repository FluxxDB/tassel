// @vitest-environment jsdom

import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindPushToTalk } from '../../../src/renderer/src/tutor/live/push-to-talk';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
function bind() {
  const held = vi.fn();
  const unbind = bindPushToTalk(window, held);
  cleanups.push(unbind);
  return { held, unbind };
}
function space(
  type: 'keydown' | 'keyup',
  options: KeyboardEventInit = {},
  target: EventTarget = window,
) {
  const event = new KeyboardEvent(type, {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}
describe('push-to-talk', () => {
  it('holds and releases once, preventing default for both', () => {
    const { held } = bind();
    expect(space('keydown').defaultPrevented).toBe(true);
    expect(space('keyup').defaultPrevented).toBe(true);
    expect(held.mock.calls).toEqual([[true], [false]]);
  });
  it('repeats call onHeld once and remain prevented', () => {
    const { held } = bind();
    space('keydown');
    expect(space('keydown', { repeat: true }).defaultPrevented).toBe(true);
    space('keydown');
    expect(held.mock.calls).toEqual([[true]]);
  });
  it('Space in an input types and never holds', async () => {
    const { held } = bind();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await userEvent.setup().keyboard(' ');
    expect(input.value).toBe(' ');
    expect(held).not.toHaveBeenCalled();
  });
  it.each(['textarea', 'select', 'contenteditable'])(
    'Space in %s never holds or prevents default',
    (kind) => {
      const { held } = bind();
      const node = document.createElement(kind === 'contenteditable' ? 'div' : kind);
      if (kind === 'contenteditable') node.setAttribute('contenteditable', 'true');
      const child =
        kind === 'contenteditable' ? node.appendChild(document.createElement('span')) : node;
      document.body.append(node);
      expect(space('keydown', {}, child).defaultPrevented).toBe(false);
      expect(space('keyup', {}, child).defaultPrevented).toBe(false);
      expect(held).not.toHaveBeenCalled();
    },
  );
  it('Space with a dialog/popover open never holds and still operates its controls', () => {
    const { held } = bind();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    expect(space('keydown').defaultPrevented).toBe(false);
    expect(space('keyup').defaultPrevented).toBe(false);
    expect(held).not.toHaveBeenCalled();
  });
  it('blur releases', () => {
    const { held } = bind();
    space('keydown');
    window.dispatchEvent(new Event('blur'));
    space('keyup');
    expect(held.mock.calls).toEqual([[true], [false]]);
  });
  it('a hidden document releases', () => {
    const { held } = bind();
    space('keydown');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(held.mock.calls).toEqual([[true], [false]]);
  });
  it('Space on a focused button does not click it while bound', async () => {
    const { held } = bind();
    const button = document.createElement('button');
    const click = vi.fn();
    button.addEventListener('click', click);
    document.body.append(button);
    button.focus();
    await userEvent.setup().keyboard(' ');
    expect(click).not.toHaveBeenCalled();
    expect(held.mock.calls).toEqual([[true], [false]]);
  });
  it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey'])('ignores %s', (key) => {
    const { held } = bind();
    expect(space('keydown', { [key]: true }).defaultPrevented).toBe(false);
    space('keyup', { [key]: true });
    expect(held).not.toHaveBeenCalled();
  });
  it('ignores composition, prevented input and repeats without an initial press', () => {
    const { held } = bind();
    space('keydown', { isComposing: true });
    space('keydown', { repeat: true });
    const e = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
    e.preventDefault();
    window.dispatchEvent(e);
    expect(held).not.toHaveBeenCalled();
  });
  it('release works even after focus moves into a dialog or a modifier is pressed', () => {
    const { held } = bind();
    space('keydown');
    const input = document.createElement('input');
    document.body.append(input);
    expect(space('keyup', { ctrlKey: true }, input).defaultPrevented).toBe(true);
    expect(held.mock.calls).toEqual([[true], [false]]);
  });
  it('unbind releases and removes every listener, and is idempotent', () => {
    const { held, unbind } = bind();
    space('keydown');
    unbind();
    unbind();
    expect(space('keydown').defaultPrevented).toBe(false);
    space('keyup');
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(held.mock.calls).toEqual([[true], [false]]);
  });
});

// Task 17 interaction sequences, now exercising C's canonical binder.
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
  const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  expect(held.mock.calls).toEqual([[true], [false]]);
  hidden.mockRestore();
  fireEvent.keyDown(window, { code: 'Space' });
  off();
  expect(held.mock.calls).toEqual([[true], [false], [true], [false]]);
});
