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

it('uses the configured tutor name in every locale and updates after renaming', async () => {
  const { useAvatar } = await import('../../src/renderer/src/avatar/store');
  const previous = useAvatar.getState().profile;
  try {
    useAvatar.setState({ profile: { ...previous, name: 'Mira' } });
    for (const lang of ['en', 'es', 'ko'] as const) {
      const instance = await initI18n(lang);
      expect(instance.t('session.tutorName')).toBe('Mira');
      expect(instance.t('session.pin.adaAsks', { view: 'board' })).not.toContain('Ada');
      expect(instance.t('screen.visibleIdle')).toContain('Mira');
      useAvatar.setState({ profile: { ...previous, name: 'Nova' } });
      expect(instance.t('screen.visibleIdle')).toContain('Nova');
      useAvatar.setState({ profile: { ...previous, name: 'Mira' } });
    }
  } finally {
    useAvatar.setState({ profile: previous });
  }
});
