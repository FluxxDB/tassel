// The layout worker: Graphviz runs here, off the page, because WebAssembly can't compile under the
// page's CSP and a worker loaded from the app's own origin isn't bound by it (P5-R3). The client
// starts it as a module worker, which the build bundles into one chunk. It answers each spec with
// its layout or an error.
import type { FromLayoutWorker, ToLayoutWorker } from './messages';
import { layoutWithViz } from './viz';

/** The worker's global scope, typed by hand so this compiles without the WebWorker lib. */
interface LayoutScope {
  onmessage: ((event: MessageEvent<ToLayoutWorker>) => void) | null;
  postMessage(message: FromLayoutWorker): void;
}

const scope = self as unknown as LayoutScope;

scope.onmessage = ({ data: { id, spec } }) => {
  layoutWithViz(spec).then(
    (layout) => scope.postMessage({ id, layout }),
    (error: unknown) =>
      scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }),
  );
};
