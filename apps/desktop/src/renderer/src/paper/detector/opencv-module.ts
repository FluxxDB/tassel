// OpenCV.js, loaded through this module so its Promise is never awaited as a namespace.
// @techstark/opencv-js sets module.exports to a Promise of cv. Bundlers wrap a CommonJS module in
// a namespace object whose prototype is module.exports' prototype, so this namespace inherits
// Promise.prototype.then without being a Promise: `await import('@techstark/opencv-js')` calls
// that then() and throws. Its `default` is the real Promise. loadOpenCv imports this module
// lazily, so the 16 MB chunk loads while the worker already reports motion.
import * as opencv from '@techstark/opencv-js';

export const cvPromise: unknown = (opencv as { default?: unknown }).default ?? opencv;
