// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { DevConsole } from '../../../src/renderer/src/features/voice/DevConsole';
import { initI18n } from '../../../src/renderer/src/i18n';

async function setup() {
  const onSend = vi.fn();
  render(
    <I18nextProvider i18n={await initI18n('en')}>
      <DevConsole onSend={onSend} />
    </I18nextProvider>,
  );
  return {
    onSend,
    user: userEvent.setup(),
    input: screen.getByRole('textbox', { name: 'Student message' }),
  };
}
describe('DevConsole', () => {
  it('sends trimmed text on Enter, clears it, and ignores blanks', async () => {
    const { user, input, onSend } = await setup();
    expect(input).toHaveAttribute('placeholder', 'Type what the student says');
    await user.type(input, '  Could you explain that?  {Enter}');
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Could you explain that?');
    expect(input).toHaveValue('');
    await user.type(input, '   {Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it('Send also submits a message', async () => {
    const { user, input, onSend } = await setup();
    await user.type(input, 'Explain it');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Explain it');
    expect(input).toHaveValue('');
  });
  it('Enter while composing Korean does not submit the unfinished message', async () => {
    const { input, onSend } = await setup();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '설명' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true });
    // Some browsers dispatch a form submit from the composition-confirming Enter.
    const form = input.closest('form');
    if (!form) throw new Error('Console form missing');
    fireEvent.submit(form);
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
  });
});
