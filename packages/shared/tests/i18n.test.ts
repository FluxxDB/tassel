import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCatalogs, resources } from '../src/i18n';

describe('i18n catalogs', () => {
  it('are complete and consistent', () => {
    expect(
      checkCatalogs({
        en: resources.en.translation,
        es: resources.es.translation,
        ko: resources.ko.translation,
      }),
    ).toEqual([]);
  });
  it('reports a missing key in one language', () => {
    const en = { library: { empty: { title: 'Nothing yet' } } };
    expect(checkCatalogs({ en, es: { library: { empty: {} } }, ko: en })).toEqual([
      'es: missing library.empty.title',
    ]);
  });
  it('reports mismatched ICU placeholders', () => {
    const en = { session: { timer: 'Elapsed {elapsed}' } };
    expect(checkCatalogs({ en, es: { session: { timer: 'Tiempo {tiempo}' } }, ko: en })).toEqual([
      'es: placeholder mismatch session.timer ({elapsed})',
    ]);
  });
  it('has the fixed copy', () => {
    expect(resources.ko.translation).toMatchObject({ session: { untitled: '제목 없는 세션' } });
    expect(resources.es.translation).toMatchObject({
      platform: {
        windowsNoDeskView:
          'Desk View no está disponible en Windows. Comparte tu pantalla en su lugar.',
      },
    });
  });
});

describe('checkCatalogs', () => {
  it('reports a key that en lacks as extra', () => {
    expect(checkCatalogs({ en: {}, es: { common: { back: 'Volver' } }, ko: {} })).toEqual([
      'es: extra common.back',
    ]);
  });
  it('reads arguments inside plural sub-messages, not the sub-message text', () => {
    const en = { n: '{count} {count, plural, one {minute} other {minutes}}' };
    const es = { n: '{count} {count, plural, one {minuto} other {minutos}}' };
    expect(checkCatalogs({ en, es, ko: en })).toEqual([]);
  });
  it('compares arguments nested in select and plural branches', () => {
    const en = { n: '{gender, select, other {{count, plural, other {{name} has # notes}}}}' };
    const es = { n: '{gender, select, other {{count, plural, other {# notas}}}}' };
    expect(checkCatalogs({ en, es, ko: en })).toEqual([
      'es: placeholder mismatch n ({count}, {gender}, {name})',
    ]);
  });
  it('reports a message that does not parse as ICU', () => {
    const en = { session: { timer: 'Elapsed {elapsed}' } };
    expect(checkCatalogs({ en, es: { session: { timer: 'Tiempo {elapsed' } }, ko: en })).toEqual([
      'es: invalid ICU session.timer (EXPECT_ARGUMENT_CLOSING_BRACE)',
    ]);
  });
  it('reports a leaf that is not a string', () => {
    const en = { session: { timer: 'Elapsed {elapsed}' } };
    expect(checkCatalogs({ en, es: { session: { timer: 42 } }, ko: en })).toEqual([
      'es: not a string session.timer',
    ]);
  });
});

describe('check:i18n CLI', () => {
  it('exits 0 on the shipped catalogs', () => {
    const script = join(__dirname, '..', 'scripts', 'check-i18n.ts');
    const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(run.stderr).not.toMatch(/: (missing|extra|placeholder|invalid|not a string)/);
    expect(run.status).toBe(0);
  });
});
