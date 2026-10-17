// `node scripts/native.mjs build|test|path [swift args…]`: SwiftPM for the Desk View helper in
// native/deskview-helper. Arguments after the command go to swift (for example `--filter Pacer`).
// - build: a release build, then the helper executable is re-signed ad hoc, which binds the
//   Info.plist its linker flags embed; the linker's own signature leaves it unbound.
// - test: `swift test`. Under Command Line Tools (`xcode-select -p` ends with /CommandLineTools),
//   it adds the flags that find Swift Testing there; without them the build fails with
//   "no such module 'Testing'".
// - path: prints where the release executable is.
// Desk View is macOS-only, so on any other OS every command prints a skip line and exits 0.
// cross-spawn runs swift, xcode-select and codesign without a shell.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = join(root, 'native', 'deskview-helper');
const executable = 'deskview-helper';
const commands = ['build', 'test', 'path'];
const release = ['-c', 'release', '--package-path', packagePath];

/** Runs a command with inherited stdio and fails on a non-zero exit. */
function run(command, args) {
  const result = spawn.sync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (exit ${result.status})`);
}

/** Runs a command and returns its trimmed stdout, or null when it can't run or fails. */
function read(command, args) {
  const result = spawn.sync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

/** Swift Testing lives outside the default search paths when only Command Line Tools exist. */
function commandLineToolsFlags() {
  const developerDir = read('xcode-select', ['-p']);
  if (!developerDir?.endsWith('/CommandLineTools')) return [];
  const frameworks = `${developerDir}/Library/Developer/Frameworks`;
  return [
    ...['-Xswiftc', '-F', '-Xswiftc', frameworks],
    ...['-Xlinker', '-F', '-Xlinker', frameworks],
    ...['-Xlinker', '-rpath', '-Xlinker', frameworks],
    ...['-Xlinker', '-rpath', '-Xlinker', `${developerDir}/Library/Developer/usr/lib`],
  ];
}

function releaseBinPath() {
  const bin = read('swift', ['build', ...release, '--show-bin-path']);
  if (!bin) throw new Error('`swift build --show-bin-path` failed');
  return bin;
}

const [command, ...extra] = process.argv.slice(2);
try {
  if (!commands.includes(command)) {
    console.error('usage: node scripts/native.mjs build|test|path [swift args…]');
    process.exitCode = 2;
  } else if (process.platform !== 'darwin') {
    // `path` keeps stdout for a path, so a caller never mistakes this line for one.
    (command === 'path' ? console.error : console.log)('native: skipped (Desk View is macOS-only)');
  } else if (command === 'build') {
    run('swift', ['build', ...release, ...extra]);
    const binary = join(releaseBinPath(), executable);
    if (!existsSync(binary)) throw new Error(`the build made no ${executable} at ${binary}`);
    run('codesign', ['--force', '--sign', '-', binary]);
  } else if (command === 'test') {
    run('swift', ['test', '--package-path', packagePath, ...commandLineToolsFlags(), ...extra]);
  } else {
    console.log(join(releaseBinPath(), executable));
  }
} catch (error) {
  console.error(`native: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
