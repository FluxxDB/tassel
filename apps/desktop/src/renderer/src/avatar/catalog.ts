import voiceCatalog from './voices.json';

export const HAIR = ['ponytail', 'bob', 'long', 'pixie', 'curls', 'buns', 'headscarf'] as const;
export const HAIR_COLORS = [
  'espresso',
  'chestnut',
  'copper',
  'gold',
  'silver',
  'rose',
  'plum',
  'blue',
] as const;
export const OUTFITS = ['sweater', 'collar', 'hoodie', 'overalls', 'dress'] as const;
export const OUTFIT_COLORS = ['lilac', 'sage', 'peach', 'navy', 'cream'] as const;
export const ACCESSORIES = ['none', 'clip', 'glasses', 'earrings', 'stars'] as const;
export const VOICE_CATALOG = voiceCatalog;
export const VOICES = voiceCatalog.voices.filter((voice) => !/angry|romance/i.test(voice.name));
export const VOICE_LANGUAGES = ['en', 'es', 'ko'] as const;
export const VOICE_FIELDS = { en: 'voiceEn', es: 'voiceEs', ko: 'voiceKo' } as const;
export const FACES = ['soft', 'happy', 'sideways', 'sleepy'] as const;
export const SKINS = [
  'porcelain',
  'pearl',
  'sand',
  'honey',
  'caramel',
  'umber',
  'cocoa',
  'espresso',
] as const;
export const COLORS = {
  hair: {
    espresso: '#30272c',
    chestnut: '#724a3f',
    copper: '#b86039',
    gold: '#d6ad60',
    silver: '#c3bbc6',
    rose: '#cb829b',
    plum: '#73516f',
    blue: '#526e93',
  },
  outfit: {
    lilac: '#aa91ce',
    sage: '#8eaa96',
    peach: '#ddaa95',
    navy: '#52617d',
    cream: '#eadfc9',
  },
  skin: {
    porcelain: '#f8dfd0',
    pearl: '#efd0b6',
    sand: '#dfb38e',
    honey: '#cc996e',
    caramel: '#b98058',
    umber: '#996745',
    cocoa: '#774d38',
    espresso: '#51372d',
  },
};
export interface AvatarProfile {
  name: string;
  voiceEn: string;
  voiceEs: string;
  voiceKo: string;
  hair: (typeof HAIR)[number];
  hairColor: (typeof HAIR_COLORS)[number];
  outfit: (typeof OUTFITS)[number];
  outfitColor: (typeof OUTFIT_COLORS)[number];
  accessory: (typeof ACCESSORIES)[number];
  face: (typeof FACES)[number];
  skin: (typeof SKINS)[number];
}
export const DEFAULT_AVATAR: AvatarProfile = {
  name: 'Ada',
  voiceEn: 'off',
  voiceEs: 'off',
  voiceKo: 'off',
  hair: 'ponytail',
  hairColor: 'chestnut',
  outfit: 'sweater',
  outfitColor: 'lilac',
  accessory: 'clip',
  face: 'soft',
  skin: 'pearl',
};
export function cycle<T>(options: readonly T[], value: T, direction: number): T {
  return options[
    (Math.max(0, options.indexOf(value)) + direction + options.length) % options.length
  ];
}
export function readAvatar(value: unknown): AvatarProfile {
  const result = { ...DEFAULT_AVATAR };
  if (!value || typeof value !== 'object') return result;
  const fields = {
    hair: HAIR,
    hairColor: HAIR_COLORS,
    outfit: OUTFITS,
    outfitColor: OUTFIT_COLORS,
    accessory: ACCESSORIES,
    face: FACES,
    skin: SKINS,
  };
  for (const [key, options] of Object.entries(fields)) {
    const choice = Reflect.get(value, key);
    if (typeof choice === 'string' && (options as readonly string[]).includes(choice))
      Reflect.set(result, key, choice);
  }
  for (const lang of VOICE_LANGUAGES) {
    const field = VOICE_FIELDS[lang];
    const choice = Reflect.get(value, field);
    if (choice === 'off' || VOICES.some((voice) => voice.id === choice && voice.language === lang))
      result[field] = choice;
  }
  const name = Reflect.get(value, 'name');
  if (typeof name === 'string' && name.trim())
    result.name =
      name
        .trim()
        .split('')
        .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
        .join('')
        .slice(0, 30) || DEFAULT_AVATAR.name;
  return result;
}

/** Separate adjacent materials without changing a chosen skin or hair color. */
export function materialBoundary(background: string): string {
  const hex = background.slice(1);
  const luminance = [0, 2, 4]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  return luminance < 120 ? '#f1ddc8' : '#49323c';
}
