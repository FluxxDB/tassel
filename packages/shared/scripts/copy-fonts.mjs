// Postinstall: copies the variable woff2 fonts and their OFL licenses from the `geist` and
// `pretendard` packages into src/fonts/. The copies are committed, so a missing source only
// warns while the committed copy exists. Uses node:path only, so it runs on macOS and Windows.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = join(pkgRoot, 'node_modules');
const fontsDir = join(pkgRoot, 'src', 'fonts');

// [source path inside node_modules, destination file name in src/fonts]
const files = [
  ['geist/dist/fonts/geist-sans/Geist-Variable.woff2', 'Geist-Variable.woff2'],
  ['geist/dist/fonts/geist-mono/GeistMono-Variable.woff2', 'GeistMono-Variable.woff2'],
  ['geist/LICENSE.txt', 'LICENSE-Geist.txt'],
  ['pretendard/dist/web/variable/woff2/PretendardVariable.woff2', 'PretendardVariable.woff2'],
  ['pretendard/dist/LICENSE.txt', 'LICENSE-Pretendard.txt'],
];

mkdirSync(fontsDir, { recursive: true });

let missing = 0;
for (const [from, to] of files) {
  const source = join(modulesDir, from);
  const target = join(fontsDir, to);
  if (existsSync(source)) {
    copyFileSync(source, target);
  } else if (existsSync(target)) {
    console.warn(`copy-fonts: ${from} not found; keeping the committed src/fonts/${to}`);
  } else {
    console.error(`copy-fonts: ${from} not found and src/fonts/${to} is missing`);
    missing += 1;
  }
}

if (missing > 0) process.exit(1);
