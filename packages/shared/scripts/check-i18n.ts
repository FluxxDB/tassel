// `pnpm check:i18n`: checks the en/es/ko catalogs and exits 1 with one line per problem.
// Node runs this file directly (type stripping), so the import names the .ts file.
import { checkCatalogs, resources } from '../src/i18n/index.ts';

const problems = checkCatalogs({
  en: resources.en.translation,
  es: resources.es.translation,
  ko: resources.ko.translation,
});

if (problems.length > 0) {
  console.error(`check:i18n: ${problems.length} problem(s) in the en/es/ko catalogs`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log('check:i18n: the en, es and ko catalogs are complete and consistent');
}
