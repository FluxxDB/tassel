// The entry the paper-worker spec builds into out/renderer/paper-probe/, so the built detector
// worker can run from app://tassel before the paper view imports it (Task 12).
export { createChangeDetector } from '../../../src/renderer/src/paper/detector/client';
