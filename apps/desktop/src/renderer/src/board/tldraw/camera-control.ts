/** Student ownership persists until an Ada action. Active gestures defer even Ada's fits. */
export function createCameraControl(frame: () => void, stop: () => void) {
  let held = false;
  let pending: { run: () => void; student: boolean } | null = null;
  const active = new Set<string>();
  const flush = () => {
    if (active.size || !pending) return;
    const { run, student } = pending;
    pending = null;
    held = student;
    stop();
    run();
  };
  const studentMove = () => {
    held = true;
    stop();
  };
  const requestFit = (run: () => void, student: boolean) => {
    pending = { run, student };
    flush();
  };
  return {
    studentMove,
    begin(source: string) {
      active.add(source);
      studentMove();
    },
    end(source: string) {
      active.delete(source);
      flush();
    },
    cancel() {
      active.clear();
      flush();
    },
    adaAction: () => requestFit(frame, false),
    refit(run = frame) {
      if (!held && !active.size) run();
    },
    fit: (run = frame) => requestFit(run, true),
  };
}
