// The en/es/ko UI catalogs and the completeness check behind `pnpm check:i18n`.
// Node runs this module directly from scripts/check-i18n.ts (type stripping, no bundler), so
// the JSON imports carry `with { type: 'json' }` and there are no relative .ts imports.
import {
  isArgumentElement,
  isDateElement,
  isNumberElement,
  isPluralElement,
  isSelectElement,
  isTimeElement,
  type MessageFormatElement,
  parse,
} from '@formatjs/icu-messageformat-parser';
import en from './en.json' with { type: 'json' };
import es from './es.json' with { type: 'json' };
import ko from './ko.json' with { type: 'json' };

export const SUPPORTED_LANGS = ['en', 'es', 'ko'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const resources: Record<Lang, { translation: Record<string, unknown> }> = {
  en: { translation: en },
  es: { translation: es },
  ko: { translation: ko },
};

/** Each message key's ICU argument names, or null for a message already reported as broken. */
type Messages = Map<string, Set<string> | null>;

/**
 * Checks every catalog against `en`, the reference. Returns one line per problem, so an empty
 * array means the catalogs are complete and consistent:
 * - `es: missing library.empty.title`: `en` has the key and `es` doesn't.
 * - `es: extra library.emtpy.title`: `es` has a key that `en` doesn't.
 * - `es: placeholder mismatch session.timer ({elapsed})`: the ICU argument names differ from
 *   `en`'s, which the parentheses list.
 * - `es: invalid ICU session.timer (EXPECT_ARGUMENT_CLOSING_BRACE)`: the message doesn't parse,
 *   so i18next-icu would show it raw.
 * - `es: not a string session.timer`.
 */
export function checkCatalogs(catalogs: Record<Lang, object>): string[] {
  const problems: string[] = [];
  const reference = readMessages('en', catalogs.en, problems);
  for (const lang of SUPPORTED_LANGS.filter((l) => l !== 'en')) {
    const messages = readMessages(lang, catalogs[lang], problems);
    for (const [key, expected] of reference) {
      if (!messages.has(key)) {
        problems.push(`${lang}: missing ${key}`);
        continue;
      }
      const actual = messages.get(key);
      if (expected && actual && !sameNames(expected, actual)) {
        problems.push(`${lang}: placeholder mismatch ${key} (${formatNames(expected)})`);
      }
    }
    for (const key of messages.keys()) {
      if (!reference.has(key)) problems.push(`${lang}: extra ${key}`);
    }
  }
  return problems;
}

/** Parses every message in a catalog, reporting the ones that aren't valid ICU strings. */
function readMessages(lang: Lang, catalog: object, problems: string[]): Messages {
  const messages: Messages = new Map();
  for (const [key, value] of leaves(catalog)) {
    if (typeof value !== 'string') {
      problems.push(`${lang}: not a string ${key}`);
      messages.set(key, null);
      continue;
    }
    try {
      // The same parse as i18next-icu's: it passes ignoreTag, so <0>…</0> stays literal text.
      messages.set(key, argumentNames(parse(value, { ignoreTag: true })));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      problems.push(`${lang}: invalid ICU ${key} (${reason})`);
      messages.set(key, null);
    }
  }
  return messages;
}

/** Yields `[dotted.key, value]` for every value in a nested catalog that isn't itself an object. */
function* leaves(node: object, prefix = ''): Generator<[string, unknown]> {
  for (const [name, value] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      yield* leaves(value, key);
    } else {
      yield [key, value];
    }
  }
}

/** The argument names in a parsed message, including those inside plural and select branches. */
function argumentNames(elements: MessageFormatElement[], names = new Set<string>()): Set<string> {
  for (const element of elements) {
    if (
      isArgumentElement(element) ||
      isNumberElement(element) ||
      isDateElement(element) ||
      isTimeElement(element)
    ) {
      names.add(element.value);
    } else if (isPluralElement(element) || isSelectElement(element)) {
      names.add(element.value);
      for (const option of Object.values(element.options)) argumentNames(option.value, names);
    }
  }
  return names;
}

function sameNames(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((name) => b.has(name));
}

function formatNames(names: Set<string>): string {
  if (names.size === 0) return 'none';
  return [...names]
    .sort()
    .map((name) => `{${name}}`)
    .join(', ');
}
