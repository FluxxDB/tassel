// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initI18n } from '../../src/renderer/src/i18n';

describe('initI18n', () => {
  it("initI18n('ko') sets html lang and translates session.untitled to 제목 없는 세션", async () => {
    const i18n = await initI18n('ko');
    expect(document.documentElement.lang).toBe('ko');
    expect(i18n.t('session.untitled')).toBe('제목 없는 세션');
  });

  it('formats ICU placeholders', async () => {
    const i18n = await initI18n('es');
    expect(document.documentElement.lang).toBe('es');
    expect(i18n.t('session.timer', { elapsed: '14:32' })).toBe('Tiempo transcurrido: 14:32');
  });

  it('keeps html lang in step when the language changes', async () => {
    const i18n = await initI18n('en');
    await i18n.changeLanguage('ko');
    expect(document.documentElement.lang).toBe('ko');
    expect(i18n.t('common.back')).toBe('뒤로');
  });
});
