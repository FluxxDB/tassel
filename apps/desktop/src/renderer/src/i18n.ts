// The renderer's i18next instance: the shared en/es/ko catalogs, ICU message syntax
// ({elapsed}), and <html lang> kept in step with the language, so :lang(ko) typography applies.
import { type Lang, resources } from '@tassel/shared/i18n';
import i18next, { type i18n } from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

export async function initI18n(lang: Lang): Promise<i18n> {
  const instance = i18next.createInstance().use(ICU).use(initReactI18next);
  instance.on('languageChanged', setDocumentLang);
  await instance.init({
    resources,
    lng: lang,
    fallbackLng: 'en',
    // React escapes what it renders.
    interpolation: { escapeValue: false },
  });
  return instance;
}

function setDocumentLang(lang: string): void {
  document.documentElement.lang = lang;
}
