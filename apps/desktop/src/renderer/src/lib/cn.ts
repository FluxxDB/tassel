// Joins class names, skipping the falsy ones, and settles conflicting Tailwind utilities: a later
// one replaces an earlier one that sets the same thing, so a className passed in overrides the
// component's own (cn('px-4', wide && 'px-8')). tailwind-merge knows Tailwind's scales; Tassel's
// own tokens (tokens.css in @tassel/shared and global.css's @theme) are added here, so
// rounded-card replaces rounded-pill and font-w520 is a weight, not a font family. Colors need no
// entry: a name after bg- or text- that isn't a size is a color.
import { extendTailwindMerge } from 'tailwind-merge';

const merge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['pill', 'card', 'card-sm', 'input', 'hero'],
      'font-weight': ['w520'],
    },
  },
});

export function cn(...classes: Array<string | false | null | undefined>): string {
  return merge(...classes);
}
