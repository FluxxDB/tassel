// The parts of the desktop app's avatar catalog (apps/desktop/src/renderer/src/avatar/catalog.ts)
// the avatar drawing needs: its options, colors and default profile. Keep it in sync.
export const HAIR = ['ponytail', 'bob', 'long', 'pixie', 'curls', 'buns'] as const;
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
export const HATS = ['none', 'cap', 'beanie', 'headscarf'] as const;
export const HAT_COLORS = HAIR_COLORS;
export const OUTFITS = ['sweater', 'collar', 'hoodie', 'overalls', 'dress'] as const;
export const OUTFIT_COLORS = ['lilac', 'sage', 'peach', 'navy', 'cream'] as const;
export const ACCESSORIES = ['none', 'clip', 'glasses', 'earrings', 'stars'] as const;
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
  hat: (typeof HATS)[number];
  hatColor: (typeof HAT_COLORS)[number];
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
  hat: 'none',
  hatColor: 'chestnut',
  hairColor: 'chestnut',
  outfit: 'sweater',
  outfitColor: 'lilac',
  accessory: 'clip',
  face: 'soft',
  skin: 'pearl',
};
/** Separate adjacent materials without changing a chosen skin or hair color. */
export function materialBoundary(background: string): string {
  const hex = background.slice(1);
  const luminance = [0, 2, 4]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  return luminance < 120 ? '#f1ddc8' : '#49323c';
}
