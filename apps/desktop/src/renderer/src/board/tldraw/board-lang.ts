// The session's language, for what Ada's shapes say: her board speaks it, not the UI's (global
// constraints, Language). TldrawCanvas provides it around the editor.
import type { Lang } from '@tassel/shared/i18n';
import { createContext } from 'react';

export const BoardLang = createContext<Lang>('en');
