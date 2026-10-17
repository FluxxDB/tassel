import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../../../electron.vite.config';

const appDir = join(__dirname, '..', '..', '..', '..');
/** A tsconfig, without its // comments. */
const tsconfig = (name: string) =>
  JSON.parse(
    readFileSync(join(appDir, name), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n'),
  ) as { compilerOptions: { lib?: string[] }; include?: string[]; exclude?: string[] };

const DETECTOR = 'src/renderer/src/paper/detector';

describe('the detector worker’s build and type-check (re-review N3, N5)', () => {
  it('type-checks the worker in its own WebWorker program, without the window’s code', () => {
    const worker = tsconfig('tsconfig.worker.json');
    expect(worker.compilerOptions.lib).toEqual(['ES2023', 'WebWorker']);
    expect(worker.include).toContain(`${DETECTOR}/worker.ts`);
    expect(worker.include).toContain(`${DETECTOR}/frame-loop.ts`);
    expect(worker.include).toContain(`${DETECTOR}/opencv-page.ts`);
    expect(worker.include).toContain('src/renderer/src/paper/contracts.ts');
    // client.ts uses MediaStream and MediaStreamTrack, which the WebWorker lib lacks, and
    // breakout-box.d.ts would declare the processor a second time.
    expect(worker.include?.some((path) => path.includes('client'))).toBe(false);
    expect(worker.include?.some((path) => path.includes('breakout-box'))).toBe(false);
    expect(tsconfig('tsconfig.web.json').exclude).toEqual([`${DETECTOR}/worker.ts`]);
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.typecheck).toContain('tsc --noEmit -p tsconfig.worker.json');
  });

  it('builds the worker as an ES module, and pre-bundles OpenCV for the dev server', () => {
    const renderer = (
      config as {
        renderer?: { worker?: { format?: string }; optimizeDeps?: { include?: string[] } };
      }
    ).renderer;
    expect(renderer?.worker?.format).toBe('es');
    expect(renderer?.optimizeDeps?.include).toContain('@techstark/opencv-js');
  });
});
