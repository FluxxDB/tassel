// MediaStreamTrackProcessor, which TypeScript's DOM lib lacks (its WebWorker lib has it: the
// spec exposes it in workers, while Chromium 152 exposes it on Window only). Window code only:
// tsconfig.worker.json leaves this file out, so the two declarations never meet.

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}

interface MediaStreamTrackProcessor {
  readonly readable: ReadableStream<VideoFrame>;
}

declare var MediaStreamTrackProcessor: {
  prototype: MediaStreamTrackProcessor;
  new (init: MediaStreamTrackProcessorInit): MediaStreamTrackProcessor;
};
