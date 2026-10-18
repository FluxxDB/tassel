import type { ChildProcess, SpawnOptions } from 'node:child_process';
export function withDeadline<T>(work: () => Promise<T>, ms: number, label: string): Promise<T>;
export function taggedProcesses(tag: string): number[];
export function stopTaggedProcesses(tag: string): Promise<void>;
export interface CameraLifetime {
  signal: AbortSignal;
  check(): void;
  shutdown(): Promise<void>;
  start(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): {
    child: ChildProcess;
    done: Promise<{ code: number; signal: NodeJS.Signals | null }>;
  };
}
export function withCameraLifetime<T>(
  work: (run: CameraLifetime) => Promise<T>,
  options: { tag: string },
): Promise<T>;
