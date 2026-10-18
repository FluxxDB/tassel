import { create } from 'zustand';
import { type AvatarProfile, DEFAULT_AVATAR, readAvatar } from './catalog';

const KEY = 'tassel.avatar';
function load(): AvatarProfile {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    return saved?.version === 1 ? readAvatar(saved.profile) : { ...DEFAULT_AVATAR };
  } catch {
    return { ...DEFAULT_AVATAR };
  }
}
export const useAvatar = create<{ profile: AvatarProfile; save(profile: AvatarProfile): void }>(
  (set) => ({
    profile: load(),
    save(profile) {
      const valid = readAvatar(profile);
      // Commit the visible profile only after storage succeeds. The editor handles failures.
      localStorage.setItem(KEY, JSON.stringify({ version: 1, profile: valid }));
      set({ profile: valid });
    },
  }),
);
