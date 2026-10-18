// "Make her yours": four tutors a student could build in the app's avatar customizer, drawn with
// the app's own avatar. Each sits on a pastel tile like Ada's floating tile does on blush.
import { Avatar } from './avatar/Avatar';
import { type AvatarProfile, DEFAULT_AVATAR } from './avatar/catalog';

const TUTORS: Array<{ profile: AvatarProfile; tint: string; voice: string }> = [
  { profile: DEFAULT_AVATAR, tint: 'bg-blush', voice: 'English' },
  {
    profile: {
      ...DEFAULT_AVATAR,
      name: 'Lucía',
      hair: 'curls',
      hairColor: 'copper',
      hat: 'beanie',
      hatColor: 'plum',
      outfit: 'overalls',
      outfitColor: 'cream',
      accessory: 'earrings',
      face: 'happy',
      skin: 'caramel',
    },
    tint: 'bg-meringue',
    voice: 'Español',
  },
  {
    profile: {
      ...DEFAULT_AVATAR,
      name: '서연',
      hair: 'bob',
      hairColor: 'espresso',
      outfit: 'hoodie',
      outfitColor: 'sage',
      accessory: 'glasses',
      skin: 'porcelain',
    },
    tint: 'bg-mint',
    voice: '한국어',
  },
  {
    profile: {
      ...DEFAULT_AVATAR,
      name: 'Amara',
      hat: 'headscarf',
      hatColor: 'rose',
      outfit: 'dress',
      outfitColor: 'navy',
      accessory: 'none',
      face: 'soft',
      skin: 'cocoa',
    },
    tint: 'bg-sky',
    voice: 'English',
  },
];

export function TutorLineup() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
      {TUTORS.map(({ profile, tint, voice }) => (
        <li key={profile.name} className="flex flex-col gap-3">
          <div className={`${tint} relative aspect-[212/176] overflow-hidden rounded-card`}>
            <Avatar
              profile={profile}
              className="absolute top-[3.4%] left-1/2 aspect-square h-[88.6%] -translate-x-1/2"
            />
            <div className="absolute bottom-2.5 left-2.5 flex h-[27px] items-center rounded-pill bg-paper px-2.5">
              <span className="text-[13px] leading-4 font-w520 text-ink">{profile.name}</span>
            </div>
          </div>
          <p className="mono text-[11px] text-smoke-text">
            Voice ·{' '}
            <span lang={voice === '한국어' ? 'ko' : voice === 'Español' ? 'es' : 'en'}>
              {voice}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}
